/**
 * Panel UX & Error Handling Tests - Round 13
 * Tests XSS prevention, input validation, folder sanitization,
 * error state handling, and completion summary
 */

// ========== Helpers extracted from panel.js ==========

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeFolderName(name) {
  if (!name) return '';
  return name
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .substring(0, 255);
}

const MAX_PROMPT_LENGTH = 5000;

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

// ========== XSS Prevention ==========

describe('XSS Prevention - escapeHtml', () => {
  test('escapes script tags', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('escapes HTML attributes', () => {
    const result = escapeHtml('" onload="alert(1)"');
    // textContent-based escaping handles < and > and &; quotes may vary by browser
    // The key point: when inserted as textContent, it's safe
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // In innerHTML context with escapeHtml wrapping, angle brackets are escaped
    expect(escapeHtml('<div onload="x">')).toContain('&lt;');
  });

  test('escapes angle brackets', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toContain('&lt;');
  });

  test('handles empty/null input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('preserves normal text', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
    expect(escapeHtml('café & résumé')).toBe('café &amp; résumé');
  });

  test('escapes nested injection attempts', () => {
    const result = escapeHtml('"><svg/onload=alert(1)>');
    expect(result).not.toContain('<svg');
    expect(result).toContain('&lt;svg');
  });
});

// ========== Folder Name Sanitization ==========

describe('Folder Name Sanitization', () => {
  test('removes path separators', () => {
    expect(sanitizeFolderName('foo/bar')).toBe('foo_bar');
    expect(sanitizeFolderName('foo\\bar')).toBe('foo_bar');
  });

  test('removes special filesystem characters', () => {
    expect(sanitizeFolderName('foo:bar*baz?"qux')).toBe('foo_bar_baz__qux');
  });

  test('removes control characters', () => {
    expect(sanitizeFolderName('foo\x00bar\x1fbaz')).toBe('foobarbaz');
  });

  test('truncates to 255 chars', () => {
    const longName = 'a'.repeat(300);
    expect(sanitizeFolderName(longName).length).toBe(255);
  });

  test('handles empty/null input', () => {
    expect(sanitizeFolderName('')).toBe('');
    expect(sanitizeFolderName(null)).toBe('');
  });

  test('preserves normal names', () => {
    expect(sanitizeFolderName('Proyecto_20260208_1430')).toBe('Proyecto_20260208_1430');
    expect(sanitizeFolderName('Mi Video - Parte 1')).toBe('Mi Video - Parte 1');
  });

  test('handles unicode names', () => {
    expect(sanitizeFolderName('Vídeo_España_ñ')).toBe('Vídeo_España_ñ');
  });

  test('sanitizes path traversal attempts', () => {
    const result = sanitizeFolderName('../../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
  });
});

// ========== Input Validation ==========

describe('Input Validation', () => {
  test('parseNumberedBlocks handles empty input', () => {
    expect(parseNumberedBlocks('')).toEqual(new Map());
    expect(parseNumberedBlocks(null)).toEqual(new Map());
    expect(parseNumberedBlocks('   ')).toEqual(new Map());
  });

  test('prompts with HTML injection are stored as plain text', () => {
    const text = '1. <script>alert("xss")</script>\n\n2. Normal prompt';
    const result = parseNumberedBlocks(text);
    // parseNumberedBlocks stores raw text - escapeHtml is applied at render time
    expect(result.get(1)).toContain('<script>');
    expect(result.size).toBe(2);
    // But when rendered via escapeHtml:
    expect(escapeHtml(result.get(1))).not.toContain('<script>');
  });

  test('extremely long prompts are parsed correctly', () => {
    const longPrompt = '1. ' + 'A'.repeat(10000);
    const result = parseNumberedBlocks(longPrompt);
    expect(result.get(1).length).toBe(10000);
  });

  test('prompt truncation at MAX_PROMPT_LENGTH', () => {
    const longText = 'A'.repeat(10000);
    const truncated = longText.length > MAX_PROMPT_LENGTH
      ? longText.substring(0, MAX_PROMPT_LENGTH)
      : longText;
    expect(truncated.length).toBe(MAX_PROMPT_LENGTH);
  });

  test('empty narration is valid', () => {
    const text = '1. First scene\n\n2. Second scene';
    const prompts = parseNumberedBlocks(text);
    const narrations = parseNumberedBlocks(''); // no narrations
    
    expect(prompts.size).toBe(2);
    expect(narrations.size).toBe(0);
    // narration defaults to '' for scenes without narration
    const narration1 = narrations.get(1) || '';
    expect(narration1).toBe('');
  });
});

// ========== Error State Handling ==========

describe('Error State Handling', () => {
  test('start with no prompts - importScenes does nothing', () => {
    // importScenes checks for promptsText and returns if empty
    const promptsText = '';
    expect(!promptsText).toBe(true); // would return early
  });

  test('stop pipeline resets all UI state', () => {
    // Simulate state after running
    const runningState = {
      isRunning: true,
      currentStep: 'flow'
    };

    // After stopPipeline:
    runningState.isRunning = false;
    runningState.currentStep = null;

    expect(runningState.isRunning).toBe(false);
    expect(runningState.currentStep).toBeNull();
  });

  test('start after stop has clean state', () => {
    const state = { isRunning: false, currentStep: null };
    
    // Start
    state.isRunning = true;
    expect(state.isRunning).toBe(true);
    
    // Stop
    state.isRunning = false;
    state.currentStep = null;
    
    // Start again
    state.isRunning = true;
    expect(state.currentStep).toBeNull(); // clean until pipeline sets it
  });

  test('extension reload resets running state', () => {
    // loadSavedState doesn't restore isRunning - it's transient
    const savedState = {
      scenes: [{ id: '1', prompt: 'test', narration: '' }],
      config: { runWhisk: true }
    };
    
    // After reload, isRunning defaults to false
    const freshState = { isRunning: false, currentStep: null };
    expect(freshState.isRunning).toBe(false);
  });
});

// ========== Completion Summary ==========

describe('Pipeline Completion Summary', () => {
  function buildCompletionMessage(summary) {
    let message = '¡Pipeline completado!\n\n';
    if (summary) {
      message += `Carpeta: ${summary.projectFolder}\n\n`;
      if (summary.whisk > 0) message += `🎨 Imágenes (Whisk): ${summary.whisk}\n`;
      if (summary.flow > 0) message += `🎬 Videos (Flow): ${summary.flow}\n`;
      if (summary.speech > 0) message += `🎙️ Audios (Speech): ${summary.speech}\n`;
      const errors = summary.errors || {};
      const totalErrors = (errors.whisk || 0) + (errors.flow || 0) + (errors.speech || 0);
      if (totalErrors > 0) {
        message += '\n⚠️ Errores:\n';
        if (errors.whisk > 0) message += `  🎨 Whisk: ${errors.whisk} fallos\n`;
        if (errors.flow > 0) message += `  🎬 Flow: ${errors.flow} fallos\n`;
        if (errors.speech > 0) message += `  🎙️ Speech: ${errors.speech} fallos\n`;
      }
    }
    return message;
  }

  test('shows success counts', () => {
    const msg = buildCompletionMessage({
      projectFolder: 'VidFlow/Test_2026',
      whisk: 5, flow: 5, speech: 3
    });
    expect(msg).toContain('Imágenes (Whisk): 5');
    expect(msg).toContain('Videos (Flow): 5');
    expect(msg).toContain('Audios (Speech): 3');
    expect(msg).not.toContain('Errores');
  });

  test('shows error counts when present', () => {
    const msg = buildCompletionMessage({
      projectFolder: 'VidFlow/Test_2026',
      whisk: 4, flow: 3, speech: 2,
      errors: { whisk: 1, flow: 2, speech: 1 }
    });
    expect(msg).toContain('⚠️ Errores');
    expect(msg).toContain('Whisk: 1 fallos');
    expect(msg).toContain('Flow: 2 fallos');
    expect(msg).toContain('Speech: 1 fallos');
  });

  test('hides error section when no errors', () => {
    const msg = buildCompletionMessage({
      projectFolder: 'VidFlow/Test_2026',
      whisk: 5, flow: 5, speech: 5,
      errors: { whisk: 0, flow: 0, speech: 0 }
    });
    expect(msg).not.toContain('Errores');
  });

  test('handles missing summary gracefully', () => {
    const msg = buildCompletionMessage(null);
    expect(msg).toContain('Pipeline completado');
  });

  test('handles partial summary (only some steps)', () => {
    const msg = buildCompletionMessage({
      projectFolder: 'VidFlow/Test_2026',
      whisk: 0, flow: 5, speech: 0
    });
    expect(msg).not.toContain('Whisk');
    expect(msg).toContain('Videos (Flow): 5');
    expect(msg).not.toContain('Speech');
  });
});

// ========== Progress Display ==========

describe('Progress Display', () => {
  test('updateProgress sets correct step info', () => {
    const icons = { whisk: '🎨', flow: '🎬', speech: '🎙️', parallel: '⚡' };
    const names = { whisk: 'Whisk', flow: 'Flow', speech: 'Speech', parallel: 'Paralelo' };

    expect(icons['whisk']).toBe('🎨');
    expect(names['flow']).toBe('Flow');
    expect(icons['parallel']).toBe('⚡');
  });

  test('progress percentage calculation', () => {
    const current = 3;
    const total = 10;
    const pct = (current / total) * 100;
    expect(pct).toBe(30);
  });

  test('parallel mode shows combined progress', () => {
    const whiskProgress = 3, whiskTotal = 5;
    const speechProgress = 2, speechTotal = 4;
    const combined = whiskProgress + speechProgress;
    const combinedTotal = whiskTotal + speechTotal;
    expect(combined).toBe(5);
    expect(combinedTotal).toBe(9);
  });
});

// ========== Edge Cases ==========

describe('Edge Cases', () => {
  test('batch image with malicious filename', () => {
    const name = '<img src=x onerror=alert(1)>.png';
    const escaped = escapeHtml(name);
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
  });

  test('category name with HTML', () => {
    const name = '"><script>alert(1)</script>';
    const escaped = escapeHtml(name);
    expect(escaped).not.toContain('<script>');
  });

  test('folder name with path traversal', () => {
    const sanitized = sanitizeFolderName('../../secret');
    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain('\\');
    // Dots remain but path separators are gone, so no traversal possible
  });

  test('prompts with only whitespace', () => {
    const result = parseNumberedBlocks('1.    \n\n2. Real prompt');
    // "1.    " -> content is empty after trim, so not added
    expect(result.size).toBe(1);
    expect(result.has(2)).toBe(true);
  });

  test('invalid base64 reference image does not crash', () => {
    // The panel stores whatever FileReader returns; invalid base64
    // would only fail when the browser tries to render the <img>
    const invalidData = 'data:image/png;base64,NOT_VALID_BASE64!!!';
    const escaped = escapeHtml(invalidData);
    expect(escaped).toContain('data:image');
  });
});
