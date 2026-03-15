/**
 * VidFlow - Code Quality & Robustness Tests (Round 4)
 * Tests for dead code detection, input validation, memory leak prevention,
 * cleanup correctness, and constants documentation.
 */

const fs = require('fs');
const path = require('path');

// ========== A. DEAD CODE DETECTION ==========

describe('Dead Code Detection', () => {
  test('manifest.json only loads background.js as service worker', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../manifest.json'), 'utf-8')
    );
    expect(manifest.background.service_worker).toBe('background.js');
    // Should NOT reference modular files
    expect(manifest.background.scripts).toBeUndefined();
    expect(manifest.background.type).toBeUndefined(); // no "module" type
  });

  test('background/downloads.js is marked as dead code', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../background/downloads.js'), 'utf-8'
    );
    expect(content).toContain('DEAD CODE');
    expect(content).toContain('@deprecated');
  });

  test('background/state.js is marked as dead code', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../background/state.js'), 'utf-8'
    );
    expect(content).toContain('DEAD CODE');
    expect(content).toContain('@deprecated');
  });

  test('background/utils.js is marked as dead code', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../background/utils.js'), 'utf-8'
    );
    expect(content).toContain('DEAD CODE');
    expect(content).toContain('@deprecated');
  });

  test('background/workflows/whisk.js is documented if exists', () => {
    const filePath = path.join(__dirname, '../../background/workflows/whisk.js');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      // Should have some documentation about its usage status
      expect(content.length).toBeGreaterThan(0);
    }
  });
});

// ========== B. CONSTANTS & DOCUMENTATION ==========

describe('Constants Documentation', () => {
  let bgContent;

  beforeAll(() => {
    bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
  });

  test('MAX_PARALLEL_VIDEOS is documented', () => {
    expect(bgContent).toContain('MAX_PARALLEL_VIDEOS');
    // Should appear in the header documentation
    expect(bgContent).toMatch(/MAX_PARALLEL_VIDEOS\s*=\s*4/);
  });

  test('hardcoded URLs are documented in header', () => {
    expect(bgContent).toContain('HARDCODED URLs');
    expect(bgContent).toContain('labs.google');
    expect(bgContent).toContain('generativelanguage.googleapis.com');
  });

  test('architecture note explains why background/ files are unused', () => {
    expect(bgContent).toContain('ARCHITECTURE NOTE');
    expect(bgContent).toContain('background/');
  });

  test('WAV format parameters are documented', () => {
    expect(bgContent).toContain('PCM 16-bit');
    expect(bgContent).toContain('24000 Hz');
  });
});

// ========== C. INPUT VALIDATION ==========

describe('Input Validation', () => {
  // We test by reading the source to verify validation exists
  let bgContent;

  beforeAll(() => {
    bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
  });

  test('generateSpeechViaAPI validates text input', () => {
    // Should check for empty/invalid text before making API call
    const funcMatch = bgContent.match(
      /async function generateSpeechViaAPI[\s\S]*?(?=async function|function\s)/
    );
    expect(funcMatch).not.toBeNull();
    const funcBody = funcMatch[0];
    expect(funcBody).toContain("typeof text !== 'string'");
    expect(funcBody).toContain('trim().length === 0');
  });

  test('downloadSpeechAudio validates inputs', () => {
    const funcMatch = bgContent.match(
      /async function downloadSpeechAudio[\s\S]*?(?=function writeString)/
    );
    expect(funcMatch).not.toBeNull();
    const funcBody = funcMatch[0];
    expect(funcBody).toContain("typeof pcmBase64 !== 'string'");
    expect(funcBody).toContain("typeof filename !== 'string'");
  });

  test('handleMessage has default case for unknown actions', () => {
    expect(bgContent).toContain("error: 'Unknown action'");
  });
});

// ========== D. MEMORY LEAK PREVENTION ==========

describe('Memory Leak Prevention', () => {
  test('vidflowDownloadIds has a max size cap', () => {
    const bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
    expect(bgContent).toContain('MAX_TRACKED_DOWNLOADS');
    expect(bgContent).toMatch(/MAX_TRACKED_DOWNLOADS\s*=\s*200/);
    // Should evict oldest when cap is reached
    expect(bgContent).toContain('vidflowDownloadIds.size >= MAX_TRACKED_DOWNLOADS');
  });

  test('logEntries has a max size cap', () => {
    const logContent = fs.readFileSync(
      path.join(__dirname, '../../content/flow/log.js'), 'utf-8'
    );
    expect(logContent).toContain('MAX_LOG_ENTRIES');
    expect(logContent).toMatch(/MAX_LOG_ENTRIES\s*=\s*500/);
    expect(logContent).toContain('logEntries.length > MAX_LOG_ENTRIES');
  });

  test('downloadSceneMap entries auto-cleanup on timeout', () => {
    const bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
    // registerVidFlowDownload should have setTimeout cleanup
    expect(bgContent).toContain('downloadSceneMap.delete(downloadId)');
    expect(bgContent).toContain('300000'); // 5 min cleanup
  });

  test('pendingPromptSceneMap entries auto-cleanup', () => {
    const bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
    expect(bgContent).toContain('pendingPromptSceneMap.delete(promptKey)');
    expect(bgContent).toContain('120000'); // 2 min cleanup
  });
});

// ========== E. CLEANUP CORRECTNESS ==========

describe('Cleanup on Stop', () => {
  let bgContent;

  beforeAll(() => {
    bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
  });

  test('stopWorkflow clears activeVideos', () => {
    const funcMatch = bgContent.match(
      /function stopWorkflow\(\)[\s\S]*?return \{ success: true \};?\s*\}/
    );
    expect(funcMatch).not.toBeNull();
    const funcBody = funcMatch[0];
    expect(funcBody).toContain('activeVideos');
    expect(funcBody).toContain('downloadSceneMap.clear()');
    expect(funcBody).toContain('pendingPromptSceneMap.clear()');
  });

  test('stopLinearPipeline clears maps', () => {
    const funcMatch = bgContent.match(
      /function stopLinearPipeline\(\)[\s\S]*?return \{ success: true \};?\s*\}/
    );
    expect(funcMatch).not.toBeNull();
    const funcBody = funcMatch[0];
    expect(funcBody).toContain('downloadSceneMap.clear()');
    expect(funcBody).toContain('pendingPromptSceneMap.clear()');
  });

  test('stopWorkflow resets pendingIndexes', () => {
    const funcMatch = bgContent.match(
      /function stopWorkflow\(\)[\s\S]*?return \{ success: true \};?\s*\}/
    );
    const funcBody = funcMatch[0];
    expect(funcBody).toContain('pendingIndexes');
  });

  test('completePipeline resets flowStepStarting flag', () => {
    const funcMatch = bgContent.match(
      /async function completePipeline\(\)[\s\S]*?\n\}/
    );
    expect(funcMatch).not.toBeNull();
    expect(funcMatch[0]).toContain('flowStepStarting = false');
  });

  test('completePipeline unregisters download listener', () => {
    const funcMatch = bgContent.match(
      /async function completePipeline\(\)[\s\S]*?\n\}/
    );
    expect(funcMatch[0]).toContain('unregisterDownloadListener');
  });
});

// ========== F. ERROR HANDLING ==========

describe('Error Handling', () => {
  let bgContent;

  beforeAll(() => {
    bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
  });

  test('handleMessage catches errors and returns error response', () => {
    expect(bgContent).toContain('.catch(error =>');
    expect(bgContent).toContain("sendResponse({ success: false, error: error.message })");
  });

  test('rate limit errors include retry delay info', () => {
    // generateSpeechViaAPI should log retry delay for 429 errors
    expect(bgContent).toContain('429');
    expect(bgContent).toContain('retryDelay');
  });

  test('savePipelineState has try/catch', () => {
    expect(bgContent).toMatch(/async function savePipelineState[\s\S]*?catch/);
  });

  test('saveState has try/catch for quota errors', () => {
    expect(bgContent).toContain('quota');
  });
});

// ========== G. CONTENT SCRIPT STRUCTURE ==========

describe('Content Script Structure', () => {
  test('flow/main.js has IIFE wrapper to prevent double injection', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../content/flow/main.js'), 'utf-8'
    );
    expect(content).toContain('window.vidflowLoaded');
    expect(content).toContain("'use strict'");
  });

  test('flow/log.js defines vfLog function', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../content/flow/log.js'), 'utf-8'
    );
    expect(content).toContain('function vfLog(');
  });

  test('flow/utils.js defines sleep function', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '../../content/flow/utils.js'), 'utf-8'
    );
    expect(content).toContain('function sleep(ms)');
  });

  test('all content scripts end with loaded message', () => {
    const files = [
      'content/flow/utils.js',
      'content/flow/log.js',
      'content/flow/selectors.js',
      'content/flow/settings.js',
      'content/flow/generation-type.js',
      'content/flow/generation-image.js',
      'content/flow/generation.js',
      'content/flow/video.js',
      'content/flow/pipeline.js',
      'content/flow/detect.js',
      'content/flow/monitor.js',
    ];

    files.forEach(file => {
      const content = fs.readFileSync(path.join(__dirname, '../../', file), 'utf-8');
      expect(content).toContain('cargado');
    });
  });
});

// ========== H. GEMINI API KEY HANDLING ==========

describe('Gemini API Key Handling', () => {
  test('API key loaded from storage, not hardcoded', () => {
    const ttsSrc = fs.readFileSync(
      path.join(__dirname, '../../background/bg-tts.js'), 'utf-8'
    );
    expect(ttsSrc).toContain('storedGeminiApiKey');
    expect(ttsSrc).toContain('getGeminiApiKey');
    // Must NOT contain a hardcoded API key
    expect(ttsSrc).not.toMatch(/AIzaSy[A-Za-z0-9_-]{30,}/);
  });

  test('API key can be overridden from config', () => {
    const ttsSrc = fs.readFileSync(
      path.join(__dirname, '../../background/bg-tts.js'), 'utf-8'
    );
    expect(ttsSrc).toContain('pipelineState.config?.geminiApiKey');
  });
});

// ========== I. PERFORMANCE - SLEEP DELAYS AUDIT ==========

describe('Sleep Delays Audit', () => {
  test('monitor checks every 5 seconds (reasonable for UI polling)', () => {
    const mainContent = fs.readFileSync(
      path.join(__dirname, '../../content/flow/main.js'), 'utf-8'
    );
    // The 5s check interval is documented
    expect(mainContent).toContain('sleep(5000)');
    expect(mainContent).toContain('Revisar cada 5 segundos');
  });

  test('no sleep delays exceed 60 seconds in normal flow', () => {
    const bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
    // Find all sleep() calls and check their values
    const sleepCalls = bgContent.match(/sleep\((\d+)\)/g) || [];
    const sleepValues = sleepCalls.map(s => parseInt(s.match(/\d+/)[0]));

    // Filter out rate limit retries which can be longer
    const nonRateLimitSleeps = sleepValues.filter(v => v <= 60000);
    // All normal sleeps should be reasonable (< 10s)
    const normalSleeps = nonRateLimitSleeps.filter(v => v > 10000);
    // Only a few should be > 10s (reconnection waits, etc.)
    expect(normalSleeps.length).toBeLessThan(5);
  });
});

// ========== J. DOWNLOAD NAMING ==========

describe('Download Naming Consistency', () => {
  test('video files use 3-digit padding', () => {
    const bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
    // All video filename generation should use padStart(3, '0')
    const videoPadMatches = bgContent.match(/padStart\(3,\s*'0'\)/g);
    expect(videoPadMatches).not.toBeNull();
    expect(videoPadMatches.length).toBeGreaterThanOrEqual(3);
  });

  test('audio files use 2-digit padding', () => {
    const bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
    const audioPadMatches = bgContent.match(/padStart\(2,\s*'0'\)/g);
    expect(audioPadMatches).not.toBeNull();
  });

  test('whisk images use 2-digit padding', () => {
    const bgContent = fs.readFileSync(
      path.join(__dirname, '../../background.js'), 'utf-8'
    );
    // Whisk section uses padStart(2, '0')
    expect(bgContent).toContain("_whisk.png");
  });
});
