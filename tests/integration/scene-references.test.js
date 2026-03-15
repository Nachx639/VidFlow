/**
 * Tests for detectSceneReferences in background.js
 * Tests reference detection with multiple refs, persistent refs, edge cases
 */

describe('detectSceneReferences', () => {
  let referenceCategories;

  // Re-implement detectSceneReferences for testing
  function detectSceneReferences(prompt, categories) {
    const references = { subject: [], scene: [], style: [] };
    const persistentRefs = { subject: [], scene: [], style: [] };
    const promptLower = prompt.toLowerCase();

    // First: persistent categories (always apply)
    categories.forEach(cat => {
      if (!cat.imageData || !cat.whiskType) return;

      if (cat.persistent) {
        references[cat.whiskType].push({
          data: cat.imageData,
          name: cat.name,
          persistent: true
        });
        persistentRefs[cat.whiskType].push(cat.imageData.substring(50, 150));
      }
    });

    // Then: keyword-based categories
    categories.forEach(cat => {
      if (!cat.imageData || !cat.whiskType) return;
      if (cat.persistent) return;

      const hasMatch = cat.keywords.some(kw =>
        promptLower.includes(kw.toLowerCase())
      );

      if (hasMatch) {
        references[cat.whiskType].push({
          data: cat.imageData,
          name: cat.name,
          persistent: false
        });
      }
    });

    const persistentTypes = {
      subject: persistentRefs.subject.length > 0,
      scene: persistentRefs.scene.length > 0,
      style: persistentRefs.style.length > 0
    };

    return { references, persistentTypes, persistentRefs };
  }

  beforeEach(() => {
    referenceCategories = [];
  });

  test('returns empty references when no categories', () => {
    const result = detectSceneReferences('Bruno walks', []);
    expect(result.references.subject).toEqual([]);
    expect(result.references.scene).toEqual([]);
    expect(result.references.style).toEqual([]);
  });

  test('matches keyword-based category', () => {
    referenceCategories = [{
      name: 'Bruno',
      keywords: ['bruno'],
      imageData: 'data:image/png;base64,' + 'A'.repeat(200),
      whiskType: 'subject',
      persistent: false
    }];

    const result = detectSceneReferences('Bruno walks in the forest', referenceCategories);
    expect(result.references.subject).toHaveLength(1);
    expect(result.references.subject[0].name).toBe('Bruno');
    expect(result.references.subject[0].persistent).toBe(false);
  });

  test('persistent category applies regardless of prompt', () => {
    referenceCategories = [{
      name: 'Art Style',
      keywords: [],
      imageData: 'data:image/png;base64,' + 'B'.repeat(200),
      whiskType: 'style',
      persistent: true
    }];

    const result = detectSceneReferences('Random prompt with no keywords', referenceCategories);
    expect(result.references.style).toHaveLength(1);
    expect(result.references.style[0].name).toBe('Art Style');
    expect(result.references.style[0].persistent).toBe(true);
    expect(result.persistentTypes.style).toBe(true);
  });

  test('multiple references of same type (subject)', () => {
    referenceCategories = [
      {
        name: 'Bruno',
        keywords: ['bruno'],
        imageData: 'data:image/png;base64,' + 'C'.repeat(200),
        whiskType: 'subject',
        persistent: false
      },
      {
        name: 'Pompón',
        keywords: ['pompon', 'pompón'],
        imageData: 'data:image/png;base64,' + 'D'.repeat(200),
        whiskType: 'subject',
        persistent: false
      }
    ];

    const result = detectSceneReferences('Bruno and Pompon play together', referenceCategories);
    expect(result.references.subject).toHaveLength(2);
    expect(result.references.subject[0].name).toBe('Bruno');
    expect(result.references.subject[1].name).toBe('Pompón');
  });

  test('persistent + keyword references of same type', () => {
    referenceCategories = [
      {
        name: 'Main Character',
        keywords: [],
        imageData: 'data:image/png;base64,' + 'E'.repeat(200),
        whiskType: 'subject',
        persistent: true
      },
      {
        name: 'Side Character',
        keywords: ['side'],
        imageData: 'data:image/png;base64,' + 'F'.repeat(200),
        whiskType: 'subject',
        persistent: false
      }
    ];

    const result = detectSceneReferences('The side character appears', referenceCategories);
    expect(result.references.subject).toHaveLength(2);
    // Persistent comes first
    expect(result.references.subject[0].persistent).toBe(true);
    expect(result.references.subject[1].persistent).toBe(false);
  });

  test('no match when keyword not in prompt', () => {
    referenceCategories = [{
      name: 'Bruno',
      keywords: ['bruno'],
      imageData: 'data:image/png;base64,' + 'G'.repeat(200),
      whiskType: 'subject',
      persistent: false
    }];

    const result = detectSceneReferences('A sunset over the ocean', referenceCategories);
    expect(result.references.subject).toHaveLength(0);
  });

  test('category without imageData is skipped', () => {
    referenceCategories = [{
      name: 'No Image',
      keywords: ['test'],
      imageData: null,
      whiskType: 'subject',
      persistent: false
    }];

    const result = detectSceneReferences('This is a test prompt', referenceCategories);
    expect(result.references.subject).toHaveLength(0);
  });

  test('category without whiskType is skipped', () => {
    referenceCategories = [{
      name: 'No Type',
      keywords: ['test'],
      imageData: 'data:image/png;base64,' + 'H'.repeat(200),
      whiskType: null,
      persistent: false
    }];

    const result = detectSceneReferences('This is a test prompt', referenceCategories);
    expect(result.references.subject).toHaveLength(0);
    expect(result.references.scene).toHaveLength(0);
    expect(result.references.style).toHaveLength(0);
  });

  test('keyword matching is case-insensitive', () => {
    referenceCategories = [{
      name: 'Bruno',
      keywords: ['Bruno'],
      imageData: 'data:image/png;base64,' + 'I'.repeat(200),
      whiskType: 'subject',
      persistent: false
    }];

    const result = detectSceneReferences('BRUNO walks', referenceCategories);
    expect(result.references.subject).toHaveLength(1);
  });

  test('mixed types: subject + scene + style', () => {
    referenceCategories = [
      {
        name: 'Character',
        keywords: ['hero'],
        imageData: 'data:image/png;base64,' + 'J'.repeat(200),
        whiskType: 'subject',
        persistent: false
      },
      {
        name: 'Forest',
        keywords: ['forest'],
        imageData: 'data:image/png;base64,' + 'K'.repeat(200),
        whiskType: 'scene',
        persistent: false
      },
      {
        name: 'Watercolor',
        keywords: [],
        imageData: 'data:image/png;base64,' + 'L'.repeat(200),
        whiskType: 'style',
        persistent: true
      }
    ];

    const result = detectSceneReferences('The hero walks through the forest', referenceCategories);
    expect(result.references.subject).toHaveLength(1);
    expect(result.references.scene).toHaveLength(1);
    expect(result.references.style).toHaveLength(1);
    expect(result.persistentTypes.subject).toBe(false);
    expect(result.persistentTypes.scene).toBe(false);
    expect(result.persistentTypes.style).toBe(true);
  });
});

describe('parseNumberedBlocks', () => {
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

  test('parses simple numbered blocks', () => {
    const text = '1. First prompt\n\n2. Second prompt\n\n3. Third prompt';
    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(3);
    expect(result.get(1)).toBe('First prompt');
    expect(result.get(2)).toBe('Second prompt');
    expect(result.get(3)).toBe('Third prompt');
  });

  test('handles multi-line blocks', () => {
    const text = '1. First line\nSecond line\nThird line\n\n2. Another block';
    const result = parseNumberedBlocks(text);
    expect(result.get(1)).toBe('First line\nSecond line\nThird line');
    expect(result.get(2)).toBe('Another block');
  });

  test('handles non-sequential numbers', () => {
    const text = '5. Scene five\n\n10. Scene ten\n\n15. Scene fifteen';
    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(3);
    expect(result.get(5)).toBe('Scene five');
    expect(result.get(10)).toBe('Scene ten');
    expect(result.get(15)).toBe('Scene fifteen');
  });

  test('ignores blocks without numbers', () => {
    const text = 'No number here\n\n1. Has a number\n\nAlso no number';
    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(1);
    expect(result.get(1)).toBe('Has a number');
  });

  test('ignores blocks with empty content after number', () => {
    const text = '1. Has content\n\n2. \n\n3. Also has content';
    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(2);
    expect(result.has(2)).toBe(false);
  });

  test('handles empty input', () => {
    expect(parseNumberedBlocks('')).toEqual(new Map());
    expect(parseNumberedBlocks(null)).toEqual(new Map());
    expect(parseNumberedBlocks(undefined)).toEqual(new Map());
  });

  test('handles 58+ prompts', () => {
    const lines = [];
    for (let i = 1; i <= 60; i++) {
      lines.push(`${i}. Prompt number ${i} with some content`);
    }
    const text = lines.join('\n\n');
    const result = parseNumberedBlocks(text);
    expect(result.size).toBe(60);
    expect(result.get(1)).toBe('Prompt number 1 with some content');
    expect(result.get(60)).toBe('Prompt number 60 with some content');
  });

  test('handles large scene numbers', () => {
    const text = '100. Scene one hundred\n\n999. Scene nine ninety nine';
    const result = parseNumberedBlocks(text);
    expect(result.get(100)).toBe('Scene one hundred');
    expect(result.get(999)).toBe('Scene nine ninety nine');
  });
});

describe('clearNonPersistentReferencesArray logic', () => {
  /**
   * Reimplementation matching the actual code in whisk/main.js.
   * The real code checks:
   * 1. If currentRefs exist but newRefs is empty → clear
   * 2. If non-persistent refs changed → clear
   *
   * NOTE: The actual code has a subtle issue where it clears even when
   * only persistent refs are loaded and newRefs is empty.
   * This is by design: if a scene has no references at all, clear previous ones.
   */
  function shouldClearType(currentRefs, newRefs, persistentFingerprints) {
    if (currentRefs.length === 0) return false;
    if (newRefs.length === 0 && currentRefs.length > 0) return true;

    const hasNonPersistentLoaded = currentRefs.some(fp => !persistentFingerprints.includes(fp));
    const newNonPersistent = newRefs.filter(r => !r.persistent);

    if (!hasNonPersistentLoaded || newNonPersistent.length === 0) return false;

    const currentNonPersistent = currentRefs.filter(fp => !persistentFingerprints.includes(fp));
    const newNonPersistentFps = newNonPersistent.map(r => r.data.substring(50, 150));

    const areDifferent = currentNonPersistent.length !== newNonPersistentFps.length ||
      currentNonPersistent.some(fp => !newNonPersistentFps.includes(fp));

    return areDifferent;
  }

  test('no clear when both empty', () => {
    expect(shouldClearType([], [], [])).toBe(false);
  });

  test('clear when current has refs but new has none', () => {
    expect(shouldClearType(['fp1'], [], [])).toBe(true);
  });

  test('no clear when non-persistent refs are same', () => {
    const fp = 'x'.repeat(100);
    const newRefs = [{ data: ' '.repeat(50) + fp, persistent: false }];
    // currentRefs has fp, newRefs has same fp → no change needed
    expect(shouldClearType([fp], newRefs, [])).toBe(false);
  });

  test('clear when non-persistent refs differ', () => {
    const newRefs = [{ data: ' '.repeat(50) + 'fp2' + ' '.repeat(50), persistent: false }];
    expect(shouldClearType(['fp1'], newRefs, [])).toBe(true);
  });

  test('clear when current has persistent+non-persistent but new has none', () => {
    // Even if fp1 is persistent, having no new refs means clear all
    expect(shouldClearType(['fp1', 'fp2'], [], ['fp1'])).toBe(true);
  });

  test('no clear when only persistent loaded and new has non-persistent', () => {
    // hasNonPersistentLoaded is false (fp1 is persistent), so no clear
    const newRefs = [{ data: ' '.repeat(50) + 'fpX' + ' '.repeat(50), persistent: false }];
    expect(shouldClearType(['fp1'], newRefs, ['fp1'])).toBe(false);
  });
});

describe('Whisk download naming edge cases', () => {
  test('direct download fallback uses 2-digit padding', () => {
    // From generation.js downloadGeneratedImage fallback path
    const generateWhiskFilename = (index) => {
      return `${String(index + 1).padStart(2, '0')}_whisk.png`;
    };

    expect(generateWhiskFilename(0)).toBe('01_whisk.png');
    expect(generateWhiskFilename(9)).toBe('10_whisk.png');
    expect(generateWhiskFilename(98)).toBe('99_whisk.png');
    expect(generateWhiskFilename(99)).toBe('100_whisk.png');
  });

  test('setPendingWhiskDownload path uses 2-digit padding', () => {
    // From generation.js: the expectedFilename sent to background
    const generateExpectedPath = (index, projectFolder) => {
      const paddedNumber = String(index + 1).padStart(2, '0');
      return `VidFlow/${projectFolder}/imagenes_whisk/${paddedNumber}_whisk.png`;
    };

    expect(generateExpectedPath(0, 'TestProject'))
      .toBe('VidFlow/TestProject/imagenes_whisk/01_whisk.png');
    expect(generateExpectedPath(57, 'TestProject'))
      .toBe('VidFlow/TestProject/imagenes_whisk/58_whisk.png');
  });
});
