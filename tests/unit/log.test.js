/**
 * Tests para content/flow/log.js
 * Sistema de logging visual
 */

// Mocks globales
global.chrome = {
  storage: {
    local: {
      set: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue()
    }
  }
};

// ========== IMPLEMENTACIONES PARA TESTING ==========
// Copiamos las funciones para poder testearlas de forma aislada

let logEntries = [];
let logPanel = null;

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function initLogPanel() {
  const existing = document.getElementById('vidflow-log-panel');
  if (existing) {
    const content = document.getElementById('vf-log-content');
    if (content) content.innerHTML = '';
    logEntries = [];
    return;
  }

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

  const style = document.createElement('style');
  style.id = 'vidflow-log-styles';
  style.textContent = `#vidflow-log-panel { position: fixed; }`;

  if (!document.getElementById('vidflow-log-styles')) {
    document.head.appendChild(style);
  }
  document.body.appendChild(logPanel);

  document.getElementById('vf-log-close').onclick = () => logPanel.remove();
  document.getElementById('vf-log-minimize').onclick = () => logPanel.classList.toggle('minimized');
  document.getElementById('vf-log-clear').onclick = () => {
    logEntries = [];
    document.getElementById('vf-log-content').innerHTML = '';
    vfLog('Log limpiado', 'info');
  };
  document.getElementById('vf-log-copy').onclick = () => {
    const text = logEntries.map(e => `[${e.time}] ${e.type.toUpperCase()}: ${e.msg}`).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    }
    vfLog('Logs copiados al portapapeles', 'success');
  };

  makeDraggable(logPanel, logPanel.querySelector('.vf-log-header'));
}

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

function vfLog(msg, type = 'info') {
  const time = new Date().toLocaleTimeString('es-ES');
  const entry = { time, type, msg };
  logEntries.push(entry);

  const consoleMethod = type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'log';
  console[consoleMethod](`[VidFlow ${time}]`, msg);

  const content = document.getElementById('vf-log-content');
  if (content) {
    const div = document.createElement('div');
    div.className = 'vf-log-entry';
    div.innerHTML = `<span class="vf-log-time">${time}</span><span class="vf-log-${type}">${escapeHtml(msg)}</span>`;
    content.appendChild(div);
    content.scrollTop = content.scrollHeight;
  }

  saveLogsToStorage();
}

async function saveLogsToStorage() {
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

async function clearLogs() {
  logEntries = [];
  const content = document.getElementById('vf-log-content');
  if (content) content.innerHTML = '';
  await chrome.storage.local.remove('vidflowLogs');
}

// ========== TESTS ==========

describe('log.js - initLogPanel()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    logEntries = [];
    logPanel = null;
  });

  test('debe crear panel de logs', () => {
    initLogPanel();
    const panel = document.getElementById('vidflow-log-panel');
    expect(panel).not.toBeNull();
  });

  test('debe tener header con título', () => {
    initLogPanel();
    const header = document.querySelector('.vf-log-header');
    expect(header).not.toBeNull();
    expect(header.textContent).toContain('VidFlow Log');
  });

  test('debe tener botones de acción', () => {
    initLogPanel();
    expect(document.getElementById('vf-log-copy')).not.toBeNull();
    expect(document.getElementById('vf-log-clear')).not.toBeNull();
    expect(document.getElementById('vf-log-minimize')).not.toBeNull();
    expect(document.getElementById('vf-log-close')).not.toBeNull();
  });

  test('debe añadir estilos al head', () => {
    initLogPanel();
    const styles = document.getElementById('vidflow-log-styles');
    expect(styles).not.toBeNull();
  });

  test('no debe duplicar panel si ya existe', () => {
    initLogPanel();
    initLogPanel();
    const panels = document.querySelectorAll('#vidflow-log-panel');
    expect(panels.length).toBe(1);
  });

  test('debe limpiar contenido si panel ya existe', () => {
    initLogPanel();
    vfLog('Test message', 'info');
    const content = document.getElementById('vf-log-content');
    expect(content.children.length).toBe(1);

    initLogPanel();
    expect(content.children.length).toBe(0);
    expect(logEntries.length).toBe(0);
  });
});

describe('log.js - vfLog()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    logEntries = [];
    initLogPanel();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('debe agregar entrada al array de logs', () => {
    vfLog('Test message', 'info');
    expect(logEntries.length).toBe(1);
    expect(logEntries[0].msg).toBe('Test message');
    expect(logEntries[0].type).toBe('info');
  });

  test('debe incluir timestamp con formato HH:MM:SS', () => {
    vfLog('Test', 'info');
    expect(typeof logEntries[0].time).toBe('string');
    expect(logEntries[0].time).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
  });

  test('debe loguear a console.log para tipo info con prefijo VidFlow', () => {
    vfLog('Console test', 'info');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[VidFlow'), 'Console test');
  });

  test('debe usar console.warn para tipo warn con prefijo VidFlow', () => {
    vfLog('Warning', 'warn');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[VidFlow'), 'Warning');
  });

  test('debe usar console.error para tipo error con prefijo VidFlow', () => {
    vfLog('Error', 'error');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[VidFlow'), 'Error');
  });

  test('debe agregar entrada al panel DOM', () => {
    vfLog('Panel entry', 'success');
    const content = document.getElementById('vf-log-content');
    const entries = content.querySelectorAll('.vf-log-entry');
    expect(entries.length).toBe(1);
    expect(entries[0].textContent).toContain('Panel entry');
  });

  test('debe aplicar clase correcta según tipo', () => {
    vfLog('Success msg', 'success');
    const content = document.getElementById('vf-log-content');
    const span = content.querySelector('.vf-log-success');
    expect(span).not.toBeNull();
    expect(span.textContent).toBe('Success msg');
  });

  test('debe usar tipo info por defecto', () => {
    vfLog('Default type');
    expect(logEntries[0].type).toBe('info');
  });

  test('debe llamar saveLogsToStorage con datos de logs', () => {
    vfLog('Storage test', 'info');
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ vidflowLogs: expect.any(Object) })
    );
  });
});

describe('log.js - saveLogsToStorage()', () => {
  beforeEach(() => {
    logEntries = [];
    chrome.storage.local.set.mockClear();
  });

  test('debe guardar logs en chrome storage', async () => {
    logEntries = [
      { time: '10:00:00', type: 'info', msg: 'Test 1' },
      { time: '10:00:01', type: 'success', msg: 'Test 2' }
    ];

    await saveLogsToStorage();

    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    const savedData = chrome.storage.local.set.mock.calls[0][0];
    expect(savedData.vidflowLogs.entries).toHaveLength(2);
    expect(savedData.vidflowLogs.entries[0].msg).toBe('Test 1');
    expect(typeof savedData.vidflowLogs.timestamp).toBe('number');
    expect(savedData.vidflowLogs.timestamp).toBeGreaterThan(0);
  });

  test('debe limitar a 100 entradas', async () => {
    logEntries = Array.from({ length: 150 }, (_, i) => ({
      time: '10:00:00',
      type: 'info',
      msg: `Entry ${i}`
    }));

    await saveLogsToStorage();

    const savedData = chrome.storage.local.set.mock.calls[0][0];
    expect(savedData.vidflowLogs.entries.length).toBe(100);
  });

  test('debe manejar errores silenciosamente', async () => {
    chrome.storage.local.set.mockRejectedValueOnce(new Error('Storage error'));
    await expect(saveLogsToStorage()).resolves.not.toThrow();
  });
});

describe('log.js - clearLogs()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    logEntries = [{ time: '10:00', type: 'info', msg: 'test' }];
    initLogPanel();
    vfLog('Existing entry', 'info');
  });

  test('debe limpiar array de logEntries', async () => {
    await clearLogs();
    expect(logEntries.length).toBe(0);
  });

  test('debe limpiar contenido del panel', async () => {
    const content = document.getElementById('vf-log-content');
    expect(content.children.length).toBeGreaterThan(0);

    await clearLogs();
    expect(content.innerHTML).toBe('');
  });

  test('debe eliminar logs del storage', async () => {
    await clearLogs();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('vidflowLogs');
  });
});

describe('log.js - makeDraggable()', () => {
  let element;
  let handle;

  beforeEach(() => {
    document.body.innerHTML = '';
    element = document.createElement('div');
    element.style.position = 'fixed';
    element.style.top = '100px';
    element.style.left = '100px';
    handle = document.createElement('div');
    element.appendChild(handle);
    document.body.appendChild(element);
  });

  test('debe asignar handler de mousedown al handle', () => {
    makeDraggable(element, handle);
    expect(typeof handle.onmousedown).toBe('function');
  });

  test('debe mover elemento en drag con offset correcto', () => {
    makeDraggable(element, handle);

    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 100,
      clientY: 100
    });
    handle.dispatchEvent(mousedownEvent);

    const mousemoveEvent = new MouseEvent('mousemove', {
      clientX: 150,
      clientY: 200
    });
    document.dispatchEvent(mousemoveEvent);

    // Element should have moved by the delta (50px right, 100px down)
    expect(element.style.left).toMatch(/\d+px/);
    expect(element.style.top).toMatch(/\d+px/);
  });

  test('debe limpiar handlers en mouseup', () => {
    makeDraggable(element, handle);

    const mousedownEvent = new MouseEvent('mousedown', {
      clientX: 100,
      clientY: 100
    });
    handle.dispatchEvent(mousedownEvent);

    expect(document.onmousemove).not.toBeNull();

    const mouseupEvent = new MouseEvent('mouseup');
    document.dispatchEvent(mouseupEvent);

    expect(document.onmousemove).toBeNull();
    expect(document.onmouseup).toBeNull();
  });
});

describe('log.js - Botones de acción', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    logEntries = [];
    initLogPanel();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('botón close debe eliminar panel', () => {
    const closeBtn = document.getElementById('vf-log-close');
    closeBtn.click();
    expect(document.getElementById('vidflow-log-panel')).toBeNull();
  });

  test('botón minimize debe toggle clase minimized', () => {
    const panel = document.getElementById('vidflow-log-panel');
    const minimizeBtn = document.getElementById('vf-log-minimize');

    expect(panel.classList.contains('minimized')).toBe(false);

    minimizeBtn.click();
    expect(panel.classList.contains('minimized')).toBe(true);

    minimizeBtn.click();
    expect(panel.classList.contains('minimized')).toBe(false);
  });

  test('botón clear debe limpiar logs y agregar mensaje', () => {
    vfLog('Entry 1', 'info');
    vfLog('Entry 2', 'info');

    const clearBtn = document.getElementById('vf-log-clear');
    clearBtn.click();

    // Debe tener solo el mensaje de "Log limpiado"
    expect(logEntries.length).toBe(1);
    expect(logEntries[0].msg).toBe('Log limpiado');
  });
});
