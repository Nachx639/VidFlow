/**
 * VidFlow - Speech Utilidades
 * Funciones de utilidad para AI Studio Speech
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
 * Espera a que un elemento aparezca en el DOM
 * @param {string} selector - Selector CSS
 * @param {number} timeout - Timeout en ms
 * @returns {Promise<Element>}
 */
async function waitForElement(selector, timeout = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const element = document.querySelector(selector);
    if (element) return element;
    await sleep(200);
  }

  throw new Error(`Element not found: ${selector}`);
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
 * Espera a que la página AI Studio Speech esté lista
 * @returns {Promise<void>}
 */
async function waitForPageReady() {
  const maxWait = 20000;
  const startTime = Date.now();

  // Aceptar cookies si existe el banner
  if (typeof acceptCookies === 'function') {
    acceptCookies();
  }

  while (Date.now() - startTime < maxWait) {
    // Usar función de selectors.js si está disponible
    if (typeof isSpeechPageReady === 'function' && isSpeechPageReady()) {
      await sleep(1000);
      console.log('VidFlow Speech: Página lista (via isSpeechPageReady)');
      return;
    }

    // Fallback: buscar textarea y botón Run
    const textarea = document.querySelector('textarea');
    const runBtn = document.querySelector('button[aria-label="Run"], button[type="submit"]');

    if (textarea && runBtn) {
      await sleep(1000);
      console.log('VidFlow Speech: Página lista (via fallback)');
      return;
    }

    await sleep(500);
  }

  throw new Error('AI Studio Speech page did not load properly');
}

/**
 * Verifica si hay un error visible en la UI
 * @returns {string|null} Mensaje de error o null si no hay error
 */
function checkForError() {
  const errorPatterns = [
    'error',
    'failed',
    'falló',
    'no se pudo',
    'try again',
    'intentar de nuevo'
  ];

  const errorElements = document.querySelectorAll('[role="alert"], [class*="error" i], [class*="Error"]');

  for (const el of errorElements) {
    const text = el.textContent?.toLowerCase() || '';
    for (const pattern of errorPatterns) {
      if (text.includes(pattern)) {
        return el.textContent.trim();
      }
    }
  }

  return null;
}

console.log('VidFlow Speech: utils.js cargado');
