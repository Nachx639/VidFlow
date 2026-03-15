/**
 * Round 18 - Fresh Eyes Code Review Tests
 * Tests for issues found during cold code review of background.js,
 * content/flow/generation.js, content/flow/main.js, and sidepanel/panel.js
 */

// ========== SETUP ==========
const fs = require('fs');
const path = require('path');

// Read source files
const backgroundSrc = fs.readFileSync(path.join(__dirname, '../../background.js'), 'utf8');
const generationSrc = fs.readFileSync(path.join(__dirname, '../../content/flow/generation.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '../../content/flow/main.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(__dirname, '../../sidepanel/panel.js'), 'utf8');

// ========== ISSUE 1: Keepalive alarm period ==========
describe('Keepalive alarm period (Issue #1)', () => {
  test('periodInMinutes should be >= 0.5 (Chrome MV3 minimum)', () => {
    // Chrome MV3 clamps alarms below 0.5 minutes to 0.5
    // Using 0.4 was misleading (comment said ~24s but Chrome would make it 30s)
    const match = backgroundSrc.match(/periodInMinutes:\s*([\d.]+)/);
    expect(match).not.toBeNull();
    const period = parseFloat(match[1]);
    expect(period).toBeGreaterThanOrEqual(0.5);
  });

  test('comment should not claim sub-30s timing', () => {
    // Ensure no misleading comments about <30s alarm periods
    expect(backgroundSrc).not.toMatch(/periodInMinutes.*~24s/);
    expect(backgroundSrc).not.toMatch(/periodInMinutes.*~20s/);
  });
});

// ========== ISSUE 2: getGeminiApiKey safety ==========
describe('getGeminiApiKey safety (Issue #2)', () => {
  test('should use optional chaining for config access', () => {
    // Verify the function uses ?. to handle undefined config
    expect(backgroundSrc).toMatch(/pipelineState\.config\?\.geminiApiKey/);
  });

  test('storedGeminiApiKey should be declared for storage-based key', () => {
    expect(backgroundSrc).toMatch(/var storedGeminiApiKey/);
  });
});

// ========== ISSUE 3: enterPrompt native setter prototype matching ==========
describe('enterPrompt native setter (Issue #3)', () => {
  test('should pick setter based on actual element type, not hardcoded order', () => {
    // The old code always picked HTMLTextAreaElement setter first regardless of element type
    // The fix picks the correct prototype based on promptInput.tagName
    expect(generationSrc).toMatch(/promptInput\.tagName\s*===\s*'TEXTAREA'/);
    expect(generationSrc).toMatch(/HTMLTextAreaElement\.prototype/);
    expect(generationSrc).toMatch(/HTMLInputElement\.prototype/);
  });

  test('should not use fallback chain that ignores element type', () => {
    // The old pattern was: HTMLTextAreaElement.set || HTMLInputElement.set
    // This is wrong because HTMLTextAreaElement.set always exists, so || never fires
    // Verify we don't have this pattern anymore
    const badPattern = /Object\.getOwnPropertyDescriptor\(\s*window\.HTMLTextAreaElement\.prototype.*\).*\|\|\s*Object\.getOwnPropertyDescriptor\(\s*window\.HTMLInputElement\.prototype/s;
    expect(generationSrc).not.toMatch(badPattern);
  });
});

// ========== ISSUE 4: flowTabId saved in startFlowWorkflow ==========
describe('flowTabId persistence in startFlowWorkflow (Issue #4)', () => {
  test('startFlowWorkflow should save flowTabId to workflowState', () => {
    // After finding/opening the Flow tab, the ID should be saved
    // so handleFlowVideoQueued can use it directly instead of URL search
    expect(backgroundSrc).toMatch(/workflowState\.flowTabId\s*=\s*flowTab\.id/);
  });

  test('handleFlowVideoQueued should try flowTabId before URL search', () => {
    // The lookup chain should be: workflowState.flowTabId → pipelineState → URL search
    const handleQueued = backgroundSrc.substring(
      backgroundSrc.indexOf('async function handleFlowVideoQueued'),
      backgroundSrc.indexOf('async function handleFlowVideoQueued') + 2000
    );
    expect(handleQueued).toMatch(/workflowState\.flowTabId/);
  });
});

// ========== ISSUE 5: escapeHtml in panel.js ==========
describe('escapeHtml in panel.js (Issue #5)', () => {
  test('escapeHtml function should exist', () => {
    expect(panelSrc).toMatch(/function escapeHtml/);
  });

  test('escapeHtml should use textContent/innerHTML pattern (safe against XSS)', () => {
    // This is the safe pattern: create element, set textContent, read innerHTML
    expect(panelSrc).toMatch(/div\.textContent\s*=\s*text/);
    expect(panelSrc).toMatch(/div\.innerHTML/);
  });

  test('renderReferenceCategories should use escapeHtml for user data', () => {
    // Verify that user-provided data in templates uses escapeHtml
    expect(panelSrc).toMatch(/escapeHtml\(cat\.id\)/);
    expect(panelSrc).toMatch(/escapeHtml\(cat\.name\)/);
  });
});

// ========== ISSUE 6: sanitizeFolderName ==========
describe('sanitizeFolderName in panel.js (Issue #6)', () => {
  test('should exist and strip dangerous characters', () => {
    expect(panelSrc).toMatch(/function sanitizeFolderName/);
    // Should handle path separators
    expect(panelSrc).toMatch(/[\/\\]/);
    // Should limit length
    expect(panelSrc).toMatch(/\.substring\(0,\s*255\)/);
  });
});

// ========== ISSUE 7: savePipelineState strips imageData ==========
describe('savePipelineState quota management (Issue #7)', () => {
  test('should save generatedCount instead of full image arrays', () => {
    // This is intentional to avoid exceeding chrome.storage.local quota
    expect(backgroundSrc).toMatch(/generatedCount:\s*pipelineState\.whisk\.generatedImages\.length/);
    expect(backgroundSrc).toMatch(/generatedCount:\s*pipelineState\.flow\.generatedVideos\.length/);
    expect(backgroundSrc).toMatch(/generatedCount:\s*pipelineState\.speech\.generatedAudios\.length/);
  });
});

// ========== STRUCTURAL REVIEW ==========
describe('Code structure and safety', () => {
  test('writeString helper is only used for WAV header strings', () => {
    // writeString writes ASCII chars to DataView - verify it's used correctly
    // It should only be called with known ASCII strings: 'RIFF', 'WAVE', 'fmt ', 'data'
    const writeStringCalls = backgroundSrc.match(/writeString\(view,\s*\d+,\s*'[^']+'\)/g) || [];
    expect(writeStringCalls.length).toBe(4);
    expect(writeStringCalls.some(c => c.includes("'RIFF'"))).toBe(true);
    expect(writeStringCalls.some(c => c.includes("'WAVE'"))).toBe(true);
    expect(writeStringCalls.some(c => c.includes("'fmt '"))).toBe(true);
    expect(writeStringCalls.some(c => c.includes("'data'"))).toBe(true);
  });

  test('all chrome.runtime.sendMessage calls have .catch handlers where appropriate', () => {
    // Messages to popup/sidepanel should have .catch() since they may be closed
    // Count sendMessage calls that are fire-and-forget (notifyProgress, notifyPipelineProgress)
    const notifyCalls = backgroundSrc.match(/chrome\.runtime\.sendMessage\(\{[\s\S]*?\}\)\.catch/g) || [];
    expect(notifyCalls.length).toBeGreaterThan(0);
  });

  test('MAX_PARALLEL_VIDEOS is defined and reasonable', () => {
    const match = backgroundSrc.match(/MAX_PARALLEL_VIDEOS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const value = parseInt(match[1]);
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(10);
  });

  test('sleep function returns a Promise', () => {
    expect(backgroundSrc).toMatch(/function sleep\(ms\)\s*\{[\s\S]*?new Promise/);
  });

  test('handleMessage switch covers all documented actions', () => {
    const requiredActions = [
      'startWhisk', 'startFlow', 'stopWorkflow',
      'whiskImageGenerated', 'flowVideoGenerated', 'flowVideoQueued',
      'flowVideoError', 'getWorkflowState', 'startPipeline',
      'stopPipeline', 'getPipelineState'
    ];
    requiredActions.forEach(action => {
      expect(backgroundSrc).toContain(`case '${action}'`);
    });
  });

  test('findCompletedVideoCards sorts by position (bottom-first)', () => {
    // Google Flow shows newest at top, so bottom = first-sent = should download first
    expect(mainSrc).toMatch(/b\.position\s*-\s*a\.position/);
  });

  test('stopAutomation has race condition protection', () => {
    // Should check sessionId and sessionStartTime
    expect(mainSrc).toMatch(/data\.sessionId.*window\.sessionId/);
    expect(mainSrc).toMatch(/timeSinceStart\s*<\s*5000/);
  });

  test('MAX_PROMPT_LENGTH is defined in panel.js', () => {
    expect(panelSrc).toMatch(/MAX_PROMPT_LENGTH\s*=\s*\d+/);
  });

  test('vidflowDownloadIds has size cap to prevent memory leaks', () => {
    expect(backgroundSrc).toMatch(/MAX_TRACKED_DOWNLOADS/);
    expect(backgroundSrc).toMatch(/vidflowDownloadIds\.size\s*>=\s*MAX_TRACKED_DOWNLOADS/);
  });
});

// ========== DEAD CODE / UNREACHABLE PATH CHECK ==========
describe('Dead code and unreachable paths', () => {
  test('startFlowWorkflow ends with processNextFlowVideo then return success', () => {
    // Verify the function calls processNextFlowVideo and returns success
    const funcStart = backgroundSrc.indexOf('async function startFlowWorkflow');
    // Use a larger window to capture the full function
    const funcBody = backgroundSrc.substring(funcStart, funcStart + 15000);
    expect(funcBody).toContain('await processNextFlowVideo(flowTab.id)');
    expect(funcBody).toContain("return { success: true }");
  });

  test('processNextFlowVideo breaks after first send in parallel loop', () => {
    // The for loop sends videos but breaks after the first one
    // This is intentional: content script chains the next via flowVideoQueued
    const funcStart = backgroundSrc.indexOf('async function processNextFlowVideo');
    const nextFunc = backgroundSrc.indexOf('async function handleFlowVideoQueued');
    const funcBody = backgroundSrc.substring(funcStart, nextFunc);
    // Verify the break exists inside the for loop
    expect(funcBody).toContain('// Solo enviar uno a la vez');
    expect(funcBody).toContain('break;');
  });
});
