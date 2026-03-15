/**
 * Deep tests for sidepanel/panel.js
 * Tests prompt parsing, reference matching, pipeline config
 */

// Replicate parseNumberedBlocks from panel.js
function parseNumberedBlocks(text) {
  if (!text || !text.trim()) return new Map();

  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);
  const result = new Map();

  blocks.forEach(block => {
    const match = block.match(/^(\d+)\.\s*([\s\S]*)/);
    if (match) {
      const num = parseInt(match[1], 10);
      const content = match[2].trim();
      if (content) {
        result.set(num, content);
      }
    }
  });

  return result;
}

function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Replicate getWhiskReferencesForPrompt logic
function getWhiskReferencesForPrompt(promptText, referenceCategories) {
  const references = { subject: null, scene: null, style: null };

  for (const cat of referenceCategories) {
    if (!cat.imageData || !cat.whiskType) continue;
    if (cat.keywords.length === 0) continue;

    const normalizedPrompt = normalizeText(promptText);
    const allKeywordsMatch = cat.keywords.every(kw =>
      normalizedPrompt.includes(normalizeText(kw))
    );

    if (allKeywordsMatch) {
      references[cat.whiskType] = cat.imageData;
    }
  }

  // Also add categories without keywords as global references
  for (const cat of referenceCategories) {
    if (!cat.imageData || !cat.whiskType) continue;
    if (cat.keywords.length === 0 && !references[cat.whiskType]) {
      references[cat.whiskType] = cat.imageData;
    }
  }

  return references;
}

// Replicate generateAutoFolderName
function generateAutoFolderName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  return `Proyecto_${year}${month}${day}_${hours}${mins}`;
}

describe('Panel - parseNumberedBlocks()', () => {
  test('should parse basic numbered blocks', () => {
    const text = `1. First block

2. Second block`;

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(2);
    expect(result.get(1)).toBe('First block');
    expect(result.get(2)).toBe('Second block');
  });

  test('should handle multi-line blocks', () => {
    const text = `1. Objects: A treehouse
Action: Golden light
Style: 3D Pixar

2. Objects: An owl
Action: Turns head`;

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(2);
    expect(result.get(1)).toContain('Objects: A treehouse');
    expect(result.get(1)).toContain('Style: 3D Pixar');
  });

  test('should handle non-sequential numbers', () => {
    const text = `1. Scene one

5. Scene five

10. Scene ten`;

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(3);
    expect(result.get(1)).toBe('Scene one');
    expect(result.get(5)).toBe('Scene five');
    expect(result.get(10)).toBe('Scene ten');
  });

  test('should skip blocks without numbers', () => {
    const text = `1. Valid block

No number here

3. Another valid`;

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(2);
    expect(result.has(1)).toBe(true);
    expect(result.has(3)).toBe(true);
  });

  test('should skip blocks with empty content after number', () => {
    const text = `1.

2. Valid content`;

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(1);
    expect(result.get(2)).toBe('Valid content');
  });

  test('should handle empty string', () => {
    expect(parseNumberedBlocks('')).toEqual(new Map());
    expect(parseNumberedBlocks('   ')).toEqual(new Map());
  });

  test('should handle null/undefined', () => {
    expect(parseNumberedBlocks(null)).toEqual(new Map());
    expect(parseNumberedBlocks(undefined)).toEqual(new Map());
  });

  test('should handle unicode in content', () => {
    const text = `1. 🏠 Una casa mágica con árboles

2. 🦉 Un búho con gafas grandes`;

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(2);
    expect(result.get(1)).toContain('🏠');
    expect(result.get(2)).toContain('búho');
  });

  test('should handle special characters', () => {
    const text = `1. Objects: A "magical" tree-house (with lights)
Action: Soft golden light [emanates] from windows.`;

    const result = parseNumberedBlocks(text);
    expect(result.get(1)).toContain('"magical"');
    expect(result.get(1)).toContain('[emanates]');
  });

  test('should handle large numbers', () => {
    const text = `100. Scene one hundred

999. Scene nine ninety nine`;

    const result = parseNumberedBlocks(text);
    expect(result.get(100)).toBe('Scene one hundred');
    expect(result.get(999)).toBe('Scene nine ninety nine');
  });

  test('should handle duplicate numbers (last wins)', () => {
    const text = `1. First version

1. Second version`;

    const result = parseNumberedBlocks(text);
    expect(result.get(1)).toBe('Second version');
  });

  test('should handle single block', () => {
    const text = `1. Only one scene here`;
    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(1);
    expect(result.get(1)).toBe('Only one scene here');
  });

  test('should handle multiple blank lines between blocks', () => {
    const text = `1. Block one



2. Block two`;

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(2);
  });

  test('should handle 58 prompts efficiently', () => {
    const blocks = [];
    for (let i = 1; i <= 58; i++) {
      blocks.push(`${i}. Scene ${i}: A beautiful landscape with ${i} elements.`);
    }
    const text = blocks.join('\n\n');

    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(58);
    expect(result.get(1)).toContain('Scene 1');
    expect(result.get(58)).toContain('Scene 58');
  });
});

describe('Panel - getWhiskReferencesForPrompt()', () => {
  test('should match category by keyword', () => {
    const categories = [
      { id: 'cat1', name: 'Bear', keywords: ['bear'], imageData: 'img1', whiskType: 'subject' },
    ];

    const refs = getWhiskReferencesForPrompt('A bear walks in the forest', categories);
    expect(refs.subject).toBe('img1');
    expect(refs.scene).toBeNull();
    expect(refs.style).toBeNull();
  });

  test('should require ALL keywords to match', () => {
    const categories = [
      { id: 'cat1', name: 'Night Bear', keywords: ['bear', 'night'], imageData: 'img1', whiskType: 'subject' },
    ];

    const refs1 = getWhiskReferencesForPrompt('A bear walks in the sun', categories);
    expect(refs1.subject).toBeNull();

    const refs2 = getWhiskReferencesForPrompt('A bear walks at night', categories);
    expect(refs2.subject).toBe('img1');
  });

  test('should assign categories without keywords as global refs', () => {
    const categories = [
      { id: 'cat1', name: 'Global Style', keywords: [], imageData: 'style_img', whiskType: 'style' },
    ];

    const refs = getWhiskReferencesForPrompt('Any prompt text', categories);
    expect(refs.style).toBe('style_img');
  });

  test('should not override keyword-matched ref with global ref', () => {
    const categories = [
      { id: 'cat1', name: 'Specific Style', keywords: ['magic'], imageData: 'specific', whiskType: 'style' },
      { id: 'cat2', name: 'Global Style', keywords: [], imageData: 'global', whiskType: 'style' },
    ];

    const refs = getWhiskReferencesForPrompt('A magic forest', categories);
    expect(refs.style).toBe('specific');
  });

  test('should handle multiple types', () => {
    const categories = [
      { id: 'cat1', name: 'Bear', keywords: ['bear'], imageData: 'bear_img', whiskType: 'subject' },
      { id: 'cat2', name: 'Forest', keywords: ['forest'], imageData: 'forest_img', whiskType: 'scene' },
      { id: 'cat3', name: 'Pixar', keywords: ['pixar'], imageData: 'pixar_img', whiskType: 'style' },
    ];

    const refs = getWhiskReferencesForPrompt('A bear in the pixar forest', categories);
    expect(refs.subject).toBe('bear_img');
    expect(refs.scene).toBe('forest_img');
    expect(refs.style).toBe('pixar_img');
  });

  test('should skip categories without imageData', () => {
    const categories = [
      { id: 'cat1', name: 'Empty', keywords: ['bear'], imageData: null, whiskType: 'subject' },
    ];

    const refs = getWhiskReferencesForPrompt('A bear', categories);
    expect(refs.subject).toBeNull();
  });

  test('should skip categories without whiskType', () => {
    const categories = [
      { id: 'cat1', name: 'NoType', keywords: ['bear'], imageData: 'img', whiskType: null },
    ];

    const refs = getWhiskReferencesForPrompt('A bear', categories);
    expect(refs.subject).toBeNull();
  });

  test('should handle accent-insensitive matching', () => {
    const categories = [
      { id: 'cat1', name: 'Pompón', keywords: ['pompón'], imageData: 'img', whiskType: 'subject' },
    ];

    const refs = getWhiskReferencesForPrompt('Pompon walks', categories);
    expect(refs.subject).toBe('img');
  });
});

describe('Panel - Scene/Narration pairing', () => {
  test('should pair prompts and narrations by scene number', () => {
    const promptsText = `1. Prompt one

2. Prompt two

3. Prompt three`;

    const narrationsText = `1. Narration one

3. Narration three`;

    const promptsMap = parseNumberedBlocks(promptsText);
    const narrationsMap = parseNumberedBlocks(narrationsText);

    const sceneNumbers = Array.from(promptsMap.keys()).sort((a, b) => a - b);
    const scenes = sceneNumbers.map(num => ({
      sceneNumber: num,
      prompt: promptsMap.get(num),
      narration: narrationsMap.get(num) || ''
    }));

    expect(scenes).toHaveLength(3);
    expect(scenes[0].narration).toBe('Narration one');
    expect(scenes[1].narration).toBe(''); // No narration for scene 2
    expect(scenes[2].narration).toBe('Narration three');
  });

  test('should handle narrations without matching prompts (ignored)', () => {
    const promptsText = `1. Only prompt`;
    const narrationsText = `1. Matching narration

5. Orphaned narration`;

    const promptsMap = parseNumberedBlocks(promptsText);
    const narrationsMap = parseNumberedBlocks(narrationsText);

    const sceneNumbers = Array.from(promptsMap.keys());
    const scenes = sceneNumbers.map(num => ({
      sceneNumber: num,
      prompt: promptsMap.get(num),
      narration: narrationsMap.get(num) || ''
    }));

    expect(scenes).toHaveLength(1);
    expect(scenes[0].narration).toBe('Matching narration');
  });
});

describe('Panel - Pipeline step configuration', () => {
  test('getStepOrder returns correct order', () => {
    function getStepOrder(step) {
      const order = { 'whisk': 0, 'flow': 1, 'speech': 2 };
      return order[step] ?? -1;
    }

    expect(getStepOrder('whisk')).toBe(0);
    expect(getStepOrder('flow')).toBe(1);
    expect(getStepOrder('speech')).toBe(2);
    expect(getStepOrder('unknown')).toBe(-1);
  });

  test('parallel mode requires speech + at least one other step', () => {
    function canParallel(runWhisk, runFlow, runSpeech) {
      return runSpeech && (runWhisk || runFlow);
    }

    expect(canParallel(true, true, true)).toBe(true);
    expect(canParallel(true, false, true)).toBe(true);
    expect(canParallel(false, true, true)).toBe(true);
    expect(canParallel(true, true, false)).toBe(false);
    expect(canParallel(false, false, true)).toBe(false);
    expect(canParallel(true, false, false)).toBe(false);
  });
});

describe('Panel - Folder name generation', () => {
  test('should generate folder name with correct format', () => {
    const date = new Date(2026, 1, 8, 4, 4); // Feb 8, 2026 04:04
    const name = generateAutoFolderName(date);
    expect(name).toBe('Proyecto_20260208_0404');
  });

  test('should pad single digit months', () => {
    const date = new Date(2026, 0, 1, 0, 0); // Jan 1
    const name = generateAutoFolderName(date);
    expect(name).toBe('Proyecto_20260101_0000');
  });

  test('should handle December', () => {
    const date = new Date(2026, 11, 31, 23, 59);
    const name = generateAutoFolderName(date);
    expect(name).toBe('Proyecto_20261231_2359');
  });
});
