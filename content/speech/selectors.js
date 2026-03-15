/**
 * VidFlow - Speech Selectores DOM
 * Constantes con selectores para AI Studio Speech
 * URL: https://aistudio.google.com/generate-speech
 * Actualizado basado en análisis real de la página
 */

// ========== SELECTORS ==========
// Basados en la interfaz real de AI Studio Speech

const SPEECH_SELECTORS = {
  // Style instructions input - campo para instrucciones de estilo
  styleInput: 'textarea[aria-label="Style instructions"]',

  // Input de texto - campo para el contenido a convertir en speech
  textInput: 'textarea[placeholder*="Start writing"], textarea[placeholder*="paste text"]',

  // Botón de generar/Run
  generateButton: 'button[aria-label="Run"], button[type="submit"]',

  // Selector de voz (combobox)
  voiceSelector: '[role="combobox"]',

  // Opciones de voz (cuando el dropdown está abierto)
  voiceOptions: '[role="option"], [role="listbox"] [role="option"]',

  // Botones de modo
  singleSpeakerButton: 'button[type="button"]',  // Se identifica por texto "Single-speaker"
  multiSpeakerButton: 'button[type="button"]',   // Se identifica por texto "Multi-speaker"

  // Reproductor de audio (aparece después de generar)
  audioPlayer: 'audio',

  // Botón de descarga
  downloadButton: 'button[aria-label*="download" i], button[aria-label*="Download" i], a[download]',

  // Loading indicators
  loadingIndicator: '[aria-busy="true"], [class*="loading"], [class*="spinner"], [class*="progress"]',

  // Errores
  errorMessage: '[role="alert"], [class*="error" i]',

  // Cookie banner
  cookieBanner: '.glue-cookie-notification-bar__accept, button[class*="cookie"]'
};

// ========== HELPER FUNCTIONS ==========

/**
 * Obtiene el textarea de style instructions
 * @returns {HTMLTextAreaElement|null}
 */
function getStyleInput() {
  return document.querySelector(SPEECH_SELECTORS.styleInput);
}

/**
 * Obtiene el textarea de texto
 * @returns {HTMLTextAreaElement|null}
 */
function getTextInput() {
  // Intentar selector específico primero
  let input = document.querySelector(SPEECH_SELECTORS.textInput);

  // Fallback: el segundo textarea que no sea style
  if (!input) {
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.getAttribute('aria-label') !== 'Style instructions') {
        input = ta;
        break;
      }
    }
  }

  return input;
}

/**
 * Obtiene el botón de Run/Generate
 * @returns {HTMLButtonElement|null}
 */
function getGenerateButton() {
  // Buscar por aria-label primero
  let btn = document.querySelector('button[aria-label="Run"]');

  // Fallback: buscar por texto
  if (!btn) {
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.textContent?.includes('Run')) {
        btn = b;
        break;
      }
    }
  }

  return btn;
}

/**
 * Selecciona el modo Single-speaker
 * @returns {boolean}
 */
function selectSingleSpeakerMode() {
  console.log('VidFlow Speech: Buscando botón Single-speaker...');
  const buttons = document.querySelectorAll('button[type="button"]');
  for (const btn of buttons) {
    if (btn.textContent?.toLowerCase().includes('single-speaker')) {
      console.log('VidFlow Speech: Botón Single-speaker encontrado, haciendo clic...');
      btn.click();
      return true;
    }
  }
  console.log('VidFlow Speech: Botón Single-speaker NO encontrado');
  return false;
}

/**
 * Verifica si estamos en modo Single-speaker
 * @returns {boolean}
 */
function isSingleSpeakerMode() {
  const buttons = document.querySelectorAll('button[type="button"]');
  for (const btn of buttons) {
    const text = btn.textContent?.toLowerCase();
    if (text?.includes('single-speaker')) {
      // Verificar si tiene la clase ms-button-active (indica seleccionado)
      const isActive = btn.classList.contains('ms-button-active');
      console.log('VidFlow Speech: Single-speaker activo?', isActive, 'Classes:', btn.className);
      return isActive;
    }
  }
  console.log('VidFlow Speech: Botón Single-speaker no encontrado para verificación');
  return false;
}

/**
 * Obtiene el selector de voz
 * @returns {HTMLElement|null}
 */
function getVoiceSelector() {
  return document.querySelector(SPEECH_SELECTORS.voiceSelector);
}

/**
 * Verifica si la página de Speech está lista
 * @returns {boolean}
 */
function isSpeechPageReady() {
  const styleInput = getStyleInput();
  const textInput = getTextInput();
  const runBtn = getGenerateButton();
  return !!(styleInput || textInput) && !!runBtn;
}

/**
 * Acepta el banner de cookies si existe
 */
function acceptCookies() {
  const cookieBtn = document.querySelector(SPEECH_SELECTORS.cookieBanner);
  if (cookieBtn) {
    cookieBtn.click();
    return true;
  }
  return false;
}

/**
 * Busca el elemento de audio generado
 * @returns {HTMLAudioElement|null}
 */
function getAudioPlayer() {
  return document.querySelector(SPEECH_SELECTORS.audioPlayer);
}

/**
 * Busca el botón de descarga
 * @returns {HTMLElement|null}
 */
function getDownloadButton() {
  // Buscar por aria-label
  let btn = document.querySelector('button[aria-label*="download" i], button[aria-label*="Download"]');

  // Fallback: buscar por texto
  if (!btn) {
    const buttons = document.querySelectorAll('button');
    for (const b of buttons) {
      if (b.textContent?.toLowerCase().includes('download')) {
        btn = b;
        break;
      }
    }
  }

  // Fallback: buscar link con download
  if (!btn) {
    btn = document.querySelector('a[download]');
  }

  return btn;
}

// ========== VOICE PRESETS ==========
// Todas las voces disponibles en AI Studio (30 voces)
const AVAILABLE_VOICES = {
  // Voces Femeninas (14)
  female: [
    'Zephyr', 'Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina',
    'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat'
  ],
  // Voces Masculinas (16)
  male: [
    'Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel',
    'Algieba', 'Algenib', 'Rasalgethi', 'Alnilam', 'Schedar', 'Achird',
    'Zubenelgenubi', 'Sadachbia', 'Sadaltager'
  ]
};

// Lista plana de todas las voces para búsqueda rápida
const ALL_VOICES = [...AVAILABLE_VOICES.female, ...AVAILABLE_VOICES.male];

console.log('VidFlow Speech: selectors.js cargado');
