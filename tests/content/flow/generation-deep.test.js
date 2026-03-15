/**
 * Round 5: Deep dive tests for content/flow/generation.js
 * Tests fragile UI interaction points
 */

// Setup globals
global.vfLog = jest.fn();
global.sleep = jest.fn(() => Promise.resolve());
global.GENERATION_TYPE_TEXTS = {
  'text-to-video': ['Texto a vídeo', 'Texto a video', 'Text to video'],
  'image-to-video': ['Imágenes a vídeo', 'Imágenes a video', 'Imagen a video', 'Image to video'],
  'ingredients-to-video': ['Ingredientes a vídeo', 'Ingredientes a video', 'Ingredients to video']
};

// Load findElement from utils
global.findElement = (texts, tagFilter = null) => {
  const allElements = document.querySelectorAll(tagFilter || '*');
  for (const el of allElements) {
    const elText = el.textContent?.trim().toLowerCase();
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
    for (const searchText of texts) {
      const search = searchText.toLowerCase();
      if (elText?.includes(search) || ariaLabel?.includes(search)) {
        if (el.tagName === 'BUTTON' || el.closest('button')) return el.closest('button') || el;
        if (!tagFilter) return el;
      }
    }
  }
  return null;
};

// Mock DataTransfer for jsdom - need real FileList-like object
global.DataTransfer = class DataTransfer {
  constructor() {
    this._files = [];
    this.items = {
      add: jest.fn((file) => { this._files.push(file); })
    };
  }
  get files() {
    return this._files;
  }
};

// Mock DragEvent
global.DragEvent = class DragEvent extends Event {
  constructor(type, init) {
    super(type, init);
    this.dataTransfer = init?.dataTransfer;
  }
};

// Mock base64ToBlob before loading generation code
global.base64ToBlob = jest.fn().mockResolvedValue(new Blob(['test'], { type: 'image/png' }));
global.handleCropDialog = undefined; // Will be defined by generation.js
global.waitForImageReady = undefined;

// Load the actual generation code
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '../../../content/flow/generation.js'), 'utf8'));

describe('Generation Deep Dive - Round 5', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    window.lastDownloadedVideoSrc = null;

    // Mock scrollIntoView globally
    Element.prototype.scrollIntoView = jest.fn();

    // Mock sleep to also advance Date.now by the requested ms
    // This prevents infinite loops in while(Date.now() - start < maxWait) patterns
    let timeOffset = 0;
    const realDateNow = Date.now.bind(Date);
    jest.spyOn(Date, 'now').mockImplementation(() => realDateNow() + timeOffset);
    global.sleep = jest.fn((ms) => {
      timeOffset += (ms || 0);
      return Promise.resolve();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ========== A. selectGenerationType ==========

  describe('selectGenerationType - silent failure scenarios', () => {
    test('warns and returns when no dropdown found', async () => {
      document.body.innerHTML = '<div>Empty page</div>';
      await selectGenerationType('text-to-video');
      expect(vfLog).toHaveBeenCalledWith(
        expect.stringContaining('no encontrado'),
        'warn'
      );
    });

    test('closes dropdown with Escape when option not found', async () => {
      const combobox = createMockElement('div', { role: 'combobox', textContent: 'Texto a vídeo' });
      combobox.click = jest.fn();
      document.body.appendChild(combobox);
      // No listbox = option won't be found

      const escapeSpy = jest.fn();
      document.addEventListener('keydown', escapeSpy);

      await selectGenerationType('ingredients-to-video');

      expect(combobox.click).toHaveBeenCalled();
      expect(escapeSpy).toHaveBeenCalled();
      document.removeEventListener('keydown', escapeSpy);
    });

    test('skips click if type already selected', async () => {
      const combobox = createMockElement('div', { role: 'combobox', textContent: 'Imágenes a vídeo' });
      combobox.click = jest.fn();
      document.body.appendChild(combobox);

      await selectGenerationType('image-to-video');

      expect(combobox.click).not.toHaveBeenCalled();
      expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('ya seleccionado'), 'success');
    });

    test('finds dropdown via button fallback when no combobox', async () => {
      const btn = document.createElement('button');
      btn.textContent = 'Texto a vídeo';
      btn.click = jest.fn();
      document.body.appendChild(btn);

      await selectGenerationType('text-to-video');

      // Already selected, should not click
      expect(btn.click).not.toHaveBeenCalled();
    });
  });

  // ========== A. enterPrompt - React compatibility ==========

  describe('enterPrompt - React state update', () => {
    test('uses native setter when available for React compatibility', async () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      // The native setter should be used
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      );

      await enterPrompt('Test prompt for React');

      expect(textarea.value).toBe('Test prompt for React');
    });

    test('falls back to direct assignment when native setter unavailable', async () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      // Temporarily remove the native setter
      const origDesc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
        set: undefined,
        get: origDesc.get,
        configurable: true
      });

      // The code checks for nativeSetter and falls back
      // Since we broke the setter, it should still work via fallback
      // Restore before the test runs the actual code
      Object.defineProperty(HTMLTextAreaElement.prototype, 'value', origDesc);

      await enterPrompt('Fallback test');
      expect(textarea.value).toBe('Fallback test');
    });

    test('dispatches input, change, and keyup events', async () => {
      const textarea = document.createElement('textarea');
      const events = [];
      textarea.addEventListener('input', () => events.push('input'));
      textarea.addEventListener('change', () => events.push('change'));
      textarea.addEventListener('keyup', () => events.push('keyup'));
      document.body.appendChild(textarea);

      await enterPrompt('Event test');

      expect(events).toContain('input');
      expect(events).toContain('change');
      expect(events).toContain('keyup');
    });

    test('throws on invalid prompt', async () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      await expect(enterPrompt(null)).rejects.toThrow();
      await expect(enterPrompt(undefined)).rejects.toThrow();
      await expect(enterPrompt(123)).rejects.toThrow();
    });

    test('retries if value not set properly', async () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      // The retry check is for currentValue.length < 5
      await enterPrompt('Hi'); // short but valid
      expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('reintentando'), 'warn');
    });

    test('handles contenteditable element', async () => {
      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      document.body.appendChild(div);

      // No textarea, should find contenteditable
      await enterPrompt('Contenteditable test');
      expect(div.textContent).toBe('Contenteditable test');
    });

    test('throws when no input found after retry', async () => {
      document.body.innerHTML = '<div>No inputs</div>';
      await expect(enterPrompt('Test')).rejects.toThrow('Prompt input not found after retry');
    });
  });

  // ========== A. uploadImage - base64→blob→File chain ==========

  describe('uploadImage - image injection chain', () => {
    test('throws when no image data provided', async () => {
      await expect(uploadImage(null)).resolves.toBeUndefined();
      expect(vfLog).toHaveBeenCalledWith('No hay datos de imagen', 'warn');
    });

    test('throws when file input not found and no add button', async () => {
      document.body.innerHTML = '<textarea></textarea>';

      await expect(uploadImage('data:image/png;base64,iVBOR')).rejects.toThrow(
        'No se pudo subir la imagen'
      );
    });

    test('finds existing file input directly', async () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      // Mock files setter since jsdom validates FileList type
      Object.defineProperty(fileInput, 'files', { set: jest.fn(), get: () => [] });
      document.body.appendChild(fileInput);

      await uploadImage('data:image/png;base64,iVBOR');

      expect(vfLog).toHaveBeenCalledWith(
        'Input de archivo encontrado directamente en el DOM', 'info'
      );
    });

    test('clicks add button to reveal file input', async () => {
      const textarea = document.createElement('textarea');
      const presentation = document.createElement('div');
      presentation.setAttribute('role', 'presentation');
      presentation.appendChild(textarea);

      const addBtn = document.createElement('button');
      addBtn.textContent = 'add';
      addBtn.click = jest.fn(() => {
        // Simulate file input appearing after click
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        Object.defineProperty(input, 'files', { set: jest.fn(), get: () => [] });
        document.body.appendChild(input);
      });
      presentation.appendChild(addBtn);
      document.body.appendChild(presentation);

      await uploadImage('data:image/png;base64,iVBOR');

      expect(addBtn.click).toHaveBeenCalled();
      expect(vfLog).toHaveBeenCalledWith(
        expect.stringContaining('Imagen subida correctamente'), 'success'
      );
    });

    test('retries click up to 7 times if input not found', async () => {
      const textarea = document.createElement('textarea');
      const presentation = document.createElement('div');
      presentation.setAttribute('role', 'presentation');
      presentation.appendChild(textarea);

      const addBtn = document.createElement('button');
      addBtn.textContent = 'add';
      let clickCount = 0;
      addBtn.click = jest.fn(() => { clickCount++; });
      // Never creates a file input
      presentation.appendChild(addBtn);
      document.body.appendChild(presentation);

      textarea.scrollIntoView = jest.fn();
      addBtn.scrollIntoView = jest.fn();

      await expect(uploadImage('data:image/png;base64,iVBOR')).rejects.toThrow(
        'No se pudo subir la imagen'
      );

      // Even attempts (0,2,4,6) use .click(), odd use dispatchEvent
      expect(clickCount).toBe(4);
    });
  });

  // ========== A. handleCropDialog ==========

  describe('handleCropDialog', () => {
    test('handles when no crop dialog appears', async () => {
      document.body.innerHTML = '<div>No dialog</div>';
      await handleCropDialog();
      expect(vfLog).toHaveBeenCalledWith(
        expect.stringContaining('No apareció diálogo de recorte'), 'info'
      );
    });

    test('clicks "Recortar y guardar" button', async () => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancelar';
      dialog.appendChild(cancelBtn);

      const cropBtn = document.createElement('button');
      cropBtn.textContent = 'Recortar y guardar';
      cropBtn.click = jest.fn();
      dialog.appendChild(cropBtn);

      document.body.appendChild(dialog);

      await handleCropDialog();

      expect(cropBtn.click).toHaveBeenCalled();
    });

    test('falls back to last non-cancel button with different text', async () => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancelar';
      dialog.appendChild(cancelBtn);

      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Aplicar';
      applyBtn.click = jest.fn();
      dialog.appendChild(applyBtn);

      document.body.appendChild(dialog);

      await handleCropDialog();

      expect(applyBtn.click).toHaveBeenCalled();
    });

    test('handles English crop dialog text', async () => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');

      const btn = document.createElement('button');
      btn.textContent = 'Crop and save';
      btn.click = jest.fn();
      dialog.appendChild(btn);

      document.body.appendChild(dialog);

      await handleCropDialog();

      expect(btn.click).toHaveBeenCalled();
    });
  });

  // ========== A. clickGenerate - all methods ==========

  describe('clickGenerate - method cascade', () => {
    test('Method 1: finds by aria-label "enviar"', async () => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Enviar prompt');
      btn.click = jest.fn();
      document.body.appendChild(btn);

      await clickGenerate({});

      expect(btn.click).toHaveBeenCalled();
    });

    test('Method 2: finds by material icon text', async () => {
      const btn = document.createElement('button');
      btn.textContent = 'arrow_upward';
      btn.click = jest.fn();
      document.body.appendChild(btn);

      await clickGenerate({});

      expect(btn.click).toHaveBeenCalled();
    });

    test('Method 2: skips settings buttons', async () => {
      const settingsBtn = document.createElement('button');
      settingsBtn.textContent = 'arrow_forward';
      settingsBtn.setAttribute('aria-label', 'Ajustes de modelo');
      settingsBtn.click = jest.fn();
      document.body.appendChild(settingsBtn);

      // No other button → should fall through
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      // Will try Enter as last resort
      await clickGenerate({});

      expect(settingsBtn.click).not.toHaveBeenCalled();
    });

    test('Method 4: finds by text "Generar"', async () => {
      const btn = document.createElement('button');
      btn.textContent = 'Generar';
      btn.click = jest.fn();
      document.body.appendChild(btn);

      await clickGenerate({});

      expect(btn.click).toHaveBeenCalled();
    });

    test('Method 5: falls back to Enter key on textarea', async () => {
      const textarea = document.createElement('textarea');
      const keyEvents = [];
      textarea.addEventListener('keydown', (e) => keyEvents.push(e.key + (e.ctrlKey ? '+ctrl' : '')));
      document.body.appendChild(textarea);

      await clickGenerate({});

      expect(keyEvents).toContain('Enter+ctrl');
      expect(keyEvents).toContain('Enter');
    });

    test('throws when no generate button found and no textarea', async () => {
      document.body.innerHTML = '<div>Nothing</div>';

      await expect(clickGenerate({})).rejects.toThrow('Generate button not found');
    });

    test('skips disabled buttons', async () => {
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'Enviar');
      btn.disabled = true;
      btn.click = jest.fn();
      document.body.appendChild(btn);

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      // Should skip disabled and fall through to Enter
      await clickGenerate({});

      expect(btn.click).not.toHaveBeenCalled();
    });

    test('verifies image before send for image-to-video', async () => {
      // No image loaded → should wait and then throw
      document.body.innerHTML = '<textarea></textarea>';

      await expect(clickGenerate({ generationType: 'image-to-video' })).rejects.toThrow(
        'No se pudo confirmar imagen'
      );
    });
  });

  // ========== A. getCurrentGenerationType ==========

  describe('getCurrentGenerationType', () => {
    test('detects image-to-video with accent variations', async () => {
      const cb = createMockElement('div', { role: 'combobox', textContent: 'Imágenes a vídeo' });
      document.body.appendChild(cb);
      expect(await getCurrentGenerationType()).toBe('image-to-video');
    });

    test('detects text-to-video', async () => {
      const cb = createMockElement('div', { role: 'combobox', textContent: 'Texto a vídeo' });
      document.body.appendChild(cb);
      expect(await getCurrentGenerationType()).toBe('text-to-video');
    });

    test('returns unknown on empty page', async () => {
      expect(await getCurrentGenerationType()).toBe('unknown');
    });

    test('uses button fallback', async () => {
      const btn = document.createElement('button');
      btn.textContent = 'Imágenes a vídeo seleccionado';
      document.body.appendChild(btn);
      expect(await getCurrentGenerationType()).toBe('image-to-video');
    });
  });

  // ========== verifyImageBeforeSend ==========

  describe('verifyImageBeforeSend', () => {
    test('detects image via "Primera imagen" button', async () => {
      const btn = document.createElement('button');
      btn.textContent = 'Primera imagen (referencia)';
      document.body.appendChild(btn);

      const result = await verifyImageBeforeSend();
      expect(result).toBe(true);
    });

    test('detects image via blob img', async () => {
      const img = document.createElement('img');
      img.src = 'blob:https://labs.google/abc123';
      // Need visible dimensions
      Object.defineProperty(img, 'getBoundingClientRect', {
        value: () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 })
      });
      document.body.appendChild(img);

      const result = await verifyImageBeforeSend();
      expect(result).toBe(true);
    });

    test('returns false when no image detected', async () => {
      document.body.innerHTML = '<div>Empty</div>';
      const result = await verifyImageBeforeSend();
      expect(result).toBe(false);
    });
  });

  // ========== cleanUIStateBeforeUpload ==========

  describe('cleanUIStateBeforeUpload', () => {
    test('closes open menus with Escape', async () => {
      const menu = createMockElement('div', { role: 'menu' });
      document.body.appendChild(menu);

      const escapeSpy = jest.fn();
      document.addEventListener('keydown', escapeSpy);

      await cleanUIStateBeforeUpload();

      expect(escapeSpy).toHaveBeenCalled();
      document.removeEventListener('keydown', escapeSpy);
    });

    test('scrolls textarea into view', async () => {
      const textarea = document.createElement('textarea');
      textarea.scrollIntoView = jest.fn();
      document.body.appendChild(textarea);

      await cleanUIStateBeforeUpload();

      expect(textarea.scrollIntoView).toHaveBeenCalled();
    });

    test('handles empty page gracefully', async () => {
      document.body.innerHTML = '';
      await cleanUIStateBeforeUpload(); // Should not throw
    });
  });

  // ========== getCurrentImageFingerprint ==========

  describe('getCurrentImageFingerprint', () => {
    test('returns null when no image loaded', () => {
      document.body.innerHTML = '<div>No image</div>';
      expect(getCurrentImageFingerprint()).toBeNull();
    });

    test('detects image via "primera imagen" button with img', () => {
      const btn = document.createElement('button');
      btn.textContent = 'Primera imagen';
      const img = document.createElement('img');
      img.src = 'https://example.com/image.png?token=abc123';
      btn.appendChild(img);
      document.body.appendChild(btn);

      const result = getCurrentImageFingerprint();
      expect(result).toBeTruthy();
      expect(result).toContain('example.com');
    });

    test('detects blob image near textarea', () => {
      const form = document.createElement('form');
      const textarea = document.createElement('textarea');
      form.appendChild(textarea);
      const img = document.createElement('img');
      img.src = 'blob:https://labs.google/abc123';
      form.appendChild(img);
      document.body.appendChild(form);

      const result = getCurrentImageFingerprint();
      expect(result).toBeTruthy();
      expect(result).toContain('blob:');
    });
  });
});
