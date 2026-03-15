/**
 * Jest Setup File
 * Configura el entorno de testing para VidFlow
 */

// Importar mocks de Chrome API
require('./mocks/chrome-api');

// Configuración global de timeouts
jest.setTimeout(10000);

// Limpiar mocks después de cada test
afterEach(() => {
  jest.clearAllMocks();
});

// Helper global para crear elementos DOM
global.createMockElement = (tag, options = {}) => {
  const el = document.createElement(tag);

  if (options.textContent) el.textContent = options.textContent;
  if (options.className) el.className = options.className;
  if (options.id) el.id = options.id;
  if (options.role) el.setAttribute('role', options.role);
  if (options.ariaLabel) el.setAttribute('aria-label', options.ariaLabel);
  if (options.placeholder) el.setAttribute('placeholder', options.placeholder);
  if (options.type) el.setAttribute('type', options.type);
  if (options.innerHTML) el.innerHTML = options.innerHTML;

  // Agregar atributos adicionales
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });
  }

  return el;
};

// Helper para simular eventos
global.simulateEvent = (element, eventType, options = {}) => {
  const event = new Event(eventType, { bubbles: true, cancelable: true, ...options });
  element.dispatchEvent(event);
  return event;
};

// Helper para esperar
global.waitFor = (condition, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
};

// Console spy para verificar logs
global.consoleSpy = {
  log: jest.spyOn(console, 'log').mockImplementation(),
  error: jest.spyOn(console, 'error').mockImplementation(),
  warn: jest.spyOn(console, 'warn').mockImplementation(),
};

// Restaurar console después de todos los tests
afterAll(() => {
  global.consoleSpy.log.mockRestore();
  global.consoleSpy.error.mockRestore();
  global.consoleSpy.warn.mockRestore();
});
