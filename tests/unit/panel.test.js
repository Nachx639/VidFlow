/**
 * Tests para sidepanel/panel.js
 * Funciones del panel lateral de VidFlow
 */

// ========== IMPLEMENTACIONES PARA TESTING ==========

function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textContainsKeyword(text, keywords) {
  const normalizedText = normalizeText(text);
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedText.includes(normalizedKeyword)) {
      return true;
    }
  }
  return false;
}

// Mock state para testing
let mockState = {
  referenceCategories: [],
  analyzedPrompts: [],
  batchImages: [],
  config: { useBatch: false }
};

function analyzePrompt(prompt, index, referenceCategories = mockState.referenceCategories) {
  let matchedCategory = null;
  let maxKeywords = 0;

  for (const cat of referenceCategories) {
    if (cat.keywords.length === 0) continue;

    const allKeywordsMatch = cat.keywords.every(kw =>
      normalizeText(prompt).includes(normalizeText(kw))
    );

    if (allKeywordsMatch) {
      if (cat.keywords.length > maxKeywords) {
        maxKeywords = cat.keywords.length;
        matchedCategory = cat;
      }
    }
  }

  const category = matchedCategory ? matchedCategory.id : 'other';
  const categoryName = matchedCategory ? matchedCategory.name : 'Otro';
  const referenceNeeded = matchedCategory ? matchedCategory.id : null;

  return {
    index,
    prompt,
    category,
    categoryName,
    referenceNeeded,
    matchedCategory
  };
}

function getCategoryLabel(categoryId, referenceCategories = mockState.referenceCategories) {
  if (categoryId === 'other') return 'Otro';
  if (categoryId === 'batch') return 'Batch';
  const cat = referenceCategories.find(c => c.id === categoryId);
  return cat ? cat.name : categoryId;
}

function getCategoryColor(categoryId, referenceCategories = mockState.referenceCategories) {
  const colors = ['bruno', 'pompon', 'both', 'blackboard', 'other'];
  const index = referenceCategories.findIndex(c => c.id === categoryId);
  return colors[index % colors.length] || 'other';
}

// Simular ordenamiento de archivos batch
function sortBatchFiles(files) {
  return [...files].sort((a, b) => {
    const numA = parseInt(a.name.match(/\d+/) || [0]);
    const numB = parseInt(b.name.match(/\d+/) || [0]);
    if (numA !== numB) return numA - numB;
    return a.name.localeCompare(b.name);
  });
}

// ========== TESTS ==========

describe('Panel - normalizeText()', () => {
  test('debe convertir a minúsculas', () => {
    expect(normalizeText('HELLO WORLD')).toBe('hello world');
    expect(normalizeText('MiXeD CaSe')).toBe('mixed case');
  });

  test('debe quitar acentos españoles', () => {
    expect(normalizeText('Pompón')).toBe('pompon');
    expect(normalizeText('niño')).toBe('nino');
    expect(normalizeText('canción')).toBe('cancion');
    expect(normalizeText('también')).toBe('tambien');
  });

  test('debe quitar acentos franceses', () => {
    expect(normalizeText('café')).toBe('cafe');
    expect(normalizeText('naïve')).toBe('naive');
    expect(normalizeText('résumé')).toBe('resume');
  });

  test('debe quitar acentos alemanes', () => {
    expect(normalizeText('über')).toBe('uber');
    expect(normalizeText('Müller')).toBe('muller');
  });

  test('debe normalizar espacios múltiples', () => {
    expect(normalizeText('hello    world')).toBe('hello world');
    expect(normalizeText('  spaces   everywhere  ')).toBe('spaces everywhere');
  });

  test('debe manejar string vacío', () => {
    expect(normalizeText('')).toBe('');
  });

  test('debe manejar null/undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });

  test('debe manejar texto con tabs y newlines', () => {
    expect(normalizeText('hello\t\tworld')).toBe('hello world');
    expect(normalizeText('hello\n\nworld')).toBe('hello world');
  });
});

describe('Panel - textContainsKeyword()', () => {
  test('debe encontrar keyword exacta', () => {
    expect(textContainsKeyword('Bruno walks', ['bruno'])).toBe(true);
    expect(textContainsKeyword('Pompón jumps', ['pompon'])).toBe(true);
  });

  test('debe ser case insensitive', () => {
    expect(textContainsKeyword('BRUNO walks', ['bruno'])).toBe(true);
    expect(textContainsKeyword('bruno walks', ['BRUNO'])).toBe(true);
  });

  test('debe manejar acentos', () => {
    expect(textContainsKeyword('Pompón salta', ['pompon'])).toBe(true);
    expect(textContainsKeyword('Pompon salta', ['pompón'])).toBe(true);
  });

  test('debe encontrar keyword parcial', () => {
    expect(textContainsKeyword('The blackboard is green', ['blackboard'])).toBe(true);
    expect(textContainsKeyword('Un osito pequeño', ['oso'])).toBe(false); // 'osito' no contiene 'oso' como substring
  });

  test('debe buscar en múltiples keywords', () => {
    expect(textContainsKeyword('A bear plays', ['bruno', 'bear', 'oso'])).toBe(true);
    expect(textContainsKeyword('A cat plays', ['bruno', 'bear', 'oso'])).toBe(false);
  });

  test('debe retornar false si no hay match', () => {
    expect(textContainsKeyword('A beautiful sunset', ['bruno', 'pompon'])).toBe(false);
  });

  test('debe manejar keywords vacías', () => {
    expect(textContainsKeyword('Bruno walks', [])).toBe(false);
  });
});

describe('Panel - analyzePrompt()', () => {
  beforeEach(() => {
    // Nota: La función real require que TODAS las keywords coincidan
    mockState.referenceCategories = [
      { id: 'cat1', name: 'Bruno', keywords: ['bruno'] }, // Solo 1 keyword
      { id: 'cat2', name: 'Pompón', keywords: ['pompon'] }, // Solo 1 keyword
      { id: 'cat3', name: 'Both', keywords: ['bruno', 'pompon'] }, // 2 keywords
    ];
  });

  test('debe categorizar prompt con keyword simple', () => {
    const result = analyzePrompt('Bruno walks in the park', 0, mockState.referenceCategories);
    expect(result.category).toBe('cat1');
    expect(result.categoryName).toBe('Bruno');
  });

  test('debe categorizar como "other" sin keywords', () => {
    const result = analyzePrompt('A beautiful sunset', 0, mockState.referenceCategories);
    expect(result.category).toBe('other');
    expect(result.categoryName).toBe('Otro');
    expect(result.referenceNeeded).toBeNull();
  });

  test('debe priorizar categoría más específica (más keywords)', () => {
    // 'Both' tiene 2 keywords que deben coincidir ambas
    const result = analyzePrompt('Bruno and Pompon play together', 0, mockState.referenceCategories);
    expect(result.category).toBe('cat3');
    expect(result.categoryName).toBe('Both');
  });

  test('debe preservar el índice original', () => {
    const result = analyzePrompt('Test prompt', 5, mockState.referenceCategories);
    expect(result.index).toBe(5);
  });

  test('debe preservar el prompt original', () => {
    const original = 'Bruno (a cute bear) walks happily';
    const result = analyzePrompt(original, 0, mockState.referenceCategories);
    expect(result.prompt).toBe(original);
  });

  test('debe manejar categorías sin keywords', () => {
    const categories = [
      { id: 'empty', name: 'Empty', keywords: [] },
      { id: 'bruno', name: 'Bruno', keywords: ['bruno'] },
    ];
    const result = analyzePrompt('Bruno walks', 0, categories);
    expect(result.category).toBe('bruno');
  });

  test('debe requerir TODAS las keywords de una categoría', () => {
    const categories = [
      { id: 'specific', name: 'Specific', keywords: ['bruno', 'forest', 'night'] },
      { id: 'bruno', name: 'Bruno', keywords: ['bruno'] },
    ];

    // Solo tiene 'bruno', no todas las keywords de 'specific'
    const result1 = analyzePrompt('Bruno walks in the park', 0, categories);
    expect(result1.category).toBe('bruno');

    // Tiene todas las keywords de 'specific'
    const result2 = analyzePrompt('Bruno in the forest at night', 0, categories);
    expect(result2.category).toBe('specific');
  });
});

describe('Panel - getCategoryLabel()', () => {
  beforeEach(() => {
    mockState.referenceCategories = [
      { id: 'cat1', name: 'Bruno Character' },
      { id: 'cat2', name: 'Pompón Bunny' },
    ];
  });

  test('debe retornar "Otro" para "other"', () => {
    expect(getCategoryLabel('other')).toBe('Otro');
  });

  test('debe retornar "Batch" para "batch"', () => {
    expect(getCategoryLabel('batch')).toBe('Batch');
  });

  test('debe retornar nombre de categoría existente', () => {
    expect(getCategoryLabel('cat1', mockState.referenceCategories)).toBe('Bruno Character');
    expect(getCategoryLabel('cat2', mockState.referenceCategories)).toBe('Pompón Bunny');
  });

  test('debe retornar el id si no encuentra categoría', () => {
    expect(getCategoryLabel('unknown', mockState.referenceCategories)).toBe('unknown');
  });
});

describe('Panel - getCategoryColor()', () => {
  beforeEach(() => {
    mockState.referenceCategories = [
      { id: 'cat1', name: 'First' },
      { id: 'cat2', name: 'Second' },
      { id: 'cat3', name: 'Third' },
      { id: 'cat4', name: 'Fourth' },
      { id: 'cat5', name: 'Fifth' },
      { id: 'cat6', name: 'Sixth' },
    ];
  });

  test('debe asignar colores cíclicamente', () => {
    expect(getCategoryColor('cat1', mockState.referenceCategories)).toBe('bruno');
    expect(getCategoryColor('cat2', mockState.referenceCategories)).toBe('pompon');
    expect(getCategoryColor('cat3', mockState.referenceCategories)).toBe('both');
    expect(getCategoryColor('cat4', mockState.referenceCategories)).toBe('blackboard');
    expect(getCategoryColor('cat5', mockState.referenceCategories)).toBe('other');
    expect(getCategoryColor('cat6', mockState.referenceCategories)).toBe('bruno'); // Vuelve al inicio
  });

  test('debe retornar "other" para categoría no encontrada', () => {
    expect(getCategoryColor('unknown', mockState.referenceCategories)).toBe('other');
  });
});

describe('Panel - sortBatchFiles()', () => {
  test('debe ordenar archivos por número en nombre', () => {
    const files = [
      { name: 'image3.png' },
      { name: 'image1.png' },
      { name: 'image2.png' },
    ];

    const sorted = sortBatchFiles(files);
    expect(sorted[0].name).toBe('image1.png');
    expect(sorted[1].name).toBe('image2.png');
    expect(sorted[2].name).toBe('image3.png');
  });

  test('debe manejar números con diferentes longitudes', () => {
    const files = [
      { name: 'img10.png' },
      { name: 'img2.png' },
      { name: 'img1.png' },
    ];

    const sorted = sortBatchFiles(files);
    expect(sorted[0].name).toBe('img1.png');
    expect(sorted[1].name).toBe('img2.png');
    expect(sorted[2].name).toBe('img10.png');
  });

  test('debe ordenar alfabéticamente si no hay números', () => {
    const files = [
      { name: 'charlie.png' },
      { name: 'alpha.png' },
      { name: 'bravo.png' },
    ];

    const sorted = sortBatchFiles(files);
    expect(sorted[0].name).toBe('alpha.png');
    expect(sorted[1].name).toBe('bravo.png');
    expect(sorted[2].name).toBe('charlie.png');
  });

  test('debe ordenar alfabéticamente si los números son iguales', () => {
    const files = [
      { name: 'scene1_c.png' },
      { name: 'scene1_a.png' },
      { name: 'scene1_b.png' },
    ];

    const sorted = sortBatchFiles(files);
    expect(sorted[0].name).toBe('scene1_a.png');
    expect(sorted[1].name).toBe('scene1_b.png');
    expect(sorted[2].name).toBe('scene1_c.png');
  });

  test('debe manejar lista vacía', () => {
    const sorted = sortBatchFiles([]);
    expect(sorted).toEqual([]);
  });

  test('debe manejar un solo archivo', () => {
    const files = [{ name: 'only.png' }];
    const sorted = sortBatchFiles(files);
    expect(sorted.length).toBe(1);
    expect(sorted[0].name).toBe('only.png');
  });

  test('debe manejar números al principio, medio y final', () => {
    const files = [
      { name: '3_image.png' },
      { name: '1_image.png' },
      { name: '2_image.png' },
    ];

    const sorted = sortBatchFiles(files);
    expect(sorted[0].name).toBe('1_image.png');
    expect(sorted[1].name).toBe('2_image.png');
    expect(sorted[2].name).toBe('3_image.png');
  });
});

describe('Panel - Integración análisis de prompts', () => {
  test('debe analizar múltiples prompts correctamente', () => {
    // Nota: La función requiere que TODAS las keywords coincidan
    const categories = [
      { id: 'bruno', name: 'Bruno', keywords: ['bruno'] }, // Solo 1 keyword
      { id: 'pompon', name: 'Pompón', keywords: ['pompon'] }, // Solo 1 keyword
    ];

    const prompts = [
      'Bruno walks in the forest',
      'Pompón jumps over flowers',
      'A beautiful sunset',
      'Bruno plays with toys',
    ];

    const results = prompts.map((p, i) => analyzePrompt(p, i, categories));

    expect(results[0].category).toBe('bruno');
    expect(results[1].category).toBe('pompon');
    expect(results[2].category).toBe('other');
    expect(results[3].category).toBe('bruno');
  });

  test('debe manejar prompts con acentos', () => {
    const categories = [
      { id: 'pompon', name: 'Pompón', keywords: ['pompon'] },
    ];

    const result1 = analyzePrompt('Pompón salta feliz', 0, categories);
    const result2 = analyzePrompt('Pompon salta feliz', 0, categories);

    expect(result1.category).toBe('pompon');
    expect(result2.category).toBe('pompon');
  });
});

describe('Panel - Estado del botón Start', () => {
  // Simular lógica de updateStartButton
  function canStartAutomation(analyzedPrompts, batchImages, referenceCategories, useBatch) {
    if (analyzedPrompts.length === 0) {
      return { canStart: false, reason: 'no-prompts' };
    }

    if (useBatch) {
      if (batchImages.length === 0) {
        return { canStart: false, reason: 'no-batch' };
      }
      if (batchImages.length < analyzedPrompts.length) {
        return { canStart: false, reason: 'insufficient-batch' };
      }
      return { canStart: true, reason: 'batch-ready' };
    }

    // Modo normal: verificar referencias
    const neededRefIds = new Set(
      analyzedPrompts
        .map(p => p.referenceNeeded)
        .filter(r => r && r !== 'other')
    );

    const missingRefs = [...neededRefIds].filter(refId => {
      const cat = referenceCategories.find(c => c.id === refId);
      return cat && !cat.imageData;
    });

    if (missingRefs.length > 0) {
      return { canStart: false, reason: 'missing-refs', missing: missingRefs };
    }

    return { canStart: true, reason: 'ready' };
  }

  test('no puede iniciar sin prompts analizados', () => {
    const result = canStartAutomation([], [], [], false);
    expect(result.canStart).toBe(false);
    expect(result.reason).toBe('no-prompts');
  });

  test('no puede iniciar en modo batch sin imágenes', () => {
    const prompts = [{ referenceNeeded: null }];
    const result = canStartAutomation(prompts, [], [], true);
    expect(result.canStart).toBe(false);
    expect(result.reason).toBe('no-batch');
  });

  test('no puede iniciar en modo batch con imágenes insuficientes', () => {
    const prompts = [{ referenceNeeded: null }, { referenceNeeded: null }, { referenceNeeded: null }];
    const images = [{ name: 'img1.png' }];
    const result = canStartAutomation(prompts, images, [], true);
    expect(result.canStart).toBe(false);
    expect(result.reason).toBe('insufficient-batch');
  });

  test('puede iniciar en modo batch con suficientes imágenes', () => {
    const prompts = [{ referenceNeeded: null }, { referenceNeeded: null }];
    const images = [{ name: 'img1.png' }, { name: 'img2.png' }];
    const result = canStartAutomation(prompts, images, [], true);
    expect(result.canStart).toBe(true);
    expect(result.reason).toBe('batch-ready');
  });

  test('no puede iniciar si falta imagen de referencia', () => {
    const prompts = [{ referenceNeeded: 'cat1' }];
    const categories = [{ id: 'cat1', name: 'Bruno', imageData: null }];
    const result = canStartAutomation(prompts, [], categories, false);
    expect(result.canStart).toBe(false);
    expect(result.reason).toBe('missing-refs');
    expect(result.missing).toContain('cat1');
  });

  test('puede iniciar si tiene todas las referencias', () => {
    const prompts = [{ referenceNeeded: 'cat1' }];
    const categories = [{ id: 'cat1', name: 'Bruno', imageData: 'data:image/png;base64,...' }];
    const result = canStartAutomation(prompts, [], categories, false);
    expect(result.canStart).toBe(true);
    expect(result.reason).toBe('ready');
  });

  test('puede iniciar si prompts no necesitan referencias', () => {
    const prompts = [{ referenceNeeded: null }, { referenceNeeded: 'other' }];
    const result = canStartAutomation(prompts, [], [], false);
    expect(result.canStart).toBe(true);
  });
});
