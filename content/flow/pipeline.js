/**
 * VidFlow - Modo Pipeline
 * Generación de hasta 5 videos en paralelo con reintentos automáticos
 */

// ========== BLACK SCREEN DETECTION ==========

/**
 * Checks if a video is a black screen by fetching it as a blob (bypasses CORS),
 * creating a same-origin video element, seeking to 1s, and sampling pixel brightness.
 * The fetch uses the browser cache so it's nearly instant for already-loaded videos.
 * @param {HTMLVideoElement} videoEl - The video element (used to get the src URL)
 * @param {number} [brightnessThreshold=15] - Max average RGB to consider "black"
 * @returns {Promise<boolean>} - true if the video appears to be a black screen
 */
async function isBlackScreenVideo(videoEl, brightnessThreshold = 15) {
  const videoUrl = videoEl?.src || videoEl?.currentSrc;
  if (!videoUrl) return false;

  try {
    // Fetch video as blob — bypasses CORS canvas taint.
    // Uses browser cache for already-loaded videos (nearly instant).
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const tempVideo = document.createElement('video');
    tempVideo.muted = true;
    tempVideo.preload = 'auto';
    tempVideo.src = blobUrl;

    // Wait for video data to load
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 8000);
      tempVideo.addEventListener('loadeddata', () => { clearTimeout(timeout); resolve(); }, { once: true });
      tempVideo.addEventListener('error', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });

    if (tempVideo.readyState < 2) {
      URL.revokeObjectURL(blobUrl);
      tempVideo.src = '';
      return false; // Can't load — don't block download
    }

    // Seek to 1s to skip potential fade-in from black
    const seekTime = Math.min(1, tempVideo.duration || 1);
    tempVideo.currentTime = seekTime;
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      tempVideo.addEventListener('seeked', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });

    // Capture frame on a small canvas (64x36 is enough for brightness analysis)
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);

    // Clean up blob
    URL.revokeObjectURL(blobUrl);
    tempVideo.src = '';

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    // Calculate average brightness
    let totalBrightness = 0;
    const pixelCount = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      totalBrightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
    }
    const avgBrightness = totalBrightness / pixelCount;

    const isBlack = avgBrightness < brightnessThreshold;
    console.log(`VidFlow: Black screen check — avg brightness: ${avgBrightness.toFixed(1)}, isBlack: ${isBlack}`);
    return isBlack;
  } catch (e) {
    console.warn('VidFlow: Error checking for black screen:', e.message);
    return false; // Don't block download on detection errors
  }
}

// ========== PROMPT DETECTION (API + DOM hybrid) ==========

/**
 * Encuentra el botón de prompt en el DOM (fallback para diseño anterior)
 * @param {string} promptText - El texto del prompt a buscar
 * @returns {Element|null}
 */
function findPromptButton(promptText) {
  const normalizedSearch = promptText.toLowerCase().trim();
  const buttons = document.querySelectorAll('button');

  let bestMatch = null;
  let bestScore = 0;

  for (const btn of buttons) {
    const btnText = btn.textContent?.trim();
    if (!btnText) continue;

    if (btnText === promptText) return btn;

    if (btnText.length > 25) {
      const normalizedBtn = btnText.toLowerCase();
      const len = Math.min(normalizedBtn.length, normalizedSearch.length);
      let matched = 0;
      for (let i = 0; i < len; i++) {
        if (normalizedBtn[i] === normalizedSearch[i]) matched++;
        else break;
      }
      if (matched > 30 && matched > bestScore) {
        bestScore = matched;
        bestMatch = btn;
      }
    }
  }

  return bestMatch;
}

/**
 * Encuentra el card de video por su texto de prompt.
 * Nuevo Flow: usa API para obtener mediaKey → busca card por video src.
 * Fallback: busca botón con texto del prompt en el DOM (diseño anterior).
 * @param {string} promptText - El texto del prompt
 * @returns {Element|null}
 */
function findVideoCardByPrompt(promptText) {
  // MÉTODO 1: Buscar via mediaKey (nuevo Flow)
  // Usa el cache sincrónico del workflow map (se refresca desde el monitor)
  if (_workflowMapCache) {
    for (const [mediaKey, data] of _workflowMapCache) {
      if (data.prompt === promptText ||
          data.prompt.toLowerCase().trim() === promptText.toLowerCase().trim()) {
        const card = findCardByMediaKey(mediaKey);
        if (card) return card;
      }
    }
    // Match parcial para prompts truncados
    const normalizedSearch = promptText.toLowerCase().trim();
    for (const [mediaKey, data] of _workflowMapCache) {
      const normalizedPrompt = data.prompt.toLowerCase().trim();
      const minLen = Math.min(normalizedPrompt.length, normalizedSearch.length, 50);
      if (minLen >= 30 && normalizedPrompt.substring(0, minLen) === normalizedSearch.substring(0, minLen)) {
        const card = findCardByMediaKey(mediaKey);
        if (card) return card;
      }
    }
  }

  // MÉTODO 2: Fallback DOM (diseño anterior)
  const btn = findPromptButton(promptText);
  if (!btn) return null;

  let container = btn.parentElement;
  for (let i = 0; i < 6 && container && container !== document.body; i++) {
    if (container.querySelector('video') ||
        container.querySelector('img[src*="storage"], img[src*="googleusercontent"]') ||
        container.querySelector('[class*="progress"]')) {
      return container;
    }
    container = container.parentElement;
  }

  return btn.closest('[class*="sc-"]') || btn.parentElement?.parentElement || btn.parentElement;
}

// ========== STATUS DETECTION ==========

/**
 * Obtiene el estado de un video por su prompt
 * Nuevo Flow: busca card via API+mediaKey, luego inspecciona el DOM del card.
 * @param {string} promptText - El texto del prompt
 * @returns {Object} - {status: string, progress: number|null}
 */
function getVideoStatusByPrompt(promptText) {
  // MÉTODO 1: Buscar card via API+mediaKey (nuevo Flow)
  const card = findVideoCardByPrompt(promptText);
  if (card && card.getAttribute?.('data-tile-id')) {
    // Card encontrado via nuevo método
    const cardText = card.innerText || '';

    if (cardText.includes('No se ha podido') || cardText.includes('Error') || cardText.includes("can't generate")) {
      return { status: 'FAILED', progress: null };
    }

    const hasVideo = card.querySelector('video[src]');
    if (hasVideo && isValidVideoUrl(hasVideo.src)) {
      return { status: 'COMPLETED', progress: 100 };
    }

    // Buscar porcentaje de progreso
    const allPercents = cardText.match(/\b(\d{1,3})%/g) || [];
    for (const pMatch of allPercents) {
      const percent = parseInt(pMatch);
      if (percent >= 0 && percent <= 100) {
        return { status: 'GENERATING', progress: percent };
      }
    }

    return { status: 'PENDING', progress: 0 };
  }

  // MÉTODO 2: Fallback DOM (diseño anterior)
  const btn = findPromptButton(promptText);
  if (!btn) {
    return { status: 'NOT_FOUND', progress: null };
  }

  const nextSibling = btn.nextElementSibling;
  if (nextSibling) {
    const nextText = nextSibling.textContent?.trim() || '';
    if (nextText.includes('No se ha podido') || nextText.includes('Error') || nextText.includes("can't generate")) {
      return { status: 'FAILED', progress: null };
    }
  }

  let container = btn.parentElement;
  for (let level = 0; level < 6 && container && container !== document.body; level++) {
    const containerText = container.innerText || '';

    if (containerText.includes('No se ha podido') || containerText.includes('Error') || containerText.includes("can't generate")) {
      return { status: 'FAILED', progress: null };
    }

    const hasVideo = container.querySelector('video[src]');
    const hasImg = container.querySelector('img[src*="storage"], img[src*="googleusercontent"]');
    if (hasVideo || hasImg) {
      return { status: 'COMPLETED', progress: 100 };
    }

    const btnText = btn.textContent || '';
    const allPercents = containerText.match(/\b(\d{1,3})%/g) || [];
    for (const pMatch of allPercents) {
      const percent = parseInt(pMatch);
      if (percent >= 0 && percent <= 100 && !btnText.includes(pMatch)) {
        return { status: 'GENERATING', progress: percent };
      }
    }

    container = container.parentElement;
  }

  return { status: 'PENDING', progress: 0 };
}

/**
 * Cuenta estados de múltiples prompts
 * @param {Array} prompts - Lista de prompts
 * @returns {Object}
 */
function countVideoStatuses(prompts) {
  const results = {
    generating: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    notFound: 0,
    details: []
  };

  for (const prompt of prompts) {
    const promptText = typeof prompt === 'string' ? prompt : prompt.prompt;
    const status = getVideoStatusByPrompt(promptText);

    results.details.push({ prompt: promptText.substring(0, 30), ...status });

    switch (status.status) {
      case 'GENERATING': results.generating++; break;
      case 'COMPLETED': results.completed++; break;
      case 'FAILED': results.failed++; break;
      case 'PENDING': results.pending++; break;
      case 'NOT_FOUND': results.notFound++; break;
    }
  }

  return results;
}

/**
 * Obtiene todos los videos del grid
 * @returns {Array}
 */
function getAllVideoStatuses() {
  const results = [];
  const buttons = document.querySelectorAll('button');
  const seenPrompts = new Set();

  for (const btn of buttons) {
    const text = btn.textContent?.trim();
    if (text && text.length > 30 &&
        !text.includes('Cerrar') && !text.includes('Buscar') &&
        !text.includes('Añadir') && !text.includes('Crear') &&
        !seenPrompts.has(text.substring(0, 40))) {

      seenPrompts.add(text.substring(0, 40));
      const status = getVideoStatusByPrompt(text);
      results.push({
        prompt: text.substring(0, 60),
        ...status
      });
    }
  }

  return results;
}

// ========== CARD ACTIONS ==========

/**
 * Hace clic en el card de un video
 * @param {string} promptText - El texto del prompt
 */
async function clickVideoCard(promptText) {
  const card = findVideoCardByPrompt(promptText);

  if (!card) {
    vfLog(`Card no encontrado para: ${promptText.substring(0, 30)}...`, 'warn');
    return false;
  }

  const clickTarget = card.querySelector('video') || card.querySelector('img') || card;
  clickTarget.click();
  await sleep(500);

  vfLog(`Card seleccionado: ${promptText.substring(0, 30)}...`, 'info');
  return true;
}

/**
 * Descarga un video específico por su prompt
 * @param {string} promptText - El texto del prompt
 * @param {string} filename - Nombre del archivo
 */
async function downloadVideoByPrompt(promptText, filename) {
  vfLog(`Descargando video: ${promptText.substring(0, 40)}...`, 'info');

  const card = findVideoCardByPrompt(promptText);
  if (!card) {
    vfLog('Card no encontrado para descargar', 'error');
    return null;
  }

  // === MÉTODO 1: Descarga directa via API URL (720p por defecto) ===
  const videoEl = card.querySelector('video[src]') || card.querySelector('video') || card.querySelector('img');
  const downloaded = await downloadViaMoreVertMenu(card, videoEl, filename);
  if (downloaded) {
    return filename;
  }

  // === MÉTODO 2: Botón de descarga directo (vista edición o diseño anterior) ===
  const cardButtons = card.querySelectorAll('button');
  let downloadBtn = null;
  for (const btn of cardButtons) {
    const hasDownloadIcon = btn.querySelector('[class*="download"]');
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    const btnText = btn.textContent?.toLowerCase() || '';

    if (hasDownloadIcon || ariaLabel.includes('descargar') || ariaLabel.includes('download') ||
        btnText.includes('download') || btnText.includes('descargar')) {
      downloadBtn = btn;
      vfLog('Botón descarga directo encontrado en card', 'info');
      break;
    }
  }

  if (!downloadBtn) {
    downloadBtn = findElement(['Descargar', 'Download'], 'button');
  }

  if (downloadBtn) {
    downloadBtn.click();
    await sleep(800);

    const menu = document.querySelector('[role="menu"]');
    if (menu) {
      const menuItems = menu.querySelectorAll('[role="menuitem"]');
      for (const item of menuItems) {
        const itemText = item.textContent?.toLowerCase() || '';
        if (itemText.includes('720p') || itemText.includes('original')) {
          item.click();
          await sleep(2000);
          vfLog(`Descarga 720p: ${filename}`, 'success');
          return filename;
        }
      }
    } else {
      await sleep(2000);
      vfLog(`Descarga directa: ${filename}`, 'success');
      return filename;
    }
  }

  vfLog('No se encontró botón de descarga', 'warn');
  return null;
}

// ========== QUEUE MANAGEMENT ==========

/**
 * Envía un prompt a la cola
 * @param {string} promptText - El texto del prompt
 */
async function submitPromptToQueue(promptText) {
  vfLog(`Enviando a cola: ${promptText.substring(0, 40)}...`, 'info');

  const promptEl = findPromptInput();
  if (!promptEl) {
    vfLog('Campo de texto no encontrado', 'error');
    return false;
  }

  // Limpiar y establecer texto via Slate bridge
  await setPromptText(promptEl, '');
  await sleep(100);
  await setPromptText(promptEl, promptText);
  await sleep(300);

  // Buscar botón submit: el que tiene "arrow_forward" + "Crear" (junto al prompt)
  // NO el botón "add_2Crear" que es para añadir archivos
  const submitBtn = findSubmitButton();
  if (!submitBtn) {
    vfLog('Botón de enviar no encontrado', 'error');
    return false;
  }

  submitBtn.click();
  await sleep(500);
  vfLog(`Prompt enviado a cola`, 'success');
  return true;
}

// ========== RETRY MECHANISM ==========

/**
 * Encuentra el botón "Reutilizar petición"
 * @param {string} promptText - El texto del prompt
 * @returns {Element|null}
 */
function findRetryButton(promptText) {
  const btn = findPromptButton(promptText);
  if (!btn) return null;

  const parent = btn.parentElement;
  if (!parent) return null;

  const buttons = parent.querySelectorAll('button');

  for (const button of buttons) {
    const text = button.textContent?.toLowerCase() || '';
    const hasWrapText = button.querySelector('[class*="wrap_text"]');

    if (text.includes('reutilizar') || (hasWrapText && !text.includes('more_vert'))) {
      return button;
    }
  }

  return null;
}

/**
 * Reintenta un video fallido
 * @param {string} promptText - El texto del prompt
 * @returns {Promise<boolean>}
 */
async function retryFailedVideo(promptText) {
  vfLog(`Reintentando video fallido: ${promptText.substring(0, 30)}...`, 'info');

  // Verificar estado
  const status = getVideoStatusByPrompt(promptText);
  if (status.status !== 'FAILED') {
    vfLog(`Video no está en estado FAILED (${status.status})`, 'warn');
    return false;
  }

  // Verificar botón del prompt
  const promptBtn = findPromptButton(promptText);
  if (!promptBtn) {
    vfLog('Botón del prompt no encontrado', 'error');
    return false;
  }

  const cardParent = promptBtn.parentElement;
  const cardText = cardParent?.innerText || '';

  // Verificación de seguridad
  if (!cardText.includes(promptText)) {
    vfLog(`ERROR: El card no contiene el prompt esperado`, 'error');
    return false;
  }

  // Encontrar y hacer clic en reutilizar
  const retryBtn = findRetryButton(promptText);
  if (!retryBtn) {
    vfLog('Botón "Reutilizar petición" no encontrado', 'error');
    return false;
  }

  retryBtn.click();
  await sleep(800);

  // Verificar que se cargó el prompt
  const promptEl = findPromptInput();
  const loadedText = getPromptText(promptEl);
  if (!promptEl || !loadedText) {
    vfLog('El prompt no se cargó en el campo de texto', 'error');
    return false;
  }

  // VERIFICACIÓN CRÍTICA: Match exacto
  if (loadedText !== promptText.trim()) {
    vfLog(`ERROR DE MATCH: Esperaba "${promptText}" pero se cargó "${loadedText}"`, 'error');
    await setPromptText(promptEl, '');
    return false;
  }

  vfLog(`Prompt verificado: "${loadedText.substring(0, 30)}..."`, 'info');

  // Enviar
  const submitBtn = findSubmitButton();
  if (submitBtn) {
    submitBtn.click();
    await sleep(500);
    vfLog('Video reenviado a la cola', 'success');
    return true;
  }

  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.querySelector('[class*="arrow_forward"]')) {
      btn.click();
      await sleep(500);
      vfLog('Video reenviado a la cola', 'success');
      return true;
    }
  }

  vfLog('Botón de enviar no encontrado', 'error');
  return false;
}

// ========== PIPELINE EXECUTION ==========

/**
 * Ejecuta el pipeline de generación de videos
 * @param {Array} prompts - Lista de prompts
 * @param {Object} config - Configuración
 */
async function runPipelineMode(prompts, config) {
  const MAX_PARALLEL = 2;
  const CHECK_INTERVAL = 10000;
  const MAX_WAIT_PER_VIDEO = 300000;
  const MAX_RETRIES = 3;

  let pendingPrompts = [...prompts];
  let activePrompts = [];
  let completedCount = 0;
  let failedCount = 0;

  vfLog('═══════════════════════════════════════', 'step');
  vfLog(`PIPELINE: ${prompts.length} videos`, 'step');
  vfLog(`Máximo en paralelo: ${MAX_PARALLEL}`, 'info');
  vfLog(`Reintentos automáticos: ${MAX_RETRIES}`, 'info');
  vfLog('═══════════════════════════════════════', 'step');

  // Crear nuevo proyecto si no estamos dentro de uno
  if (!window.location.href.includes('/project/')) {
    vfLog('Creando nuevo proyecto...', 'step');
    await goToHomeAndCreateProject();
    await sleep(2000);
    // Seleccionar tipo text-to-video
    await selectGenerationType('text-to-video');
    await sleep(1000);
  }

  // Configurar ajustes antes de generar (modelo, orientación, x1)
  try {
    await configureSettings({
      veoModel: config.model || config.veoModel || 'veo-3.1-fast',
      aspectRatio: config.orientation || config.aspectRatio || '9:16',
      resultsPerRequest: config.resultsPerRequest || 1
    });
  } catch (e) {
    vfLog('Error configurando ajustes: ' + e.message, 'warn');
  }

  // Refrescar workflow map para matching API-based
  let baselineMap = new Map();
  try { baselineMap = await getWorkflowMediaMap(true); } catch (e) { /* ignore */ }

  vfLog(`Estado inicial - ${baselineMap.size} workflows existentes`, 'info');

  // Función para llenar cola — con tracking por mediaKey
  async function fillQueue() {
    while (activePrompts.length < MAX_PARALLEL && pendingPrompts.length > 0) {
      const nextPrompt = pendingPrompts.shift();
      const sceneLabel = nextPrompt.sceneNumber ?? (nextPrompt.index + 1);
      vfLog(`[${sceneLabel}/${prompts.length}] Enviando: ${nextPrompt.prompt.substring(0, 35)}...`, 'info');

      // Snapshot mediaKeys ANTES de enviar
      let mapBefore = new Map();
      try { mapBefore = await getWorkflowMediaMap(true); } catch (e) { /* ignore */ }

      const sent = await submitPromptToQueue(nextPrompt.prompt);
      if (sent) {
        // Esperar a que la API registre el nuevo workflow
        await sleep(3000);

        // Diff para encontrar el nuevo mediaKey
        let newMediaKey = null;
        try {
          const mapAfter = await getWorkflowMediaMap(true);
          const newKeys = diffWorkflowMaps(mapBefore, mapAfter);
          if (newKeys.length > 0) {
            newMediaKey = newKeys[0];
            vfLog(`[${sceneLabel}] MediaKey: ${newMediaKey.substring(0, 12)}...`, 'info');
          } else {
            vfLog(`[${sceneLabel}] MediaKey no encontrado aún (se buscará después)`, 'warn');
          }
        } catch (e) { /* ignore */ }

        activePrompts.push({
          ...nextPrompt,
          mediaKey: newMediaKey,
          startTime: Date.now(),
          retryCount: nextPrompt.retryCount || 0
        });
        await sleep(1000);
      } else {
        vfLog(`Error enviando prompt ${sceneLabel}`, 'error');
        failedCount++;
      }
    }
  }

  // Llenar cola inicial
  await fillQueue();

  // Monitorear y procesar
  while (activePrompts.length > 0 || pendingPrompts.length > 0) {
    if (typeof isAutomating !== 'undefined' && !isAutomating) {
      vfLog('Pipeline detenido por usuario', 'warn');
      break;
    }

    await sleep(CHECK_INTERVAL);

    // Refrescar cache al inicio de cada ciclo
    try { await getWorkflowMediaMap(true); } catch (e) { /* ignore */ }

    // Si algún active no tiene mediaKey, intentar encontrarlo
    for (const active of activePrompts) {
      if (!active.mediaKey && _workflowMapCache) {
        // Buscar por prompt text en el cache
        for (const [mk, data] of _workflowMapCache) {
          if (!baselineMap.has(mk) && data.prompt && active.prompt &&
              data.prompt.toLowerCase().trim() === active.prompt.toLowerCase().trim()) {
            active.mediaKey = mk;
            const sceneLabel = active.sceneNumber ?? (active.index + 1);
            vfLog(`[${sceneLabel}] MediaKey encontrado: ${mk.substring(0, 12)}...`, 'info');
            break;
          }
        }
        // Si aún no encontrado, buscar el más reciente no-baseline que no esté asignado
        if (!active.mediaKey) {
          const assignedKeys = new Set(activePrompts.filter(p => p.mediaKey).map(p => p.mediaKey));
          for (const [mk] of _workflowMapCache) {
            if (!baselineMap.has(mk) && !assignedKeys.has(mk)) {
              active.mediaKey = mk;
              const sceneLabel = active.sceneNumber ?? (active.index + 1);
              vfLog(`[${sceneLabel}] MediaKey asignado por exclusión: ${mk.substring(0, 12)}...`, 'info');
              break;
            }
          }
        }
      }
    }

    // Revisar cada prompt activo
    for (let i = activePrompts.length - 1; i >= 0; i--) {
      const active = activePrompts[i];
      const sceneLabel = active.sceneNumber ?? (active.index + 1);

      // Preferir status por mediaKey, fallback a prompt text
      let status;
      if (active.mediaKey) {
        status = getVideoStatusByMediaKey(active.mediaKey);
      } else {
        status = getVideoStatusByPrompt(active.prompt);
      }

      if (status.status === 'COMPLETED') {
        // Check for black screen before downloading
        const card = status.card || findCardByMediaKey(active.mediaKey) || findVideoCardByPrompt(active.prompt);
        const videoEl = card?.querySelector('video[src]');
        if (videoEl && await isBlackScreenVideo(videoEl)) {
          const currentRetries = active.retryCount || 0;
          if (currentRetries < MAX_RETRIES) {
            vfLog(`[${sceneLabel}] Pantalla negra detectada - reintentando (${currentRetries + 1}/${MAX_RETRIES})`, 'warn');
            activePrompts.splice(i, 1);
            pendingPrompts.unshift({ ...active, mediaKey: null, retryCount: currentRetries + 1 });
            await fillQueue();
            continue;
          } else {
            vfLog(`[${sceneLabel}] Pantalla negra tras ${MAX_RETRIES} reintentos - descargando de todas formas`, 'error');
          }
        }

        const sceneNum = active.sceneNumber ?? (active.index + 1);
        const filename = `${String(sceneNum).padStart(3, '0')}_flow_video.mp4`;
        vfLog(`[${sceneNum}] Completado! Descargando...`, 'success');

        // Notificar al background el sceneNumber ANTES de descargar
        try {
          await chrome.runtime.sendMessage({
            action: 'prepareFlowDownload',
            data: { promptText: active.prompt, sceneNumber: sceneNum }
          });
        } catch (e) {
          vfLog('Warn: No se pudo preparar descarga en background', 'warn');
        }

        // Descargar: 1) por mediaKey directo, 2) card+video, 3) fallback prompt
        let downloaded = false;
        if (active.mediaKey) {
          downloaded = await downloadByMediaKey(active.mediaKey, filename);
        }
        if (!downloaded && card) {
          const dlVideoEl = card.querySelector('video[src]');
          downloaded = await downloadViaMoreVertMenu(card, dlVideoEl, filename);
        }
        if (!downloaded) {
          await downloadVideoByPrompt(active.prompt, filename);
        }
        completedCount++;

        activePrompts.splice(i, 1);
        vfLog(`Progreso: ${completedCount}/${prompts.length} completados`, 'info');

        await fillQueue();

      } else if (status.status === 'FAILED') {
        const currentRetries = active.retryCount || 0;

        if (currentRetries < MAX_RETRIES) {
          vfLog(`[${sceneLabel}] Falló - Reintento ${currentRetries + 1}/${MAX_RETRIES}...`, 'warn');

          const retrySuccess = await retryFailedVideo(active.prompt);

          if (retrySuccess) {
            active.startTime = Date.now();
            active.retryCount = currentRetries + 1;
            active.mediaKey = null; // Reset para buscar nuevo mediaKey
            vfLog(`[${sceneLabel}] Reenviado correctamente (intento ${active.retryCount})`, 'success');
          } else {
            // Si no se pudo reintentar via botón, re-enviar como nuevo prompt
            vfLog(`[${sceneLabel}] Reintentando como nuevo prompt...`, 'warn');
            activePrompts.splice(i, 1);
            pendingPrompts.unshift({ ...active, mediaKey: null, retryCount: currentRetries + 1 });
            await fillQueue();
          }
        } else {
          vfLog(`[${sceneLabel}] Falló después de ${MAX_RETRIES} intentos`, 'error');
          failedCount++;
          activePrompts.splice(i, 1);
          await fillQueue();
        }

      } else if (status.status === 'GENERATING') {
        const elapsed = Math.round((Date.now() - active.startTime) / 1000);
        vfLog(`[${sceneLabel}] ${status.progress || 0}% (${elapsed}s)`, 'info');

        if (Date.now() - active.startTime > MAX_WAIT_PER_VIDEO) {
          const currentRetries = active.retryCount || 0;
          if (currentRetries < MAX_RETRIES) {
            vfLog(`[${sceneLabel}] Timeout - reintentando (${currentRetries + 1}/${MAX_RETRIES})...`, 'warn');
            activePrompts.splice(i, 1);
            pendingPrompts.unshift({ ...active, mediaKey: null, retryCount: currentRetries + 1 });
            await fillQueue();
          } else {
            vfLog(`[${sceneLabel}] Timeout después de ${MAX_RETRIES} reintentos - saltando`, 'error');
            failedCount++;
            activePrompts.splice(i, 1);
            await fillQueue();
          }
        }
      } else {
        // NOT_FOUND o PENDING — mostrar elapsed time
        const elapsed = Math.round((Date.now() - active.startTime) / 1000);
        if (elapsed > 30) {
          vfLog(`[${sceneLabel}] Esperando (${status.status}, ${elapsed}s)...`, 'info');
        }
      }
    }

    // Resumen
    const activePromptsStr = activePrompts.map(p => `#${p.sceneNumber ?? (p.index + 1)}`).join(', ');
    vfLog(`Activos [${activePrompts.length}]: ${activePromptsStr || 'ninguno'} | Pendientes: ${pendingPrompts.length}`, 'info');
  }

  vfLog('═══════════════════════════════════════', 'step');
  vfLog(`PIPELINE COMPLETADO`, 'success');
  vfLog(`Completados: ${completedCount}`, 'success');
  vfLog(`Fallidos: ${failedCount}`, failedCount > 0 ? 'error' : 'info');
  vfLog('═══════════════════════════════════════', 'step');

  return { completed: completedCount, failed: failedCount };
}

console.log('VidFlow: pipeline.js cargado');
