/**
 * VidFlow - Background Utilities
 * stopWorkflow, findOrOpenTab, openFreshTab, notifyProgress,
 * saveState, loadState, sleep, connectToContentScript, handleContentScriptReady.
 */

// ========== UTILITIES ==========

function stopWorkflow() {
  workflowState.isRunning = false;
  workflowState.currentStep = null;
  workflowState.activeVideos = [];
  workflowState.failedVideos = [];
  workflowState.rateLimitedVideos = [];
  workflowState.permanentlyFailedCount = 0;
  workflowState.pendingIndexes = null;

  // Clean up download tracking
  downloadSceneMap.clear();
  pendingPromptSceneMap.clear();
  pendingVideoUrlMap.clear();
  preparedDownloadMap.clear();

  // Desregistrar listener de descargas
  unregisterDownloadListener();

  // Notify all content scripts to stop
  chrome.tabs.query({ url: '*://labs.google/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'stopAutomation' }).catch(() => {});
    });
  });

  return { success: true };
}

async function findOrOpenTab(urlPattern, fullUrl) {
  // Get the currently focused window so new tabs open there
  let currentWindow;
  try {
    currentWindow = await chrome.windows.getLastFocused();
  } catch (_) {}

  // First, try to find existing tab (prefer current window)
  const tabs = await chrome.tabs.query({});
  let targetTab = tabs.find(tab => tab.url && tab.url.includes(urlPattern) && currentWindow && tab.windowId === currentWindow.id)
    || tabs.find(tab => tab.url && tab.url.includes(urlPattern));

  if (targetTab) {
    // Reutilizar pestaña existente (no cambiar foco, ya existe)
    return targetTab;
  }

  // Open new tab in the current window
  // active: true necesario para que Flow renderice correctamente
  const createOpts = { url: fullUrl, active: true };
  if (currentWindow) createOpts.windowId = currentWindow.id;
  targetTab = await chrome.tabs.create(createOpts);

  // Wait for load
  await new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === targetTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });

  return targetTab;
}

/**
 * Abre SIEMPRE una pestaña nueva (no reutiliza existentes)
 * Útil para Flow que necesita empezar en el home limpio
 */
async function openFreshTab(fullUrl) {
  console.log('VidFlow BG: Abriendo pestaña fresca:', fullUrl);

  // Abrir nueva pestaña en la ventana actual
  // Nota: active: true es necesario porque Flow (React) no renderiza tiles en tabs inactivas
  let currentWindow;
  try { currentWindow = await chrome.windows.getLastFocused(); } catch (_) {}
  const createOpts = { url: fullUrl, active: true };
  if (currentWindow) createOpts.windowId = currentWindow.id;
  const targetTab = await chrome.tabs.create(createOpts);

  // Wait for load
  await new Promise(resolve => {
    const timeout = setTimeout(() => {
      console.log('VidFlow BG: Timeout esperando carga de pestaña');
      resolve();
    }, 30000); // 30 segundos timeout

    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === targetTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  return targetTab;
}

function notifyProgress(current, total, status) {
  chrome.runtime.sendMessage({
    action: 'progressUpdate',
    current,
    total,
    status
  }).catch(() => {}); // Ignore if popup is closed
}

async function saveState() {
  workflowState.lastActivityTime = Date.now();
  try {
    // PERF: Exclude batchImages from state saves. They don't change during execution
    // and serializing 58 base64 images (~40MB) on every save is extremely slow.
    // batchImages are saved once at workflow start and loaded separately.
    const { batchImages, ...stateWithoutImages } = workflowState;
    await chrome.storage.local.set({ workflowState: stateWithoutImages });
  } catch (error) {
    // Si falla por quota, ignorar (las imágenes son muy grandes)
    console.log('VidFlow BG: No se pudo guardar estado (quota?):', error.message);
  }
}

async function loadState() {
  const result = await chrome.storage.local.get('workflowState');
  if (result.workflowState) {
    workflowState = result.workflowState;

    // Si el service worker se reinició, el pipeline no puede estar corriendo realmente.
    // Limpiar estado huérfano para no interferir con otras extensiones (AutoFlow, etc.)
    if (workflowState.isRunning) {
      console.log('VidFlow BG: Estado huérfano detectado (isRunning=true tras restart). Limpiando...');
      workflowState.isRunning = false;
      workflowState.currentStep = null;
    }
  }

  // También limpiar pipelineState si quedó en running
  if (pipelineState.isRunning) {
    console.log('VidFlow BG: Pipeline state huérfano detectado. Limpiando...');
    pipelineState.isRunning = false;
    pipelineState.currentStep = null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectToContentScript(tabId, config) {
  const maxRetries = 7;

  // SIEMPRE intentar inyectar el script primero (puede que la extensión se haya recargado)
  console.log('VidFlow BG: Inyectando content script en tab', tabId);

  // Primero verificar info del tab
  try {
    const tabInfo = await chrome.tabs.get(tabId);
    console.log('VidFlow BG: Tab info:', tabInfo.url, 'status:', tabInfo.status);
  } catch (e) {
    console.log('VidFlow BG: No se pudo obtener info del tab:', e.message);
  }

  try {
    // Inyectar en el frame principal primero
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        'content/flow/utils.js',
        'content/flow/log.js',
        'content/flow/selectors.js',
        'content/flow/settings.js',
        'content/flow/generation-type.js',
        'content/flow/generation-image.js',
        'content/flow/generation.js',
        'content/flow/video.js',
        'content/flow/pipeline.js',
        'content/flow/detect.js',
        'content/flow/monitor.js',
        'content/flow/main.js'
      ]
    });
    console.log('VidFlow BG: Resultado de inyección:', result);
    await sleep(2000); // Esperar inicialización del content script
  } catch (injectError) {
    console.log('VidFlow BG: Error en inyección:', injectError.message);

    // Intentar de nuevo
    try {
      await sleep(1000);
      const result2 = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [
          'content/flow/utils.js',
          'content/flow/log.js',
          'content/flow/selectors.js',
          'content/flow/settings.js',
          'content/flow/generation-type.js',
          'content/flow/generation-image.js',
          'content/flow/generation.js',
          'content/flow/video.js',
          'content/flow/pipeline.js',
          'content/flow/detect.js',
          'content/flow/monitor.js',
          'content/flow/main.js'
        ]
      });
      console.log('VidFlow BG: Segundo intento resultado:', result2);
      await sleep(2000);
    } catch (e) {
      console.log('VidFlow BG: Segundo intento también falló:', e.message);
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`VidFlow BG: Intento de conexión ${attempt}/${maxRetries}...`);

    try {
      // Intentar enviar mensaje de setup
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'setupFlow',
        data: { config: config }
      });

      if (response && response.success) {
        console.log('VidFlow BG: Conexión exitosa con content script');
        return true;
      }
    } catch (error) {
      console.log(`VidFlow BG: Error en intento ${attempt}:`, error.message);

      // Si el error es que no hay receptor, intentar reinyectar
      if (error.message.includes('Receiving end does not exist') ||
          error.message.includes('Could not establish connection')) {
        console.log('VidFlow BG: Reinyectando script...');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: [
              'content/flow/utils.js',
              'content/flow/log.js',
              'content/flow/selectors.js',
              'content/flow/settings.js',
              'content/flow/generation-type.js',
              'content/flow/generation-image.js',
              'content/flow/generation.js',
              'content/flow/video.js',
              'content/flow/pipeline.js',
              'content/flow/detect.js',
              'content/flow/monitor.js',
              'content/flow/main.js'
            ]
          });
          await sleep(1500);
        } catch (e) {
          // Ignorar
        }
      }
    }

    // Esperar antes del siguiente intento
    if (attempt < maxRetries) {
      await sleep(1500);
    }
  }

  console.error('VidFlow BG: No se pudo conectar después de', maxRetries, 'intentos');
  console.error('VidFlow BG: Tip - Si recargaste la extensión, necesitas RECARGAR la página de Flow también');
  return false;
}

function handleContentScriptReady(sender) {
  console.log('Content script ready:', sender.tab?.url);
  return { success: true };
}
