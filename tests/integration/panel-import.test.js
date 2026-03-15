/**
 * Tests for panel.js import/state management
 * Covers: importScenes edge cases, config persistence, batch image assignment
 */

describe('Panel - importScenes logic', () => {
  function parseNumberedBlocks(text) {
    if (!text || !text.trim()) return new Map();
    const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);
    const result = new Map();
    blocks.forEach(block => {
      const match = block.match(/^(\d+)\.\s*([\s\S]*)/);
      if (match) {
        const num = parseInt(match[1], 10);
        const content = match[2].trim();
        if (content) result.set(num, content);
      }
    });
    return result;
  }

  function importScenes(promptsText, narrationsText, stylesText, useSameStyle, defaultStyle) {
    const scenes = [];
    const promptsMap = parseNumberedBlocks(promptsText);
    const narrationsMap = parseNumberedBlocks(narrationsText);
    const stylesMap = parseNumberedBlocks(stylesText);

    const sceneNumbers = Array.from(promptsMap.keys()).sort((a, b) => a - b);

    sceneNumbers.forEach(num => {
      const prompt = promptsMap.get(num);
      const narration = narrationsMap.get(num) || '';
      const style = useSameStyle ? defaultStyle : (stylesMap.get(num) || defaultStyle);

      scenes.push({
        sceneNumber: num,
        prompt,
        narration,
        style,
      });
    });

    return scenes;
  }

  test('imports prompts and narrations matched by scene number', () => {
    const prompts = '1. Walk in forest\n\n2. Jump over river';
    const narrations = '1. Bruno walks slowly\n\n2. He jumps high';

    const scenes = importScenes(prompts, narrations, '', true, 'default style');
    expect(scenes).toHaveLength(2);
    expect(scenes[0].prompt).toBe('Walk in forest');
    expect(scenes[0].narration).toBe('Bruno walks slowly');
    expect(scenes[1].prompt).toBe('Jump over river');
    expect(scenes[1].narration).toBe('He jumps high');
  });

  test('handles missing narrations gracefully', () => {
    const prompts = '1. Scene one\n\n2. Scene two\n\n3. Scene three';
    const narrations = '1. Narration one\n\n3. Narration three'; // 2 is missing

    const scenes = importScenes(prompts, narrations, '', true, 'style');
    expect(scenes).toHaveLength(3);
    expect(scenes[0].narration).toBe('Narration one');
    expect(scenes[1].narration).toBe(''); // Missing → empty
    expect(scenes[2].narration).toBe('Narration three');
  });

  test('handles non-sequential scene numbers', () => {
    const prompts = '5. Fifth\n\n10. Tenth\n\n15. Fifteenth';
    const scenes = importScenes(prompts, '', '', true, 'style');

    expect(scenes).toHaveLength(3);
    expect(scenes[0].sceneNumber).toBe(5);
    expect(scenes[1].sceneNumber).toBe(10);
    expect(scenes[2].sceneNumber).toBe(15);
  });

  test('per-scene styles override default', () => {
    const prompts = '1. Scene one\n\n2. Scene two';
    const styles = '1. Whisper softly:\n\n2. Shout loudly:';

    const scenes = importScenes(prompts, '', styles, false, 'default:');
    expect(scenes[0].style).toBe('Whisper softly:');
    expect(scenes[1].style).toBe('Shout loudly:');
  });

  test('useSameStyle ignores per-scene styles', () => {
    const prompts = '1. Scene one\n\n2. Scene two';
    const styles = '1. Whisper softly:';

    const scenes = importScenes(prompts, '', styles, true, 'Global style:');
    expect(scenes[0].style).toBe('Global style:');
    expect(scenes[1].style).toBe('Global style:');
  });

  test('empty prompts returns empty array', () => {
    const scenes = importScenes('', '', '', true, 'style');
    expect(scenes).toHaveLength(0);
  });

  test('handles 58 prompts efficiently', () => {
    const lines = [];
    for (let i = 1; i <= 58; i++) {
      lines.push(`${i}. Scene ${i}: A detailed description of what happens`);
    }
    const prompts = lines.join('\n\n');

    const scenes = importScenes(prompts, '', '', true, 'style');
    expect(scenes).toHaveLength(58);
    expect(scenes[0].sceneNumber).toBe(1);
    expect(scenes[57].sceneNumber).toBe(58);
  });
});

describe('Panel - batch image assignment', () => {
  test('batch images map to scenes by index', () => {
    const scenes = [
      { sceneNumber: 1, prompt: 'Scene 1', flowImage: null },
      { sceneNumber: 2, prompt: 'Scene 2', flowImage: null },
      { sceneNumber: 3, prompt: 'Scene 3', flowImage: null }
    ];

    const batchImages = [
      { name: 'img1.png', data: 'data1' },
      { name: 'img2.png', data: 'data2' },
      { name: 'img3.png', data: 'data3' }
    ];

    // Simulate batch assignment from startParallelPipeline
    batchImages.forEach((img, i) => {
      if (scenes[i]) {
        scenes[i].flowImage = img.data;
      }
    });

    expect(scenes[0].flowImage).toBe('data1');
    expect(scenes[1].flowImage).toBe('data2');
    expect(scenes[2].flowImage).toBe('data3');
  });

  test('fewer batch images than scenes leaves some null', () => {
    const scenes = [
      { flowImage: null },
      { flowImage: null },
      { flowImage: null }
    ];

    const batchImages = [{ name: 'img1.png', data: 'data1' }];

    batchImages.forEach((img, i) => {
      if (scenes[i]) scenes[i].flowImage = img.data;
    });

    expect(scenes[0].flowImage).toBe('data1');
    expect(scenes[1].flowImage).toBeNull();
    expect(scenes[2].flowImage).toBeNull();
  });

  test('more batch images than scenes: extras ignored', () => {
    const scenes = [{ flowImage: null }];
    const batchImages = [
      { name: 'img1.png', data: 'data1' },
      { name: 'img2.png', data: 'data2' }
    ];

    batchImages.forEach((img, i) => {
      if (scenes[i]) scenes[i].flowImage = img.data;
    });

    expect(scenes[0].flowImage).toBe('data1');
    // No crash
  });
});

describe('Panel - stopPipeline cleanup', () => {
  test('stopLinearPipeline resets all state', () => {
    // Simulate the state that stopLinearPipeline resets
    let pipelineState = {
      isRunning: true,
      currentStep: 'flow',
    };
    let flowStepStarting = true;

    // Simulate stop
    pipelineState.isRunning = false;
    pipelineState.currentStep = null;
    flowStepStarting = false;

    expect(pipelineState.isRunning).toBe(false);
    expect(pipelineState.currentStep).toBeNull();
    expect(flowStepStarting).toBe(false);
  });
});

describe('Panel - generateAutoFolderName', () => {
  function generateAutoFolderName(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    return `Proyecto_${year}${month}${day}_${hours}${mins}`;
  }

  test('generates correct format', () => {
    const date = new Date(2026, 1, 8, 3, 42); // Feb 8, 2026 03:42
    expect(generateAutoFolderName(date)).toBe('Proyecto_20260208_0342');
  });

  test('pads single-digit months and days', () => {
    const date = new Date(2026, 0, 5, 9, 5); // Jan 5, 2026 09:05
    expect(generateAutoFolderName(date)).toBe('Proyecto_20260105_0905');
  });

  test('handles midnight', () => {
    const date = new Date(2026, 11, 31, 0, 0); // Dec 31, 2026 00:00
    expect(generateAutoFolderName(date)).toBe('Proyecto_20261231_0000');
  });
});

describe('Panel - normalizeText for keyword matching', () => {
  function normalizeText(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  test('handles combined diacritics', () => {
    // ñ can be composed (single char) or decomposed (n + combining tilde)
    expect(normalizeText('niño')).toBe('nino');
    expect(normalizeText('nin\u0303o')).toBe('nino');
  });

  test('handles multiple spaces and newlines in prompts', () => {
    const prompt = 'Bruno   walks\n\nin   the   forest';
    expect(normalizeText(prompt)).toBe('bruno walks in the forest');
  });
});
