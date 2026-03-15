/**
 * VidFlow - Utilidades
 * Funciones de utilidad compartidas
 */

// ========== UTILITIES ==========

/**
 * Pausa la ejecución por un tiempo determinado
 * @param {number} ms - Milisegundos a esperar
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convierte un string base64 a Blob
 * @param {string} base64 - String en formato base64
 * @returns {Promise<Blob>}
 */
async function base64ToBlob(base64) {
  const response = await fetch(base64);
  return await response.blob();
}

/**
 * Escapa HTML para evitar XSS
 * @param {string} text - Texto a escapar
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Verifica si hay un error de rate limit en la UI de Flow
 * @returns {string|null} Mensaje de error o null si no hay error
 */
function checkForRateLimitError() {
  // Buscar mensajes de error comunes de rate limit en el DOM
  const errorPatterns = [
    'gran número de solicitudes',
    'too many requests',
    'rate limit',
    'intentarlo en unos minutos',
    'try again later',
    'demasiadas solicitudes',
    'temporarily unavailable',
    'service unavailable',
    'temporalmente no disponible'
  ];

  // Buscar en todo el documento
  const allText = document.body?.innerText?.toLowerCase() || '';

  for (const pattern of errorPatterns) {
    if (allText.includes(pattern.toLowerCase())) {
      // Intentar encontrar el elemento específico con el error
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const elText = el.textContent?.toLowerCase() || '';
        if (elText.includes(pattern.toLowerCase()) && el.textContent.length < 500) {
          return el.textContent.trim();
        }
      }
      return pattern;
    }
  }

  // También verificar si hay snackbars o toasts de error
  const snackbars = document.querySelectorAll('[role="alert"], [class*="snackbar"], [class*="toast"], [class*="error"]');
  for (const snack of snackbars) {
    const text = snack.textContent?.toLowerCase() || '';
    for (const pattern of errorPatterns) {
      if (text.includes(pattern.toLowerCase())) {
        return snack.textContent.trim();
      }
    }
  }

  return null;
}

/**
 * Encuentra elementos que contengan alguno de los textos especificados
 * @param {Array<string>} texts - Textos a buscar
 * @param {string|null} tagFilter - Filtro de tag (ej: 'button')
 * @returns {Element|null}
 */
function findElement(texts, tagFilter = null) {
  const allElements = document.querySelectorAll(tagFilter || '*');

  for (const el of allElements) {
    const elText = el.textContent?.trim().toLowerCase();
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
    const placeholder = el.getAttribute('placeholder')?.toLowerCase();

    for (const searchText of texts) {
      const search = searchText.toLowerCase();

      if (elText === search ||
          elText?.includes(search) ||
          ariaLabel?.includes(search) ||
          placeholder?.includes(search)) {

        // Si es un botón o elemento interactivo, devolverlo
        if (el.tagName === 'BUTTON' ||
            el.tagName === 'A' ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('role') === 'option' ||
            el.getAttribute('role') === 'menuitem' ||
            el.onclick ||
            el.closest('button')) {
          return el.closest('button') || el;
        }

        // Si no se especificó filtro, devolver el elemento
        if (!tagFilter) {
          return el;
        }
      }
    }
  }

  return null;
}

/**
 * Helper para buscar elementos dentro del panel de ajustes
 * @param {Array<string>} texts - Textos a buscar
 * @returns {Element|null}
 */
function findElementInSettings(texts) {
  // El panel de ajustes puede ser un [role="dialog"] o estar directamente en la página (nuevo Flow)
  const settingsPanel = document.querySelector('[role="dialog"]');

  const searchArea = settingsPanel || document;

  if (!settingsPanel) {
    vfLog('Panel de ajustes (dialog) no encontrado, buscando en página', 'info');
  }

  // Buscar en comboboxes primero (compatibilidad con diseño anterior)
  const comboboxes = searchArea.querySelectorAll('[role="combobox"]');
  for (const cb of comboboxes) {
    const cbText = cb.textContent?.trim().toLowerCase() || '';
    for (const searchText of texts) {
      const search = searchText.toLowerCase();
      if (cbText.includes(search)) {
        vfLog('Combobox encontrado: ' + cbText.substring(0, 30), 'info');
        return cb;
      }
    }
  }

  // Buscar en botones y otros elementos
  const allElements = searchArea.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"]');
  for (const el of allElements) {
    const elText = el.textContent?.trim().toLowerCase() || '';
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';

    for (const searchText of texts) {
      const search = searchText.toLowerCase();
      if (elText.includes(search) || ariaLabel.includes(search)) {
        return el;
      }
    }
  }
  return null;
}

/**
 * Helper para seleccionar opción en un listbox abierto
 * @param {Array<string>} targetTexts - Textos de la opción a seleccionar
 * @returns {Promise<boolean>}
 */
async function selectOptionInListbox(targetTexts) {
  await sleep(300);
  const listbox = document.querySelector('[role="listbox"]');
  if (!listbox) {
    vfLog('Listbox no encontrado', 'warn');
    return false;
  }

  const options = listbox.querySelectorAll('[role="option"]');
  for (const opt of options) {
    const optText = opt.textContent?.toLowerCase() || '';
    for (const target of targetTexts) {
      if (optText.includes(target.toLowerCase())) {
        opt.click();
        vfLog('Opción seleccionada: ' + optText.substring(0, 30), 'success');
        return true;
      }
    }
  }
  vfLog('Opción no encontrada en listbox', 'warn');
  return false;
}

/**
 * Encuentra el prompt input real de Flow (nuevo diseño usa contenteditable div)
 * Excluye reCAPTCHA y OpenClaw textareas
 * @returns {Element|null}
 */
function findPromptInput() {
  // 1. Nuevo Flow: div contenteditable con role="textbox"
  const textbox = document.querySelector('[role="textbox"][contenteditable="true"]');
  if (textbox && textbox.getBoundingClientRect().height > 0) {
    return textbox;
  }

  // 2. Fallback: textarea visible que NO sea reCAPTCHA ni OpenClaw
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    if (ta.closest('.grecaptcha-badge')) continue;
    if (ta.closest('#openclaw-bot-panel')) continue;
    if (ta.placeholder?.includes('Paste prompts')) continue;
    if (ta.getBoundingClientRect().height > 0) return ta;
  }

  // 3. Fallback genérico
  return document.querySelector('[contenteditable="true"]');
}

/**
 * Encuentra el botón de submit/crear del prompt.
 * Distingue entre el submit real (arrow_forward + Crear) y otros botones "Crear".
 * @returns {Element|null}
 */
function findSubmitButton() {
  const buttons = document.querySelectorAll('button');

  // 1. Buscar botón con "arrow_forward" en su texto (icono Material)
  for (const btn of buttons) {
    const text = btn.textContent || '';
    if (text.includes('arrow_forward') && /crear|create|generar|generate/i.test(text)) {
      return btn;
    }
  }

  // 2. Buscar botón cercano al prompt input (dentro del mismo contenedor)
  const promptEl = findPromptInput();
  if (promptEl) {
    // Subir hasta un contenedor razonable y buscar botones con Crear/Create
    let container = promptEl.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      const btns = container.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        // Excluir botones con "add" icon prefix (son para añadir archivos)
        if ((text.includes('crear') || text.includes('create')) &&
            !text.includes('add_2') && !text.includes('add ') && !text.includes('añadir')) {
          return btn;
        }
      }
      container = container.parentElement;
    }
  }

  // 3. Fallback genérico (el viejo método, excluyendo falsos positivos)
  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    if ((text === 'crear' || text === 'create') && !btn.closest('[class*="container"]')) {
      return btn;
    }
  }

  return null;
}

/**
 * Establece el texto de un prompt input (textarea o contenteditable)
 * Para Slate editor: comunica con slate-bridge.js (MAIN world) via postMessage
 * @param {Element} promptEl - El elemento del prompt
 * @param {string} text - El texto a establecer
 */
async function setPromptText(promptEl, text) {
  if (!promptEl) return;
  promptEl.focus();

  if (promptEl.tagName === 'TEXTAREA' || promptEl.tagName === 'INPUT') {
    promptEl.value = text;
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Slate editor: comunicar con slate-bridge.js (MAIN world) via postMessage
  if (promptEl.hasAttribute('data-slate-editor')) {
    await _setSlateText(text);
    return;
  }

  // Fallback: execCommand para otros contenteditable
  document.execCommand('selectAll', false, null);
  if (text) {
    document.execCommand('insertText', false, text);
  } else {
    document.execCommand('delete', false, null);
  }
}

/**
 * Comunica con slate-bridge.js (MAIN world) via postMessage para establecer
 * texto en el editor Slate. Usa un protocolo request/response con IDs únicos.
 * @param {string} text - Texto a establecer en el editor (vacío para limpiar)
 * @returns {Promise<boolean>} - true si se estableció correctamente
 */
function _setSlateText(text) {
  return new Promise((resolve) => {
    const id = 'vf-slate-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      console.warn('VidFlow: Slate bridge timeout');
      resolve(false);
    }, 3000);

    function handler(event) {
      if (event.data?.source !== 'vidflow-slate-response' || event.data?.id !== id) return;
      window.removeEventListener('message', handler);
      clearTimeout(timeout);
      if (event.data.success) {
        console.log('VidFlow: Slate text set via bridge, length:', event.data.length);
      } else {
        console.warn('VidFlow: Slate bridge error:', event.data.error);
      }
      resolve(event.data.success);
    }

    window.addEventListener('message', handler);
    window.postMessage({
      source: 'vidflow-slate-request',
      id: id,
      action: 'setText',
      text: text || ''
    }, '*');
  });
}

/**
 * Obtiene el texto actual de un prompt input
 * Para Slate: si existe [data-slate-placeholder], el editor está vacío
 * @param {Element} promptEl - El elemento del prompt
 * @returns {string}
 */
function getPromptText(promptEl) {
  if (!promptEl) return '';
  if (promptEl.tagName === 'TEXTAREA' || promptEl.tagName === 'INPUT') {
    return promptEl.value?.trim() || '';
  }
  // Slate muestra placeholder como hijo cuando está vacío
  if (promptEl.querySelector('[data-slate-placeholder]')) {
    return '';
  }
  return promptEl.textContent?.trim() || '';
}

/**
 * Espera a que la página esté lista
 * @returns {Promise<void>}
 */
async function waitForPageReady() {
  const maxWait = 15000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const hasPromptInput = findPromptInput();
    const hasButtons = document.querySelectorAll('button').length > 2;

    if (hasPromptInput || hasButtons) {
      await sleep(1000);
      console.log('Page ready');
      return;
    }

    await sleep(500);
  }

  throw new Error('Page did not load properly');
}

/**
 * Muestra un badge de debug temporal
 * @param {string} text - Texto a mostrar
 * @param {number} duration - Duración en ms
 */
function showDebugBadge(text, duration = 3000) {
  const existingBadge = document.getElementById('vidflow-debug-badge');
  if (existingBadge) existingBadge.remove();

  const badge = document.createElement('div');
  badge.id = 'vidflow-debug-badge';
  badge.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 10px;
    background: #f97316;
    color: white;
    padding: 10px 16px;
    border-radius: 8px;
    z-index: 999999;
    font-size: 13px;
    font-weight: 500;
    font-family: system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    animation: vf-fade-in 0.3s ease;
  `;
  badge.textContent = text;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes vf-fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(badge);

  if (duration > 0) {
    setTimeout(() => badge.remove(), duration);
  }
}

// ========== API-BASED VIDEO MATCHING (Nuevo Flow 2025) ==========

/**
 * Cache del mapa de workflows para evitar llamadas API repetidas
 */
var _workflowMapCache = _workflowMapCache || null;
var _workflowMapCacheTime = _workflowMapCacheTime || 0;
var WORKFLOW_MAP_TTL = 5000; // 5s de cache

/**
 * Obtiene el mapa de workflows del proyecto via API interna de Google Flow.
 * Retorna Map<mediaKey, {workflowId, prompt, createTime}>
 * @param {boolean} forceRefresh - Forzar recarga ignorando cache
 * @returns {Promise<Map>}
 */
async function getWorkflowMediaMap(forceRefresh = false) {
  if (!forceRefresh && _workflowMapCache && Date.now() - _workflowMapCacheTime < WORKFLOW_MAP_TTL) {
    return _workflowMapCache;
  }

  const projectId = window.location.href.split('/project/')[1]?.split(/[?#]/)[0];
  if (!projectId) return new Map();

  try {
    const input = {
      json: {
        pageSize: 100, projectId, toolName: "PINHOLE",
        fetchBookmarked: false, rawQuery: "", mediaType: "MEDIA_TYPE_VIDEO"
      }
    };
    const apiUrl = `/fx/api/trpc/project.searchProjectWorkflows?input=${encodeURIComponent(JSON.stringify(input))}`;
    const resp = await fetch(apiUrl);
    const data = await resp.json();
    const workflows = data?.result?.data?.json?.result?.workflows || [];

    const map = new Map();
    for (const w of workflows) {
      const step = w.workflowSteps?.[0];
      const gen = step?.mediaGenerations?.[0];
      const mk = gen?.mediaGenerationId?.mediaKey;
      const prompt =
        gen?.mediaData?.videoData?.generatedVideo?.prompt ||
        gen?.mediaExtraData?.mediaTitle ||
        step?.workflowStepLog?.requestData?.promptInputs?.[0]?.textInput || '';
      const hasVideo = !!gen?.mediaData?.videoData;
      const genStatus = gen?.mediaGenerationStatus || gen?.state || '';
      if (mk) {
        map.set(mk, { workflowId: w.workflowId, prompt, createTime: w.createTime, hasVideo, genStatus });
      }
    }

    _workflowMapCache = map;
    _workflowMapCacheTime = Date.now();
    return map;
  } catch (e) {
    console.warn('VidFlow: Error fetching workflow map:', e.message);
    return _workflowMapCache || new Map();
  }
}

/**
 * Extrae el mediaKey del src de un video
 * Soporta URLs tipo: /media.getMediaUrlRedirect?name={mediaKey}
 * @param {string} src - URL del video
 * @returns {string|null}
 */
function extractMediaKeyFromVideoSrc(src) {
  if (!src) return null;
  const match = src.match(/name=([^&]+)/);
  return match ? match[1] : null;
}

/**
 * Encuentra un card del DOM por su mediaKey (buscando en video src)
 * @param {string} mediaKey - El mediaKey del workflow
 * @returns {Element|null} - El card container con data-tile-id
 */
function findCardByMediaKey(mediaKey) {
  if (!mediaKey) return null;
  const videos = document.querySelectorAll('video[src]');
  for (const v of videos) {
    if (v.src.includes(mediaKey)) {
      // Subir hasta encontrar el contenedor con data-tile-id
      let el = v;
      for (let i = 0; i < 12 && el; i++) {
        if (el.getAttribute?.('data-tile-id')) return el;
        el = el.parentElement;
      }
      return v.parentElement; // Fallback
    }
  }
  return null;
}

/**
 * Obtiene el estado de un video por su mediaKey.
 * Primero busca en DOM (video element = completed, error text = failed),
 * luego cae al cache de workflow map para status API.
 * @param {string} mediaKey - El mediaKey del workflow
 * @returns {Object} - {status: string, progress: number|null, card: Element|null}
 */
function getVideoStatusByMediaKey(mediaKey) {
  if (!mediaKey) return { status: 'NOT_FOUND', progress: null, card: null };

  // Check DOM: buscar card con video src que contenga mediaKey
  const card = findCardByMediaKey(mediaKey);
  if (card) {
    const cardText = card.innerText || '';

    if (cardText.includes('No se ha podido') || cardText.includes('Error') || cardText.includes("can't generate")) {
      return { status: 'FAILED', progress: null, card };
    }

    const videoEl = card.querySelector('video[src]');
    if (videoEl && isValidVideoUrl(videoEl.src)) {
      return { status: 'COMPLETED', progress: 100, card };
    }

    // Buscar porcentaje de progreso
    const allPercents = cardText.match(/\b(\d{1,3})%/g) || [];
    for (const pMatch of allPercents) {
      const percent = parseInt(pMatch);
      if (percent >= 0 && percent <= 100) {
        return { status: 'GENERATING', progress: percent, card };
      }
    }

    return { status: 'GENERATING', progress: 0, card };
  }

  // No card in DOM — check workflow map cache
  if (_workflowMapCache) {
    const wf = _workflowMapCache.get(mediaKey);
    if (wf) {
      if (wf.hasVideo) return { status: 'COMPLETED', progress: 100, card: null };
      // Has entry in API but no card in DOM → still generating
      return { status: 'GENERATING', progress: 0, card: null };
    }
  }

  // mediaKey not found in DOM or cache — might be too early
  return { status: 'PENDING', progress: 0, card: null };
}

/**
 * Identifica nuevos workflows comparando snapshots del workflow map.
 * @param {Map} mapBefore - Snapshot antes de enviar el prompt
 * @param {Map} mapAfter - Snapshot después de enviar el prompt
 * @returns {Array<string>} - Nuevos mediaKeys
 */
function diffWorkflowMaps(mapBefore, mapAfter) {
  const newKeys = [];
  for (const key of mapAfter.keys()) {
    if (!mapBefore.has(key)) {
      newKeys.push(key);
    }
  }
  return newKeys;
}

/**
 * Verifica si una URL de video es válida (nuevo o viejo formato)
 * @param {string} url
 * @returns {boolean}
 */
function isValidVideoUrl(url) {
  if (!url) return false;
  return url.includes('storage.googleapis.com') ||
         url.includes('getMediaUrlRedirect') ||
         url.includes('media.getMedia') ||
         url.includes('googleusercontent.com');
}

/**
 * Descarga un video directamente via fetch + blob desde la API de Google Flow.
 * La URL de redirect (/media.getMediaUrlRedirect) ya devuelve 720p por defecto.
 * @param {Element} card - El card container (con data-tile-id)
 * @param {Element} videoElement - El elemento <video> dentro del card
 * @param {string} [filename] - Nombre del archivo de descarga (ej: '003_flow_video.mp4')
 * @returns {Promise<boolean>} - true si se inició la descarga
 */
async function downloadViaMoreVertMenu(card, videoElement, filename) {
  // Obtener el src del video
  const videoSrc = videoElement?.src || videoElement?.currentSrc || card?.querySelector('video[src]')?.src;
  const mediaKey = extractMediaKeyFromVideoSrc(videoSrc);

  if (!mediaKey) {
    vfLog('No se pudo extraer mediaKey del video para descarga directa', 'warn');
    return false;
  }

  try {
    const url = `/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaKey}`;
    vfLog(`Descarga directa via API (720p): ${mediaKey.substring(0, 12)}...`, 'info');

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const blob = await resp.blob();
    if (blob.size < 10000) {
      vfLog(`Blob demasiado pequeño (${blob.size} bytes), posible error`, 'warn');
      return false;
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'flow_video.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Liberar blob URL después de 60s (dar tiempo a Chrome para iniciar descarga)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

    vfLog(`Descarga 720p iniciada: ${a.download} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`, 'success');
    return true;
  } catch (e) {
    vfLog(`Error en descarga directa: ${e.message}`, 'warn');
    return false;
  }
}

/**
 * Descarga un video directamente por su mediaKey (sin necesitar card del DOM).
 * @param {string} mediaKey - El mediaKey del video
 * @param {string} filename - Nombre del archivo
 * @returns {Promise<boolean>}
 */
async function downloadByMediaKey(mediaKey, filename) {
  if (!mediaKey) return false;
  try {
    const url = `/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaKey}`;
    vfLog(`Descarga directa por mediaKey: ${mediaKey.substring(0, 12)}...`, 'info');

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const blob = await resp.blob();
    if (blob.size < 10000) {
      vfLog(`Blob demasiado pequeño (${blob.size} bytes)`, 'warn');
      return false;
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'flow_video.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

    vfLog(`Descarga iniciada: ${a.download} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`, 'success');
    return true;
  } catch (e) {
    vfLog(`Error descarga por mediaKey: ${e.message}`, 'warn');
    return false;
  }
}

console.log('VidFlow: utils.js cargado');
