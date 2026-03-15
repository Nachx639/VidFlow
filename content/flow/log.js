/**
 * VidFlow - Sistema de Logs
 * Panel visual de logs y funciones de logging
 */

// ========== LOG STATE ==========
// var allows re-declaration without error when script is injected multiple times
var logEntries = logEntries || [];
var logPanel = logPanel || null;
var MAX_LOG_ENTRIES = 500;

// ========== LOG PANEL ==========

/**
 * Inicializa el panel de logs visual
 */
function initLogPanel() {
  // Si ya existe un panel, NO limpiar los logs (mantener historial entre acciones)
  const existing = document.getElementById('vidflow-log-panel');
  if (existing) {
    return;
  }

  // Crear panel
  logPanel = document.createElement('div');
  logPanel.id = 'vidflow-log-panel';
  logPanel.innerHTML = `
    <div class="vf-log-header">
      <span>VidFlow Log</span>
      <div class="vf-log-actions">
        <button id="vf-log-copy" title="Copiar logs">Copy</button>
        <button id="vf-log-clear" title="Limpiar">Clear</button>
        <button id="vf-log-minimize" title="Minimizar">_</button>
        <button id="vf-log-close" title="Cerrar">X</button>
      </div>
    </div>
    <div class="vf-log-content" id="vf-log-content"></div>
  `;

  // Estilos
  const style = document.createElement('style');
  style.id = 'vidflow-log-styles';
  style.textContent = `
    #vidflow-log-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      max-height: 300px;
      background: #1a1b2e;
      border: 1px solid #f97316;
      border-radius: 10px;
      font-family: 'Monaco', 'Consolas', monospace;
      font-size: 11px;
      z-index: 999999;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #vidflow-log-panel.minimized {
      max-height: 36px;
    }
    #vidflow-log-panel.minimized .vf-log-content {
      display: none;
    }
    .vf-log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: #f97316;
      color: white;
      font-weight: bold;
      font-size: 12px;
      cursor: move;
    }
    .vf-log-actions {
      display: flex;
      gap: 4px;
    }
    .vf-log-actions button {
      background: transparent;
      border: none;
      color: white;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    .vf-log-actions button:hover {
      background: rgba(255,255,255,0.2);
    }
    .vf-log-content {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      max-height: 260px;
    }
    .vf-log-entry {
      padding: 3px 0;
      border-bottom: 1px solid #2d2f47;
      line-height: 1.4;
    }
    .vf-log-entry:last-child {
      border-bottom: none;
    }
    .vf-log-time {
      color: #71717a;
      margin-right: 8px;
    }
    .vf-log-info { color: #60a5fa; }
    .vf-log-success { color: #4ade80; }
    .vf-log-warn { color: #fbbf24; }
    .vf-log-error { color: #f87171; }
    .vf-log-step { color: #f97316; font-weight: bold; }
  `;

  // Solo añadir estilos si no existen
  if (!document.getElementById('vidflow-log-styles')) {
    document.head.appendChild(style);
  }
  document.body.appendChild(logPanel);

  // Event listeners
  document.getElementById('vf-log-close').onclick = () => logPanel.remove();
  document.getElementById('vf-log-minimize').onclick = () => logPanel.classList.toggle('minimized');
  document.getElementById('vf-log-clear').onclick = () => {
    logEntries = [];
    document.getElementById('vf-log-content').innerHTML = '';
    vfLog('Log limpiado', 'info');
  };
  document.getElementById('vf-log-copy').onclick = () => {
    const text = logEntries.map(e => `[${e.time}] ${e.type.toUpperCase()}: ${e.msg}`).join('\n');
    navigator.clipboard.writeText(text);
    vfLog('Logs copiados al portapapeles', 'success');
  };

  // Hacer draggable
  makeDraggable(logPanel, logPanel.querySelector('.vf-log-header'));
}

/**
 * Hace un elemento arrastrable
 * @param {Element} element - Elemento a arrastrar
 * @param {Element} handle - Elemento que actúa como handle
 */
function makeDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  handle.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

/**
 * Registra un mensaje en el log
 * @param {string} msg - Mensaje
 * @param {string} type - Tipo: info, success, warn, error, step
 */
function vfLog(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('es-ES');
  const entry = { time, type, msg };
  logEntries.push(entry);

  // Cap log entries to prevent memory leaks
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
  }

  // Console
  const consoleMethod = type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'log';
  console[consoleMethod](`[VidFlow ${time}]`, msg);

  // Panel
  const content = document.getElementById('vf-log-content');
  if (content) {
    const div = document.createElement('div');
    div.className = 'vf-log-entry';
    div.innerHTML = `<span class="vf-log-time">${time}</span><span class="vf-log-${type}">${escapeHtml(msg)}</span>`;
    content.appendChild(div);
    content.scrollTop = content.scrollHeight;
  }

  // Guardar en storage
  saveLogsToStorage();
}

/**
 * Guarda logs en storage (debounced para no saturar chrome.storage en el hot path)
 * En un batch de 58 videos, vfLog() se llama cientos de veces.
 * Sin debounce: cientos de chrome.storage.local.set() en el critical path.
 * Con debounce (2s): ~1 write por cada ráfaga de logs.
 */
var _logSaveTimer = _logSaveTimer || null;
async function saveLogsToStorage() {
  if (_logSaveTimer) clearTimeout(_logSaveTimer);
  _logSaveTimer = setTimeout(async () => {
    try {
      await chrome.storage.local.set({
        vidflowLogs: {
          timestamp: Date.now(),
          entries: logEntries.slice(-100) // Últimas 100 entradas
        }
      });
    } catch (e) {
      // Ignorar errores de storage
    }
  }, 2000);
}

/**
 * Fuerza guardar logs inmediatamente (para antes de cerrar/parar)
 */
async function flushLogsToStorage() {
  if (_logSaveTimer) {
    clearTimeout(_logSaveTimer);
    _logSaveTimer = null;
  }
  try {
    await chrome.storage.local.set({
      vidflowLogs: {
        timestamp: Date.now(),
        entries: logEntries.slice(-100)
      }
    });
  } catch (e) {
    // Ignorar errores de storage
  }
}

/**
 * Limpia todos los logs
 */
async function clearLogs() {
  logEntries = [];
  const content = document.getElementById('vf-log-content');
  if (content) content.innerHTML = '';
  await chrome.storage.local.remove('vidflowLogs');
}

console.log('VidFlow: log.js cargado');
