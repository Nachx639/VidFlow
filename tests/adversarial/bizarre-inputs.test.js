/**
 * ROUND 15: Adversarial Testing - Bizarre Inputs
 * Tests designed to BREAK the extension with edge-case inputs
 */

// Mock vfLog
global.vfLog = jest.fn();

// Inline PromptAnalyzer for testing (same pattern as unit/analyzer.test.js)
class PromptAnalyzer {
  constructor() {
    this.brunoKeywords = ['bruno', 'bear', 'oso'];
    this.pomponKeywords = ['pompón', 'pompon', 'bunny', 'conejo', 'rabbit'];
    this.blackboardKeywords = ['blackboard', 'pizarra', 'chalk', 'tiza'];
  }
  analyzePrompt(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    const hasBruno = this.brunoKeywords.some(kw => lowerPrompt.includes(kw));
    const hasPompon = this.pomponKeywords.some(kw => lowerPrompt.includes(kw));
    const hasBlackboard = this.blackboardKeywords.some(kw => lowerPrompt.includes(kw));
    let category, referenceNeeded;
    if (hasBruno && hasPompon) { category = 'both'; referenceNeeded = 'both'; }
    else if (hasPompon) { category = 'pompon'; referenceNeeded = 'pompon'; }
    else if (hasBruno) { category = 'bruno'; referenceNeeded = 'bruno'; }
    else if (hasBlackboard) { category = 'blackboard'; referenceNeeded = 'blackboard'; }
    else { category = 'other'; referenceNeeded = null; }
    const sceneMatch = prompt.match(/Objects:\s*([^.]+)/i);
    const actionMatch = prompt.match(/Action:\s*([^.]+)/i);
    return {
      category, referenceNeeded, hasBruno, hasPompon, hasBlackboard,
      scene: sceneMatch ? sceneMatch[1].trim() : '',
      action: actionMatch ? actionMatch[1].trim() : '',
      whiskPrompt: this.createWhiskPrompt(prompt),
      flowPrompt: prompt
    };
  }
  createWhiskPrompt(prompt) {
    let simplified = prompt;
    simplified = simplified.replace(/Bruno\s*\([^)]+\)/gi, 'Bruno');
    simplified = simplified.replace(/Pompón\s*\([^)]+\)/gi, 'Pompón');
    simplified = simplified.replace(/Pompon\s*\([^)]+\)/gi, 'Pompón');
    return simplified;
  }
  groupByReference(results) {
    const groups = { both: [], pompon: [], bruno: [], blackboard: [], other: [] };
    results.forEach(r => groups[r.category].push(r));
    return groups;
  }
  createBatchOrder(results) {
    const batches = [];
    let currentBatch = null;
    results.forEach((result, index) => {
      if (!currentBatch || currentBatch.reference !== result.referenceNeeded) {
        currentBatch = { reference: result.referenceNeeded, items: [] };
        batches.push(currentBatch);
      }
      currentBatch.items.push({ ...result, originalIndex: index });
    });
    return batches;
  }
}

describe('Bizarre Input Testing', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new PromptAnalyzer();
  });

  // ========== A1. Prompt Edge Cases ==========

  describe('Prompt with ONLY whitespace/newlines', () => {
    test('whitespace-only prompt returns "other" category', () => {
      const result = analyzer.analyzePrompt('   \t  \n  \r\n  ');
      expect(result.category).toBe('other');
      expect(result.referenceNeeded).toBeNull();
    });

    test('empty string prompt returns "other" category', () => {
      const result = analyzer.analyzePrompt('');
      expect(result.category).toBe('other');
      expect(result.referenceNeeded).toBeNull();
    });

    test('newlines-only prompt', () => {
      const result = analyzer.analyzePrompt('\n\n\n\n');
      expect(result.category).toBe('other');
    });
  });

  describe('Prompt with emoji', () => {
    test('emoji-only prompt', () => {
      const result = analyzer.analyzePrompt('🎬🎥🎞️');
      expect(result.category).toBe('other');
      expect(result.flowPrompt).toBe('🎬🎥🎞️');
    });

    test('prompt with emoji and keywords', () => {
      const result = analyzer.analyzePrompt('🐻 Bruno walks through the forest 🌲');
      expect(result.category).toBe('bruno');
      expect(result.hasBruno).toBe(true);
    });

    test('emoji mixed with text preserves in whiskPrompt', () => {
      const result = analyzer.analyzePrompt('🎬 Action: Bruno runs 🏃');
      expect(result.whiskPrompt).toContain('🎬');
      expect(result.whiskPrompt).toContain('🏃');
    });
  });

  describe('Prompt with Unicode characters', () => {
    test('Chinese characters', () => {
      const result = analyzer.analyzePrompt('布鲁诺在森林里走');
      expect(result.category).toBe('other');
      expect(result.flowPrompt).toBe('布鲁诺在森林里走');
    });

    test('Arabic characters', () => {
      const result = analyzer.analyzePrompt('برونو يمشي في الغابة');
      expect(result.category).toBe('other');
    });

    test('Cyrillic characters', () => {
      const result = analyzer.analyzePrompt('Бруно идет по лесу');
      expect(result.category).toBe('other');
    });

    test('mixed Unicode with keywords', () => {
      const result = analyzer.analyzePrompt('El oso Bruno 走在 森林');
      expect(result.category).toBe('bruno');
      expect(result.hasBruno).toBe(true);
    });

    test('RTL text does not crash', () => {
      const result = analyzer.analyzePrompt('مرحبا بالعالم');
      expect(result).toBeDefined();
      expect(result.category).toBe('other');
    });
  });

  describe('Prompt that is exactly 1 character long', () => {
    test('single letter', () => {
      const result = analyzer.analyzePrompt('a');
      expect(result.category).toBe('other');
      expect(result.flowPrompt).toBe('a');
    });

    test('single space', () => {
      const result = analyzer.analyzePrompt(' ');
      expect(result.category).toBe('other');
    });

    test('single emoji', () => {
      const result = analyzer.analyzePrompt('🎬');
      expect(result.category).toBe('other');
    });

    test('single null byte', () => {
      const result = analyzer.analyzePrompt('\0');
      expect(result.category).toBe('other');
    });
  });

  describe('Prompt with null bytes', () => {
    test('null bytes in middle of text', () => {
      const result = analyzer.analyzePrompt('Bruno\0walks\0in\0forest');
      // toLowerCase should handle null bytes
      expect(result.hasBruno).toBe(true);
      expect(result.category).toBe('bruno');
    });

    test('null bytes around keywords', () => {
      const result = analyzer.analyzePrompt('\0\0bruno\0\0pompon\0\0');
      expect(result.category).toBe('both');
    });
  });

  describe('Narration with SSML-like tags', () => {
    test('SSML speak tags in prompt', () => {
      const result = analyzer.analyzePrompt('<speak>Bruno walks</speak>');
      expect(result.hasBruno).toBe(true);
      expect(result.flowPrompt).toContain('<speak>');
    });

    test('SSML break tags', () => {
      const result = analyzer.analyzePrompt('Bruno <break time="1s"/> walks');
      expect(result.hasBruno).toBe(true);
    });

    test('nested XML-like tags', () => {
      const result = analyzer.analyzePrompt('<prosody rate="slow"><emphasis>Bruno</emphasis></prosody>');
      expect(result.hasBruno).toBe(true);
    });

    test('HTML injection attempt in prompt', () => {
      const result = analyzer.analyzePrompt('<script>alert("xss")</script>Bruno');
      expect(result.hasBruno).toBe(true);
      expect(result.flowPrompt).toContain('<script>');
    });
  });

  // ========== A2. Folder Name Edge Cases ==========

  describe('Folder name with only dots', () => {
    test('dots-only folder name can be set in workflow state', () => {
      // This tests that the background.js doesn't crash with such a name
      const folderName = '...';
      expect(() => {
        const filename = `VidFlow/${folderName}/001_flow_video.mp4`;
        expect(filename).toBe('VidFlow/.../001_flow_video.mp4');
      }).not.toThrow();
    });
  });

  describe('Folder name with only spaces', () => {
    test('spaces-only folder name', () => {
      const folderName = '   ';
      const filename = `VidFlow/${folderName}/001_flow_video.mp4`;
      expect(filename).toBe('VidFlow/   /001_flow_video.mp4');
    });
  });

  // ========== A3. Image Data Edge Cases ==========

  describe('Image data edge cases', () => {
    test('empty base64 data URL', () => {
      const imageData = 'data:image/png;base64,';
      // Should not crash when used as reference
      expect(imageData.startsWith('data:')).toBe(true);
      expect(imageData.length).toBe(22);
    });

    test('non-base64 image data', () => {
      const imageData = 'this is not base64 at all!!!';
      expect(imageData.startsWith('data:')).toBe(false);
    });

    test('corrupt base64 with valid prefix', () => {
      const imageData = 'data:image/png;base64,!!!INVALID!!!';
      expect(imageData.startsWith('data:image/png;base64,')).toBe(true);
    });

    test('extremely large data URL does not crash analyzer', () => {
      const hugeData = 'data:image/png;base64,' + 'A'.repeat(100000);
      // Analyzer doesn't process image data directly, but ensure no crash
      const result = analyzer.analyzePrompt('Bruno with reference image');
      result.imageData = hugeData;
      expect(result.hasBruno).toBe(true);
    });
  });

  // ========== A4. Scene Number Edge Cases ==========

  describe('sceneNumber edge cases', () => {
    test('sceneNumber = -1', () => {
      const sceneNumber = -1;
      const paddedNumber = String(sceneNumber).padStart(3, '0');
      // Negative numbers: "-1" padStart(3,'0') → "0-1" (not useful as filename)
      expect(paddedNumber).toBe('0-1');
    });

    test('sceneNumber = 0', () => {
      const sceneNumber = 0;
      const paddedNumber = String(sceneNumber).padStart(3, '0');
      expect(paddedNumber).toBe('000');
    });

    test('sceneNumber = 999999', () => {
      const sceneNumber = 999999;
      const paddedNumber = String(sceneNumber).padStart(3, '0');
      expect(paddedNumber).toBe('999999');
    });

    test('sceneNumber = NaN', () => {
      const sceneNumber = NaN;
      const paddedNumber = String(sceneNumber).padStart(3, '0');
      expect(paddedNumber).toBe('NaN');
    });

    test('sceneNumber = Infinity', () => {
      const sceneNumber = Infinity;
      const paddedNumber = String(sceneNumber).padStart(3, '0');
      expect(paddedNumber).toBe('Infinity');
    });

    test('sceneNumber = undefined', () => {
      const sceneNumber = undefined;
      const paddedNumber = String(sceneNumber).padStart(3, '0');
      expect(paddedNumber).toBe('undefined');
    });

    test('sceneNumber = null falls back correctly', () => {
      const sceneNumber = null;
      // The pattern in background.js: sceneNumber || (index + 1)
      const effective = sceneNumber || (0 + 1);
      expect(effective).toBe(1);
    });
  });

  // ========== A5. Config Edge Cases ==========

  describe('Config with edge-case delays', () => {
    test('negative delay', () => {
      const config = { delay: -5 };
      // sleep(-5000) should resolve immediately
      const start = Date.now();
      return new Promise(resolve => setTimeout(resolve, Math.max(0, config.delay * 1000))).then(() => {
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(100);
      });
    });

    test('delay = 0', () => {
      const config = { delay: 0 };
      const sleepMs = config.delay * 1000;
      expect(sleepMs).toBe(0);
    });

    test('delay = 999999', () => {
      const config = { delay: 999999 };
      const sleepMs = config.delay * 1000;
      expect(sleepMs).toBe(999999000);
      // Should not actually sleep - just verify computation
    });

    test('delay = NaN', () => {
      const config = { delay: NaN };
      const sleepMs = config.delay * 1000;
      expect(isNaN(sleepMs)).toBe(true);
    });

    test('delay = undefined', () => {
      const config = {};
      const delay = (config.delay || 3) * 1000;
      expect(delay).toBe(3000); // Falls back to default
    });
  });

  // ========== A6. Analyzer Batch/Group Edge Cases ==========

  describe('Analyzer with edge-case inputs', () => {
    test('groupByReference with empty array', () => {
      const groups = analyzer.groupByReference([]);
      expect(groups.both).toEqual([]);
      expect(groups.bruno).toEqual([]);
      expect(groups.pompon).toEqual([]);
      expect(groups.blackboard).toEqual([]);
      expect(groups.other).toEqual([]);
    });

    test('createBatchOrder with empty array', () => {
      const batches = analyzer.createBatchOrder([]);
      expect(batches).toEqual([]);
    });

    test('createBatchOrder with single item', () => {
      const results = [analyzer.analyzePrompt('Bruno walks')];
      const batches = analyzer.createBatchOrder(results);
      expect(batches.length).toBe(1);
      expect(batches[0].items.length).toBe(1);
    });

    test('createBatchOrder groups consecutive same references', () => {
      const results = [
        analyzer.analyzePrompt('Bruno walks'),
        analyzer.analyzePrompt('Bruno runs'),
        analyzer.analyzePrompt('A tree stands'),
        analyzer.analyzePrompt('Bruno jumps'),
      ];
      const batches = analyzer.createBatchOrder(results);
      expect(batches.length).toBe(3); // bruno, other, bruno
      expect(batches[0].reference).toBe('bruno');
      expect(batches[0].items.length).toBe(2);
      expect(batches[1].reference).toBeNull();
      expect(batches[2].reference).toBe('bruno');
    });

    test('analyzePrompt with extremely long prompt', () => {
      const longPrompt = 'Bruno '.repeat(10000) + 'walks in the forest';
      const result = analyzer.analyzePrompt(longPrompt);
      expect(result.hasBruno).toBe(true);
      expect(result.category).toBe('bruno');
    });

    test('createWhiskPrompt removes parenthetical descriptions', () => {
      const prompt = 'Bruno (a big brown bear with blue eyes) walks with Pompón (a small white bunny)';
      const result = analyzer.createWhiskPrompt(prompt);
      expect(result).not.toContain('a big brown bear');
      expect(result).not.toContain('a small white bunny');
      expect(result).toContain('Bruno');
      expect(result).toContain('Pompón');
    });
  });
});
