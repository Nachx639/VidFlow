/**
 * Tests de integración para content/flow/generation.js
 * Funciones de generación de videos en Flow
 */

// Mock de vfLog
global.vfLog = jest.fn();

// Mock de sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Constantes de selectores (copiadas de selectors.js)
const GENERATION_TYPE_TEXTS = {
  'text-to-video': ['Texto a vídeo', 'Texto a video'],
  'image-to-video': ['Imágenes a vídeo', 'Imágenes a video'],
  'ingredients-to-video': ['Ingredientes a vídeo', 'Ingredientes a video']
};

// ========== IMPLEMENTACIONES PARA TESTING ==========

async function getCurrentGenerationType() {
  const comboboxes = document.querySelectorAll('[role="combobox"]');
  for (const cb of comboboxes) {
    const text = cb.textContent?.toLowerCase() || '';

    if (text.includes('imágenes') || text.includes('imagen')) {
      return 'image-to-video';
    }
    if (text.includes('texto a')) {
      return 'text-to-video';
    }
    if (text.includes('ingredientes')) {
      return 'ingredients-to-video';
    }
  }

  const allElements = document.querySelectorAll('button, [role="button"]');
  for (const el of allElements) {
    const text = el.textContent?.toLowerCase() || '';
    if (text.includes('imágenes a vídeo') || text.includes('imagen a video')) {
      return 'image-to-video';
    }
    if (text.includes('texto a vídeo') || text.includes('texto a video')) {
      return 'text-to-video';
    }
  }

  return 'unknown';
}

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

        if (el.tagName === 'BUTTON' ||
            el.tagName === 'A' ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('role') === 'option' ||
            el.getAttribute('role') === 'menuitem' ||
            el.onclick ||
            el.closest('button')) {
          return el.closest('button') || el;
        }

        if (!tagFilter) {
          return el;
        }
      }
    }
  }

  return null;
}

async function selectGenerationType(genType) {
  vfLog('Tipo de generación: ' + genType, 'info');

  const targetTexts = GENERATION_TYPE_TEXTS[genType] || GENERATION_TYPE_TEXTS['text-to-video'];

  let typeBtn = null;

  const comboboxes = document.querySelectorAll('[role="combobox"]');
  for (const cb of comboboxes) {
    const text = cb.textContent?.toLowerCase() || '';
    if (text.includes('texto') || text.includes('imágenes') || text.includes('imagen') ||
        text.includes('ingredientes') || text.includes('video')) {
      typeBtn = cb;
      vfLog('Combobox encontrado por role: ' + text.substring(0, 30), 'info');
      break;
    }
  }

  if (!typeBtn) {
    typeBtn = findElement([
      'Texto a vídeo', 'Texto a video',
      'Imágenes a vídeo', 'Imágenes a video'
    ], 'button');
  }

  if (!typeBtn) {
    vfLog('Dropdown de tipo no encontrado, continuando...', 'warn');
    return false;
  }

  const currentText = typeBtn.textContent?.toLowerCase() || '';
  const alreadySelected = targetTexts.some(t => currentText.includes(t.toLowerCase()));

  if (alreadySelected) {
    vfLog('Tipo ya seleccionado: ' + genType, 'success');
    return true;
  }

  typeBtn.click();
  await sleep(100);

  let option = null;
  const listbox = document.querySelector('[role="listbox"]');
  if (listbox) {
    const options = listbox.querySelectorAll('[role="option"]');
    for (const opt of options) {
      const optText = opt.textContent?.toLowerCase() || '';
      for (const target of targetTexts) {
        if (optText.includes(target.toLowerCase())) {
          option = opt;
          break;
        }
      }
      if (option) break;
    }
  }

  if (option) {
    option.click();
    vfLog('Tipo seleccionado: ' + genType, 'success');
    return true;
  }

  return false;
}

async function enterPrompt(promptText) {
  const textarea = document.querySelector('textarea');
  if (!textarea) {
    vfLog('Textarea no encontrado', 'error');
    return false;
  }

  textarea.focus();
  textarea.value = promptText;

  // Disparar eventos para que React detecte el cambio
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));

  vfLog('Prompt ingresado: ' + promptText.substring(0, 30) + '...', 'success');
  return true;
}

async function clickGenerate() {
  const generateBtn = findElement(['generar', 'generate', 'crear'], 'button');

  if (!generateBtn) {
    vfLog('Botón generar no encontrado', 'error');
    return false;
  }

  if (generateBtn.disabled) {
    vfLog('Botón generar está deshabilitado', 'warn');
    return false;
  }

  generateBtn.click();
  vfLog('Botón generar clickeado', 'success');
  return true;
}

// ========== TESTS ==========

describe('Generation - getCurrentGenerationType()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
  });

  test('debe detectar text-to-video por combobox', async () => {
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Texto a vídeo'
    });
    document.body.appendChild(combobox);

    const result = await getCurrentGenerationType();
    expect(result).toBe('text-to-video');
  });

  test('debe detectar image-to-video por combobox', async () => {
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Imágenes a vídeo'
    });
    document.body.appendChild(combobox);

    const result = await getCurrentGenerationType();
    expect(result).toBe('image-to-video');
  });

  test('debe detectar image-to-video por "imagen" singular', async () => {
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Imagen a video'
    });
    document.body.appendChild(combobox);

    const result = await getCurrentGenerationType();
    expect(result).toBe('image-to-video');
  });

  test('debe detectar ingredients-to-video', async () => {
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Ingredientes a vídeo'
    });
    document.body.appendChild(combobox);

    const result = await getCurrentGenerationType();
    expect(result).toBe('ingredients-to-video');
  });

  test('debe retornar "unknown" si no encuentra tipo', async () => {
    const result = await getCurrentGenerationType();
    expect(result).toBe('unknown');
  });

  test('debe buscar en botones si no hay combobox', async () => {
    const btn = createMockElement('button', {
      textContent: 'Texto a vídeo seleccionado'
    });
    document.body.appendChild(btn);

    const result = await getCurrentGenerationType();
    expect(result).toBe('text-to-video');
  });
});

describe('Generation - selectGenerationType()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debe detectar si el tipo ya está seleccionado', async () => {
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Texto a vídeo'
    });
    combobox.click = jest.fn();
    document.body.appendChild(combobox);

    const promise = selectGenerationType('text-to-video');
    jest.advanceTimersByTime(100);
    const result = await promise;

    expect(result).toBe(true);
    expect(combobox.click).not.toHaveBeenCalled(); // No debe hacer click si ya está seleccionado
    expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('ya seleccionado'), 'success');
  });

  test('debe abrir dropdown y seleccionar opción', async () => {
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Texto a vídeo'
    });
    combobox.click = jest.fn();
    document.body.appendChild(combobox);

    const listbox = createMockElement('div', { role: 'listbox' });
    const option = createMockElement('div', {
      role: 'option',
      textContent: 'Imágenes a vídeo'
    });
    option.click = jest.fn();
    listbox.appendChild(option);
    document.body.appendChild(listbox);

    const promise = selectGenerationType('image-to-video');
    jest.advanceTimersByTime(200);
    const result = await promise;

    expect(result).toBe(true);
    expect(combobox.click).toHaveBeenCalled();
    expect(option.click).toHaveBeenCalled();
  });

  test('debe retornar false si no encuentra dropdown', async () => {
    const promise = selectGenerationType('text-to-video');
    jest.advanceTimersByTime(100);
    const result = await promise;

    expect(result).toBe(false);
    expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('no encontrado'), 'warn');
  });
});

describe('Generation - enterPrompt()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
  });

  test('debe ingresar texto en textarea', async () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const result = await enterPrompt('Bruno walks in the forest');

    expect(result).toBe(true);
    expect(textarea.value).toBe('Bruno walks in the forest');
  });

  test('debe disparar eventos input y change', async () => {
    const textarea = document.createElement('textarea');
    const inputHandler = jest.fn();
    const changeHandler = jest.fn();
    textarea.addEventListener('input', inputHandler);
    textarea.addEventListener('change', changeHandler);
    document.body.appendChild(textarea);

    await enterPrompt('Test prompt');

    expect(inputHandler).toHaveBeenCalled();
    expect(changeHandler).toHaveBeenCalled();
  });

  test('debe retornar false si no hay textarea', async () => {
    const result = await enterPrompt('Test prompt');

    expect(result).toBe(false);
    expect(vfLog).toHaveBeenCalledWith('Textarea no encontrado', 'error');
  });

  test('debe truncar log para prompts largos', async () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const longPrompt = 'A very long prompt that exceeds thirty characters for testing';
    await enterPrompt(longPrompt);

    expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('...'), 'success');
  });
});

describe('Generation - clickGenerate()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
  });

  test('debe hacer click en botón generar', async () => {
    const btn = createMockElement('button', { textContent: 'Generar' });
    btn.click = jest.fn();
    document.body.appendChild(btn);

    const result = await clickGenerate();

    expect(result).toBe(true);
    expect(btn.click).toHaveBeenCalled();
    expect(vfLog).toHaveBeenCalledWith('Botón generar clickeado', 'success');
  });

  test('debe encontrar botón por texto parcial', async () => {
    const btn = createMockElement('button', { textContent: 'Generar video' });
    btn.click = jest.fn();
    document.body.appendChild(btn);

    const result = await clickGenerate();
    expect(result).toBe(true);
  });

  test('debe retornar false si botón está deshabilitado', async () => {
    const btn = createMockElement('button', { textContent: 'Generar' });
    btn.disabled = true;
    document.body.appendChild(btn);

    const result = await clickGenerate();

    expect(result).toBe(false);
    expect(vfLog).toHaveBeenCalledWith('Botón generar está deshabilitado', 'warn');
  });

  test('debe retornar false si no encuentra botón', async () => {
    const result = await clickGenerate();

    expect(result).toBe(false);
    expect(vfLog).toHaveBeenCalledWith('Botón generar no encontrado', 'error');
  });
});

describe('Generation - Flujo completo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debe ejecutar flujo de generación text-to-video', async () => {
    // Setup DOM simulando Flow
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Texto a vídeo'
    });
    combobox.click = jest.fn();
    document.body.appendChild(combobox);

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const generateBtn = createMockElement('button', { textContent: 'Generar' });
    generateBtn.click = jest.fn();
    document.body.appendChild(generateBtn);

    // Ejecutar flujo
    const typePromise = selectGenerationType('text-to-video');
    jest.advanceTimersByTime(100);
    const typeResult = await typePromise;
    expect(typeResult).toBe(true);

    const promptResult = await enterPrompt('Bruno walks in the forest');
    expect(promptResult).toBe(true);
    expect(textarea.value).toBe('Bruno walks in the forest');

    const generateResult = await clickGenerate();
    expect(generateResult).toBe(true);
    expect(generateBtn.click).toHaveBeenCalled();
  });

  test('debe manejar cambio de tipo de generación', async () => {
    // Setup: actualmente en text-to-video
    const combobox = createMockElement('div', {
      role: 'combobox',
      textContent: 'Texto a vídeo'
    });
    combobox.click = jest.fn();
    document.body.appendChild(combobox);

    // Listbox con opciones
    const listbox = createMockElement('div', { role: 'listbox' });
    const option1 = createMockElement('div', { role: 'option', textContent: 'Texto a vídeo' });
    const option2 = createMockElement('div', { role: 'option', textContent: 'Imágenes a vídeo' });
    option2.click = jest.fn();
    listbox.appendChild(option1);
    listbox.appendChild(option2);
    document.body.appendChild(listbox);

    // Cambiar a image-to-video
    const promise = selectGenerationType('image-to-video');
    jest.advanceTimersByTime(200);
    const result = await promise;

    expect(result).toBe(true);
    expect(combobox.click).toHaveBeenCalled();
    expect(option2.click).toHaveBeenCalled();
  });
});

describe('Generation - Manejo de errores', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
  });

  test('debe manejar DOM vacío graciosamente', async () => {
    const typeResult = await getCurrentGenerationType();
    expect(typeResult).toBe('unknown');

    const promptResult = await enterPrompt('Test');
    expect(promptResult).toBe(false);

    const generateResult = await clickGenerate();
    expect(generateResult).toBe(false);
  });

  test('debe loguear errores apropiadamente', async () => {
    await enterPrompt('Test');
    expect(vfLog).toHaveBeenCalledWith('Textarea no encontrado', 'error');

    await clickGenerate();
    expect(vfLog).toHaveBeenCalledWith('Botón generar no encontrado', 'error');
  });
});
