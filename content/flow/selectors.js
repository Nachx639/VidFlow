/**
 * VidFlow - Selectores DOM
 * Constantes con selectores para Google Flow
 */

// ========== SELECTORS ==========
// var allows re-declaration without error when script is injected multiple times
// Basados en la interfaz real de Google Flow

var SELECTORS = {
  // Página principal
  newProjectButton: 'button:has-text("Nuevo proyecto"), [aria-label*="Nuevo proyecto"], button:has-text("New project")',

  // Editor de proyecto
  promptInput: 'textarea, [contenteditable="true"], input[placeholder*="video"], input[placeholder*="texto"]',

  // Dropdown de tipo de generación
  generationTypeButton: 'button:has-text("Texto a v"), button:has-text("Text to"), [aria-label*="Texto a"]',
  generationTypeOptions: {
    'text-to-video': ['Texto a vídeo', 'Texto a video', 'Text to video'],
    'image-to-video': ['Imágenes a vídeo', 'Imagen a video', 'Image to video'],
    'ingredients-to-video': ['Ingredientes a vídeo', 'Ingredients to video']
  },

  // Panel de ajustes (se abre al hacer clic en el botón de modelo)
  settingsButton: 'button:has-text("Veo"), [aria-label*="Veo"], button[class*="model"]',

  // Selectores dentro del panel de ajustes
  aspectRatioDropdown: 'button:has-text("Horizontal"), button:has-text("Vertical"), [aria-label*="aspecto"], [aria-label*="aspect"]',
  aspectRatioOptions: {
    '16:9': ['Horizontal', '16:9', 'Landscape'],
    '9:16': ['Vertical', '9:16', 'Portrait']
  },

  resultsDropdown: '[aria-label*="Resultados"], [aria-label*="Results"], button:has-text("resultado")',

  modelDropdown: '[aria-label*="Modelo"], button:has-text("Veo 3"), button:has-text("Veo 2")',
  modelOptions: {
    'veo-3.1-fast': ['Veo 3.1 - Fast', 'Veo 3.1 Fast'],
    'veo-3.1-fast-low': ['Veo 3.1 - Fast [Lower', 'Lower Priority'],
    'veo-3.1-quality': ['Veo 3.1 - Quality', 'Veo 3.1 Quality'],
    'veo-2-fast': ['Veo 2 - Fast', 'Veo 2 Fast'],
    'veo-2-quality': ['Veo 2 - Quality', 'Veo 2 Quality']
  },

  // Subida de imagen
  imageUploadButton: 'button:has-text("Añadir imagen"), button:has-text("Add image"), [aria-label*="imagen"]',
  imageInput: 'input[type="file"][accept*="image"]',

  // Generación
  generateButton: 'button[aria-label*="Enviar"], button[aria-label*="Send"], button:has-text("Generar"), button[type="submit"]',

  // Estado de generación
  loadingIndicator: '[class*="loading"], [class*="spinner"], [aria-busy="true"]',
  videoResult: 'video[src], video source[src], [class*="video-result"]',
  downloadButton: 'button:has-text("Descargar"), button:has-text("Download"), [aria-label*="download"], [aria-label*="Descargar"]',

  // Errores
  errorMessage: '[role="alert"], [class*="error"], [class*="Error"]'
};

// ========== MODEL TEXTS ==========
var MODEL_TEXTS = {
  'veo-3.1-fast': ['Veo 3.1 - Fast', '3.1 - Fast', 'Veo 3.1'],
  'veo-3.1-fast-low': ['Veo 3.1 - Fast [Lower', 'Lower Priority'],
  'veo-3.1-quality': ['Veo 3.1 - Quality', '3.1 - Quality'],
  'veo-2-fast': ['Veo 2 - Fast', '2 - Fast'],
  'veo-2-quality': ['Veo 2 - Quality', '2 - Quality']
};

// ========== GENERATION TYPE TEXTS ==========
var GENERATION_TYPE_TEXTS = {
  'text-to-video': ['Texto a vídeo', 'Texto a video', 'Text to video'],
  'image-to-video': ['Imágenes a vídeo', 'Imágenes a video', 'Imagen a video', 'Image to video'],
  'ingredients-to-video': ['Ingredientes a vídeo', 'Ingredientes a video', 'Ingredients to video']
};

console.log('VidFlow: selectors.js cargado');
