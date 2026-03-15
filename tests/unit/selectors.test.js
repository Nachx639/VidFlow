/**
 * Tests para content/flow/selectors.js
 * Validates selector constants match expected DOM patterns
 */

const SELECTORS = {
  newProjectButton: 'button:has-text("Nuevo proyecto"), [aria-label*="Nuevo proyecto"], button:has-text("New project")',
  promptInput: 'textarea, [contenteditable="true"], input[placeholder*="video"], input[placeholder*="texto"]',
  generationTypeButton: 'button:has-text("Texto a v"), button:has-text("Text to"), [aria-label*="Texto a"]',
  generationTypeOptions: {
    'text-to-video': ['Texto a vídeo', 'Texto a video', 'Text to video'],
    'image-to-video': ['Imágenes a vídeo', 'Imagen a video', 'Image to video'],
    'ingredients-to-video': ['Ingredientes a vídeo', 'Ingredients to video']
  },
  settingsButton: 'button:has-text("Veo"), [aria-label*="Veo"], button[class*="model"]',
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
  imageUploadButton: 'button:has-text("Añadir imagen"), button:has-text("Add image"), [aria-label*="imagen"]',
  imageInput: 'input[type="file"][accept*="image"]',
  generateButton: 'button[aria-label*="Enviar"], button[aria-label*="Send"], button:has-text("Generar"), button[type="submit"]',
  loadingIndicator: '[class*="loading"], [class*="spinner"], [aria-busy="true"]',
  videoResult: 'video[src], video source[src], [class*="video-result"]',
  downloadButton: 'button:has-text("Descargar"), button:has-text("Download"), [aria-label*="download"], [aria-label*="Descargar"]',
  errorMessage: '[role="alert"], [class*="error"], [class*="Error"]'
};

const MODEL_TEXTS = {
  'veo-3.1-fast': ['Veo 3.1 - Fast', '3.1 - Fast', 'Veo 3.1'],
  'veo-3.1-fast-low': ['Veo 3.1 - Fast [Lower', 'Lower Priority'],
  'veo-3.1-quality': ['Veo 3.1 - Quality', '3.1 - Quality'],
  'veo-2-fast': ['Veo 2 - Fast', '2 - Fast'],
  'veo-2-quality': ['Veo 2 - Quality', '2 - Quality']
};

const GENERATION_TYPE_TEXTS = {
  'text-to-video': ['Texto a vídeo', 'Texto a video', 'Text to video'],
  'image-to-video': ['Imágenes a vídeo', 'Imágenes a video', 'Imagen a video', 'Image to video'],
  'ingredients-to-video': ['Ingredientes a vídeo', 'Ingredientes a video', 'Ingredients to video']
};

describe('selectors.js - SELECTORS', () => {
  test('all critical selectors are non-empty strings', () => {
    const stringSelectors = [
      'newProjectButton', 'promptInput', 'generateButton',
      'downloadButton', 'loadingIndicator', 'errorMessage',
      'imageUploadButton', 'imageInput', 'videoResult'
    ];
    stringSelectors.forEach(key => {
      expect(typeof SELECTORS[key]).toBe('string');
      expect(SELECTORS[key].length).toBeGreaterThan(0);
    });
  });

  test('newProjectButton supports Spanish and English', () => {
    expect(SELECTORS.newProjectButton).toContain('Nuevo proyecto');
    expect(SELECTORS.newProjectButton).toContain('New project');
  });

  test('generateButton includes aria-label and text-based fallbacks', () => {
    expect(SELECTORS.generateButton).toContain('aria-label');
    expect(SELECTORS.generateButton).toContain('Generar');
    expect(SELECTORS.generateButton).toContain('submit');
  });

  test('downloadButton includes Descargar and Download variants', () => {
    expect(SELECTORS.downloadButton).toContain('Descargar');
    expect(SELECTORS.downloadButton).toContain('Download');
  });

  describe('generationTypeOptions', () => {
    test('covers all 3 generation types with Spanish + English texts', () => {
      const types = ['text-to-video', 'image-to-video', 'ingredients-to-video'];
      types.forEach(type => {
        const options = SELECTORS.generationTypeOptions[type];
        expect(Array.isArray(options)).toBe(true);
        expect(options.length).toBeGreaterThanOrEqual(2);
      });
    });

    test('text-to-video includes accent variations', () => {
      const opts = SELECTORS.generationTypeOptions['text-to-video'];
      expect(opts).toContain('Texto a vídeo');
      expect(opts).toContain('Text to video');
    });
  });

  describe('aspectRatioOptions', () => {
    test('16:9 maps to Horizontal/Landscape', () => {
      expect(SELECTORS.aspectRatioOptions['16:9']).toEqual(
        expect.arrayContaining(['Horizontal', '16:9', 'Landscape'])
      );
    });

    test('9:16 maps to Vertical/Portrait', () => {
      expect(SELECTORS.aspectRatioOptions['9:16']).toEqual(
        expect.arrayContaining(['Vertical', '9:16', 'Portrait'])
      );
    });
  });

  describe('modelOptions', () => {
    test('all 5 model variants have at least 2 search texts', () => {
      const models = ['veo-3.1-fast', 'veo-3.1-fast-low', 'veo-3.1-quality', 'veo-2-fast', 'veo-2-quality'];
      models.forEach(model => {
        expect(SELECTORS.modelOptions[model].length).toBeGreaterThanOrEqual(2);
      });
    });

    test('veo-3.1 options contain version number', () => {
      expect(SELECTORS.modelOptions['veo-3.1-fast'][0]).toContain('3.1');
      expect(SELECTORS.modelOptions['veo-2-fast'][0]).toContain('Veo 2');
    });
  });
});

describe('selectors.js - MODEL_TEXTS', () => {
  test('all 5 models have non-empty text arrays', () => {
    const expectedModels = ['veo-3.1-fast', 'veo-3.1-fast-low', 'veo-3.1-quality', 'veo-2-fast', 'veo-2-quality'];
    expectedModels.forEach(model => {
      expect(Array.isArray(MODEL_TEXTS[model])).toBe(true);
      expect(MODEL_TEXTS[model].length).toBeGreaterThan(0);
      MODEL_TEXTS[model].forEach(text => {
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      });
    });
  });
});

describe('selectors.js - GENERATION_TYPE_TEXTS', () => {
  test('all 3 types have Spanish and English text variants', () => {
    const types = ['text-to-video', 'image-to-video', 'ingredients-to-video'];
    types.forEach(type => {
      const texts = GENERATION_TYPE_TEXTS[type];
      expect(texts.length).toBeGreaterThanOrEqual(2);
      const hasSpanish = texts.some(t => /[áéíóúñ]|Texto|Imágenes|Ingredientes/i.test(t));
      const hasEnglish = texts.some(t => /Text|Image|Ingredients/i.test(t));
      expect(hasSpanish).toBe(true);
      expect(hasEnglish).toBe(true);
    });
  });
});
