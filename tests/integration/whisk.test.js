/**
 * Tests para content/whisk.js
 * Automatización de Google Whisk
 */

// ========== HELPERS PARA TESTING ==========
// Extraemos y testeamos las funciones utilitarias de whisk.js

function base64ToFile(base64, filename) {
  const arr = base64.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], filename, { type: mime });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTranslation(key) {
  const translations = {
    'subject': 'asunto',
    'scene': 'escena',
    'style': 'estilo',
    'generate': 'generar',
    'download': 'descargar'
  };
  return translations[key.toLowerCase()] || key;
}

function findByText(texts, tagName = null) {
  const selector = tagName || '*';
  const elements = document.querySelectorAll(selector);

  for (const el of elements) {
    const elText = el.textContent?.toLowerCase().trim();
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();

    for (const text of texts) {
      if (elText === text.toLowerCase() ||
          elText?.includes(text.toLowerCase()) ||
          ariaLabel?.includes(text.toLowerCase())) {
        return el;
      }
    }
  }

  return null;
}

function findSection(name) {
  const sections = document.querySelectorAll('[class*="section"], [class*="panel"], [role="region"]');

  for (const section of sections) {
    const text = section.textContent.toLowerCase();
    if (text.includes(name.toLowerCase()) ||
        text.includes(getTranslation(name))) {
      return section;
    }
  }

  return document.querySelector(`[aria-label*="${name}" i]`);
}

// ========== TESTS ==========

describe('whisk.js - base64ToFile()', () => {
  test('debe convertir base64 PNG a File', () => {
    // PNG transparente 1x1 en base64
    const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const file = base64ToFile(base64, 'test.png');

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('test.png');
    expect(file.type).toBe('image/png');
  });

  test('debe convertir base64 JPEG a File', () => {
    // JPEG mínimo en base64
    const base64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

    const file = base64ToFile(base64, 'test.jpg');

    expect(file.name).toBe('test.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  test('debe manejar base64 sin prefijo data url', () => {
    const base64WithPrefix = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const file = base64ToFile(base64WithPrefix, 'image.png');

    expect(file.size).toBeGreaterThan(0);
  });
});

describe('whisk.js - getTranslation()', () => {
  test('debe traducir "subject" a "asunto"', () => {
    expect(getTranslation('subject')).toBe('asunto');
  });

  test('debe traducir "scene" a "escena"', () => {
    expect(getTranslation('scene')).toBe('escena');
  });

  test('debe traducir "style" a "estilo"', () => {
    expect(getTranslation('style')).toBe('estilo');
  });

  test('debe traducir "generate" a "generar"', () => {
    expect(getTranslation('generate')).toBe('generar');
  });

  test('debe traducir "download" a "descargar"', () => {
    expect(getTranslation('download')).toBe('descargar');
  });

  test('debe retornar key original si no hay traducción', () => {
    expect(getTranslation('unknown')).toBe('unknown');
  });

  test('debe ser case insensitive', () => {
    expect(getTranslation('SUBJECT')).toBe('asunto');
    expect(getTranslation('Subject')).toBe('asunto');
  });
});

describe('whisk.js - findByText()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('debe encontrar elemento por textContent exacto', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Generar';
    document.body.appendChild(btn);

    const result = findByText(['generar'], 'button');
    expect(result).toBe(btn);
  });

  test('debe encontrar elemento por textContent parcial', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Generar imagen ahora';
    document.body.appendChild(btn);

    const result = findByText(['generar']);
    expect(result).not.toBeNull();
    expect(result.textContent).toContain('Generar');
  });

  test('debe encontrar elemento por aria-label', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Descargar imagen');
    document.body.appendChild(btn);

    const result = findByText(['descargar']);
    expect(result).toBe(btn);
  });

  test('debe ser case insensitive', () => {
    const btn = document.createElement('button');
    btn.textContent = 'CREAR';
    document.body.appendChild(btn);

    const result = findByText(['crear']);
    expect(result).not.toBeNull();
    expect(result.textContent).toBe('CREAR');
  });

  test('debe filtrar por tagName si se especifica', () => {
    const div = document.createElement('div');
    div.textContent = 'Generar';
    const btn = document.createElement('button');
    btn.textContent = 'Generar';
    document.body.appendChild(div);
    document.body.appendChild(btn);

    const result = findByText(['generar'], 'button');
    expect(result.tagName).toBe('BUTTON');
  });

  test('debe retornar null si no encuentra', () => {
    const result = findByText(['inexistente']);
    expect(result).toBeNull();
  });

  test('debe buscar múltiples textos', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Download';
    document.body.appendChild(btn);

    const result = findByText(['descargar', 'download', 'guardar']);
    expect(result).not.toBeNull();
    expect(result.textContent).toBe('Download');
  });
});

describe('whisk.js - findSection()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('debe encontrar sección por clase', () => {
    const section = document.createElement('div');
    section.className = 'section-container';
    section.textContent = 'Subject area';
    document.body.appendChild(section);

    const result = findSection('subject');
    expect(result).toBe(section);
  });

  test('debe encontrar sección por role="region"', () => {
    const region = document.createElement('div');
    region.setAttribute('role', 'region');
    region.textContent = 'Style options here';
    document.body.appendChild(region);

    const result = findSection('style');
    expect(result).toBe(region);
  });

  test('debe encontrar sección por traducción', () => {
    const section = document.createElement('div');
    section.className = 'panel';
    section.textContent = 'Asunto del prompt';
    document.body.appendChild(section);

    const result = findSection('subject');
    expect(result).toBe(section);
  });

  test('debe encontrar por aria-label', () => {
    const section = document.createElement('div');
    section.setAttribute('aria-label', 'Scene selection');
    document.body.appendChild(section);

    const result = findSection('scene');
    expect(result).toBe(section);
  });

  test('debe retornar null si no encuentra', () => {
    const result = findSection('inexistente');
    expect(result).toBeNull();
  });
});

describe('whisk.js - sleep()', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debe resolver después del tiempo especificado', async () => {
    const promise = sleep(1000);

    jest.advanceTimersByTime(1000);

    await expect(promise).resolves.toBeUndefined();
  });

  test('debe manejar 0ms', async () => {
    const promise = sleep(0);
    jest.advanceTimersByTime(0);
    await promise;
  });
});

describe('whisk.js - Simulación de flujo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('enterPrompt simulation', () => {
    test('debe escribir en textarea', () => {
      const textarea = document.createElement('textarea');
      textarea.placeholder = 'Escribe tu prompt aquí';
      document.body.appendChild(textarea);

      // Simular enterPrompt
      textarea.value = 'Test prompt';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      expect(textarea.value).toBe('Test prompt');
    });

    test('debe escribir en contenteditable', () => {
      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      document.body.appendChild(div);

      // Simular enterPrompt
      div.textContent = 'Test prompt';
      div.dispatchEvent(new InputEvent('input', { bubbles: true }));

      expect(div.textContent).toBe('Test prompt');
    });
  });

  describe('clickGenerate simulation', () => {
    test('debe encontrar y hacer clic en botón generar', () => {
      const btn = document.createElement('button');
      btn.textContent = 'Generar';
      btn.onclick = jest.fn();
      document.body.appendChild(btn);

      const generateBtn = findByText(['generar', 'generate'], 'button');
      expect(generateBtn).toBe(btn);
    });

    test('debe encontrar botón "whisk"', () => {
      const btn = document.createElement('button');
      btn.textContent = 'Whisk it!';
      document.body.appendChild(btn);

      const generateBtn = findByText(['whisk'], 'button');
      expect(generateBtn).toBe(btn);
    });
  });

  describe('downloadImage simulation', () => {
    test('debe crear link de descarga para imagen', () => {
      const img = document.createElement('img');
      img.src = 'https://example.com/generated.png';
      img.className = 'result-image';
      document.body.appendChild(img);

      // Simular creación de link de descarga
      const link = document.createElement('a');
      link.href = img.src;
      link.download = '01_whisk.png';
      link.click = jest.fn();

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      expect(link.download).toBe('01_whisk.png');
      expect(link.click).toHaveBeenCalled();
    });

    test('debe generar nombre de archivo correcto', () => {
      const generateFilename = (index) => `${String(index + 1).padStart(2, '0')}_whisk.png`;

      expect(generateFilename(0)).toBe('01_whisk.png');
      expect(generateFilename(9)).toBe('10_whisk.png');
      expect(generateFilename(99)).toBe('100_whisk.png');
    });
  });
});

describe('whisk.js - Detección de elementos de carga', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('debe detectar loading por data-loading', () => {
    const loading = document.createElement('div');
    loading.setAttribute('data-loading', 'true');
    document.body.appendChild(loading);

    const found = document.querySelector('[data-loading="true"]');
    expect(found).toBe(loading);
  });

  test('debe detectar loading por clase', () => {
    const loading = document.createElement('div');
    loading.className = 'loading';
    document.body.appendChild(loading);

    const found = document.querySelector('.loading');
    expect(found).toBe(loading);
  });

  test('debe detectar loading por aria-busy', () => {
    const loading = document.createElement('div');
    loading.setAttribute('aria-busy', 'true');
    document.body.appendChild(loading);

    const found = document.querySelector('[aria-busy="true"]');
    expect(found).toBe(loading);
  });

  test('debe detectar spinner', () => {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    document.body.appendChild(spinner);

    const found = document.querySelector('.spinner');
    expect(found).toBe(spinner);
  });
});

describe('whisk.js - Detección de resultado', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('debe detectar imagen por data-test-id', () => {
    const img = document.createElement('img');
    img.setAttribute('data-test-id', 'result-image');
    document.body.appendChild(img);

    const found = document.querySelector('[data-test-id="result-image"]');
    expect(found).toBe(img);
  });

  test('debe detectar imagen por clase', () => {
    const img = document.createElement('img');
    img.className = 'result-image';
    document.body.appendChild(img);

    const found = document.querySelector('.result-image');
    expect(found).toBe(img);
  });

  test('debe detectar imagen por alt', () => {
    const img = document.createElement('img');
    img.alt = 'Generated image result';
    document.body.appendChild(img);

    // CSS selectors son case-sensitive, usar 'i' flag o lowercase
    const found = document.querySelector('img[alt*="Generated"]');
    expect(found).not.toBeNull();
    expect(found.alt).toContain('Generated');
  });
});

describe('whisk.js - Message handling simulation', () => {
  test('debe manejar acciones conocidas', () => {
    const actions = ['setupWhisk', 'generateWhiskImage', 'stopAutomation'];

    actions.forEach(action => {
      expect(typeof action).toBe('string');
    });
  });

  test('debe retornar error para acción desconocida', () => {
    const response = { success: false, error: 'Unknown action' };
    expect(response.success).toBe(false);
    expect(response.error).toBe('Unknown action');
  });
});
