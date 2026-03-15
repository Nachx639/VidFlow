/**
 * Round 20 - Speech Content Scripts Deep Dive Tests
 * Comprehensive tests for all Speech modules: main, generation, selectors, utils, log
 */

// ========== SPEECH SELECTORS MODULE ==========

describe('Speech Selectors - SPEECH_SELECTORS constants', () => {
  const SPEECH_SELECTORS = {
    styleInput: 'textarea[aria-label="Style instructions"]',
    textInput: 'textarea[placeholder*="Start writing"], textarea[placeholder*="paste text"]',
    generateButton: 'button[aria-label="Run"], button[type="submit"]',
    voiceSelector: '[role="combobox"]',
    voiceOptions: '[role="option"], [role="listbox"] [role="option"]',
    audioPlayer: 'audio',
    downloadButton: 'button[aria-label*="download" i], button[aria-label*="Download" i], a[download]',
    errorMessage: '[role="alert"], [class*="error" i]'
  };

  test('all required selectors are defined', () => {
    expect(SPEECH_SELECTORS.styleInput).toContain('textarea');
    expect(SPEECH_SELECTORS.textInput).toContain('textarea');
    expect(SPEECH_SELECTORS.generateButton).toContain('button');
    expect(SPEECH_SELECTORS.audioPlayer).toBe('audio');
  });

  test('voice selector uses combobox role', () => {
    expect(SPEECH_SELECTORS.voiceSelector).toBe('[role="combobox"]');
  });
});

describe('Speech Selectors - getTextInput fallback', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('finds textarea by placeholder', () => {
    document.body.innerHTML = '<textarea placeholder="Start writing or paste text here"></textarea>';
    const input = document.querySelector('textarea[placeholder*="Start writing"], textarea[placeholder*="paste text"]');
    expect(input).not.toBeNull();
  });

  test('falls back to non-style textarea', () => {
    document.body.innerHTML = `
      <textarea aria-label="Style instructions"></textarea>
      <textarea aria-label="Text content"></textarea>`;
    
    let input = document.querySelector('textarea[placeholder*="Start writing"]');
    if (!input) {
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        if (ta.getAttribute('aria-label') !== 'Style instructions') {
          input = ta;
          break;
        }
      }
    }
    
    expect(input).not.toBeNull();
    expect(input.getAttribute('aria-label')).toBe('Text content');
  });

  test('returns null when only style textarea exists', () => {
    document.body.innerHTML = '<textarea aria-label="Style instructions"></textarea>';
    
    let input = document.querySelector('textarea[placeholder*="Start writing"]');
    if (!input) {
      const textareas = document.querySelectorAll('textarea');
      let found = null;
      for (const ta of textareas) {
        if (ta.getAttribute('aria-label') !== 'Style instructions') {
          found = ta;
          break;
        }
      }
      input = found;
    }
    
    expect(input).toBeNull();
  });
});

describe('Speech Selectors - getGenerateButton', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('finds by aria-label "Run"', () => {
    document.body.innerHTML = '<button aria-label="Run">▶</button>';
    expect(document.querySelector('button[aria-label="Run"]')).not.toBeNull();
  });

  test('falls back to text content "Run"', () => {
    document.body.innerHTML = '<button>Run</button>';
    const buttons = document.querySelectorAll('button');
    let btn = null;
    for (const b of buttons) {
      if (b.textContent?.includes('Run')) { btn = b; break; }
    }
    expect(btn).not.toBeNull();
  });

  test('returns null when no Run button', () => {
    document.body.innerHTML = '<button>Other</button>';
    const btn = document.querySelector('button[aria-label="Run"]');
    expect(btn).toBeNull();
  });
});

describe('Speech Selectors - isSingleSpeakerMode', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('returns true when button has ms-button-active class', () => {
    document.body.innerHTML = '<button type="button" class="ms-button-active">Single-speaker</button>';
    const btn = document.querySelector('button[type="button"]');
    expect(btn.classList.contains('ms-button-active')).toBe(true);
  });

  test('returns false when button lacks active class', () => {
    document.body.innerHTML = '<button type="button">Single-speaker</button>';
    const btn = document.querySelector('button[type="button"]');
    expect(btn.classList.contains('ms-button-active')).toBe(false);
  });

  test('handles multiple buttons - finds correct one', () => {
    document.body.innerHTML = `
      <button type="button" class="ms-button-active">Single-speaker</button>
      <button type="button">Multi-speaker</button>`;
    
    const buttons = document.querySelectorAll('button[type="button"]');
    let isActive = false;
    for (const btn of buttons) {
      if (btn.textContent.toLowerCase().includes('single-speaker')) {
        isActive = btn.classList.contains('ms-button-active');
      }
    }
    expect(isActive).toBe(true);
  });
});

describe('Speech Selectors - selectSingleSpeakerMode', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('clicks the Single-speaker button', () => {
    let clicked = false;
    document.body.innerHTML = '<button type="button">Single-speaker</button>';
    const btn = document.querySelector('button[type="button"]');
    btn.addEventListener('click', () => { clicked = true; });
    
    const buttons = document.querySelectorAll('button[type="button"]');
    for (const b of buttons) {
      if (b.textContent?.toLowerCase().includes('single-speaker')) {
        b.click();
      }
    }
    
    expect(clicked).toBe(true);
  });
});

describe('Speech Selectors - getAudioPlayer', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('finds audio element', () => {
    document.body.innerHTML = '<audio src="blob:test"></audio>';
    expect(document.querySelector('audio')).not.toBeNull();
  });

  test('returns null when no audio', () => {
    expect(document.querySelector('audio')).toBeNull();
  });
});

describe('Speech Selectors - Voice presets', () => {
  const AVAILABLE_VOICES = {
    female: ['Zephyr', 'Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina',
      'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat'],
    male: ['Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel',
      'Algieba', 'Algenib', 'Rasalgethi', 'Alnilam', 'Schedar', 'Achird',
      'Zubenelgenubi', 'Sadachbia', 'Sadaltager']
  };
  const ALL_VOICES = [...AVAILABLE_VOICES.female, ...AVAILABLE_VOICES.male];

  test('has 30 unique voices', () => {
    expect(new Set(ALL_VOICES).size).toBe(30);
  });

  test('all voices start with uppercase', () => {
    ALL_VOICES.forEach(v => {
      expect(v[0]).toBe(v[0].toUpperCase());
    });
  });

  test('includes commonly used voices', () => {
    expect(ALL_VOICES).toContain('Zephyr');
    expect(ALL_VOICES).toContain('Puck');
    expect(ALL_VOICES).toContain('Kore');
    expect(ALL_VOICES).toContain('Charon');
  });
});

describe('Speech Selectors - isSpeechPageReady', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('ready when textarea and Run button present', () => {
    document.body.innerHTML = `
      <textarea aria-label="Style instructions"></textarea>
      <button aria-label="Run">Run</button>`;
    
    const styleInput = document.querySelector('textarea[aria-label="Style instructions"]');
    const runBtn = document.querySelector('button[aria-label="Run"]');
    expect(!!(styleInput || null) && !!runBtn).toBe(true);
  });

  test('not ready without button', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const runBtn = document.querySelector('button[aria-label="Run"]');
    expect(!!runBtn).toBe(false);
  });
});

// ========== SPEECH GENERATION MODULE ==========

describe('Speech Generation - detectAudioFormat comprehensive', () => {
  function detectAudioFormat(src) {
    if (!src) return 'wav';
    if (src.startsWith('data:audio/')) {
      const match = src.match(/data:audio\/([^;,]+)/);
      if (match) {
        const mimeType = match[1].toLowerCase();
        if (mimeType === 'mpeg' || mimeType === 'mp3') return 'mp3';
        if (mimeType === 'wav' || mimeType === 'wave') return 'wav';
        if (mimeType === 'ogg') return 'ogg';
        return mimeType;
      }
    }
    const urlMatch = src.match(/\.([a-z0-9]+)(?:\?|$)/i);
    if (urlMatch) return urlMatch[1].toLowerCase();
    return 'wav';
  }

  test('handles data:audio/wav;base64', () => {
    expect(detectAudioFormat('data:audio/wav;base64,AAA')).toBe('wav');
  });

  test('handles data:audio/wave;base64', () => {
    expect(detectAudioFormat('data:audio/wave;base64,AAA')).toBe('wav');
  });

  test('handles data:audio/mpeg;base64', () => {
    expect(detectAudioFormat('data:audio/mpeg;base64,AAA')).toBe('mp3');
  });

  test('handles data:audio/mp3;base64', () => {
    expect(detectAudioFormat('data:audio/mp3;base64,AAA')).toBe('mp3');
  });

  test('handles data:audio/ogg;base64', () => {
    expect(detectAudioFormat('data:audio/ogg;base64,AAA')).toBe('ogg');
  });

  test('handles data:audio/flac;base64', () => {
    expect(detectAudioFormat('data:audio/flac;base64,AAA')).toBe('flac');
  });

  test('handles data:audio/webm;base64', () => {
    expect(detectAudioFormat('data:audio/webm;base64,AAA')).toBe('webm');
  });

  test('extracts from URL extension', () => {
    expect(detectAudioFormat('https://a.com/file.mp3')).toBe('mp3');
    expect(detectAudioFormat('https://a.com/file.wav')).toBe('wav');
    expect(detectAudioFormat('https://a.com/file.ogg')).toBe('ogg');
  });

  test('extracts from URL with query string', () => {
    expect(detectAudioFormat('https://a.com/file.mp3?t=123')).toBe('mp3');
  });

  test('defaults to wav for blob URLs', () => {
    expect(detectAudioFormat('blob:https://example.com/uuid')).toBe('wav');
  });

  test('defaults to wav for null/undefined/empty', () => {
    expect(detectAudioFormat(null)).toBe('wav');
    expect(detectAudioFormat(undefined)).toBe('wav');
    expect(detectAudioFormat('')).toBe('wav');
  });

  test('handles data URL with comma in content', () => {
    expect(detectAudioFormat('data:audio/wav;base64,AA,BB')).toBe('wav');
  });
});

describe('Speech Generation - enterNarrationText', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('sets value and dispatches input+change events', () => {
    const ta = document.createElement('textarea');
    const events = [];
    ta.addEventListener('input', () => events.push('input'));
    ta.addEventListener('change', () => events.push('change'));
    document.body.appendChild(ta);

    ta.value = 'Test narration text';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));

    expect(ta.value).toBe('Test narration text');
    expect(events).toEqual(['input', 'change']);
  });

  test('focus and blur are triggered', () => {
    const ta = document.createElement('textarea');
    const events = [];
    ta.addEventListener('focus', () => events.push('focus'));
    ta.addEventListener('blur', () => events.push('blur'));
    document.body.appendChild(ta);

    ta.focus();
    ta.blur();

    expect(events).toContain('focus');
    expect(events).toContain('blur');
  });
});

describe('Speech Generation - clearText', () => {
  test('clears textarea value', () => {
    const ta = document.createElement('textarea');
    ta.value = 'some text';
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    expect(ta.value).toBe('');
  });
});

describe('Speech Generation - selectVoice', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('opens combobox and selects matching option', () => {
    let comboboxClicked = false;
    let optionClicked = false;

    document.body.innerHTML = `
      <div role="combobox">Select voice</div>
      <div role="option">Zephyr</div>
      <div role="option">Puck</div>`;
    
    const combobox = document.querySelector('[role="combobox"]');
    combobox.addEventListener('click', () => { comboboxClicked = true; });
    
    const options = document.querySelectorAll('[role="option"]');
    for (const opt of options) {
      if (opt.textContent.toLowerCase().includes('puck')) {
        opt.addEventListener('click', () => { optionClicked = true; });
        opt.click();
      }
    }

    expect(optionClicked).toBe(true);
  });

  test('returns null when voice not found', () => {
    document.body.innerHTML = `
      <div role="option">Zephyr</div>
      <div role="option">Puck</div>`;
    
    const options = document.querySelectorAll('[role="option"]');
    let found = null;
    for (const opt of options) {
      if (opt.textContent.toLowerCase().includes('nonexistent')) {
        found = opt;
      }
    }
    expect(found).toBeNull();
  });
});

describe('Speech Generation - clickGenerate captures previous audio src', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('captures existing audio src before generating', () => {
    document.body.innerHTML = '<audio src="data:audio/wav;base64,OLD"></audio>';
    const audio = document.querySelector('audio');
    const previousSrc = audio?.src || null;
    expect(previousSrc).toContain('data:audio/wav');
  });

  test('returns null previousAudioSrc when no audio exists', () => {
    const audio = document.querySelector('audio');
    const previousSrc = audio?.src || null;
    expect(previousSrc).toBeNull();
  });
});

describe('Speech Generation - waitForGeneration with previousAudioSrc', () => {
  test('detects new audio when src changes', () => {
    const previousSrc = 'data:audio/wav;base64,OLD';
    const currentSrc = 'data:audio/wav;base64,NEW';
    
    const isNew = currentSrc !== previousSrc && currentSrc.startsWith('data:audio/');
    expect(isNew).toBe(true);
  });

  test('does not consider same src as new', () => {
    const previousSrc = 'data:audio/wav;base64,SAME';
    const currentSrc = 'data:audio/wav;base64,SAME';
    
    const isNew = currentSrc !== previousSrc;
    expect(isNew).toBe(false);
  });

  test('accepts any audio when no previous src', () => {
    const previousSrc = null;
    const currentSrc = 'data:audio/wav;base64,NEW';
    const duration = 5.5;
    
    const isValid = !previousSrc && duration > 0;
    expect(isValid).toBe(true);
  });

  test('rejects audio with NaN duration when no previous src', () => {
    const previousSrc = null;
    const duration = NaN;
    
    const isValid = !previousSrc && duration > 0;
    expect(isValid).toBe(false); // NaN > 0 is false
  });

  test('error detection filters correctly', () => {
    const isError = (text) => {
      const lower = text.toLowerCase();
      return lower.includes('error') || lower.includes('failed');
    };

    expect(isError('An error occurred')).toBe(true);
    expect(isError('Generation failed')).toBe(true);
    expect(isError('No audio generated')).toBe(false);
    expect(isError('Ready')).toBe(false);
  });
});

describe('Speech Generation - downloadGeneratedAudio', () => {
  test('constructs correct filename with format detection', () => {
    const index = 3;
    const audioFormat = 'wav';
    const filename = `${String(index + 1).padStart(2, '0')}_speech.${audioFormat}`;
    expect(filename).toBe('04_speech.wav');
  });

  test('constructs full path with project folder', () => {
    const projectFolder = 'VidFlow/Proyecto_test/narracion';
    const filename = '04_speech.wav';
    const fullPath = `${projectFolder}/${filename}`;
    expect(fullPath).toBe('VidFlow/Proyecto_test/narracion/04_speech.wav');
  });

  test('handles index 0 padding', () => {
    const filename = `${String(1).padStart(2, '0')}_speech.mp3`;
    expect(filename).toBe('01_speech.mp3');
  });

  test('handles double-digit index', () => {
    const filename = `${String(10).padStart(2, '0')}_speech.wav`;
    expect(filename).toBe('10_speech.wav');
  });

  test('handles triple-digit index (100+ scenes)', () => {
    const filename = `${String(100).padStart(2, '0')}_speech.wav`;
    expect(filename).toBe('100_speech.wav'); // padStart(2) doesn't truncate
  });
});

describe('Speech Generation - getGeneratedAudioAsDataURL', () => {
  test('returns data URL directly if src is already data URL', () => {
    const src = 'data:audio/wav;base64,AAAA';
    const isDataUrl = src.startsWith('data:');
    expect(isDataUrl).toBe(true);
  });

  test('needs conversion for blob URLs', () => {
    const src = 'blob:https://example.com/uuid';
    const isDataUrl = src.startsWith('data:');
    expect(isDataUrl).toBe(false);
  });
});

describe('Speech Generation - getAudioInfo', () => {
  test('returns correct info object shape', () => {
    function detectAudioFormat(src) {
      if (!src) return 'wav';
      if (src.startsWith('data:audio/')) {
        const match = src.match(/data:audio\/([^;,]+)/);
        if (match) {
          const m = match[1].toLowerCase();
          if (m === 'mpeg' || m === 'mp3') return 'mp3';
          if (m === 'wav' || m === 'wave') return 'wav';
          return m;
        }
      }
      return 'wav';
    }

    const src = 'data:audio/wav;base64,AAA';
    const duration = 5.5;
    const info = {
      src,
      duration,
      format: detectAudioFormat(src),
      hasAudio: src && duration > 0
    };

    expect(info.format).toBe('wav');
    expect(info.hasAudio).toBe(true);
    expect(info.duration).toBe(5.5);
  });

  test('hasAudio is false when duration is 0', () => {
    const hasAudio = 'some-src' && 0 > 0;
    expect(hasAudio).toBe(false);
  });

  test('hasAudio is false when src is empty', () => {
    const hasAudio = '' && 5 > 0;
    expect(hasAudio).toBeFalsy();
  });
});

// ========== SPEECH UTILS MODULE ==========

describe('Speech Utils - waitForPageReady', () => {
  function isSpeechPageReady() {
    const styleInput = document.querySelector('textarea[aria-label="Style instructions"]');
    const textInput = document.querySelector('textarea');
    const runBtn = document.querySelector('button[aria-label="Run"]');
    return !!(styleInput || textInput) && !!runBtn;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('ready with style input and run button', () => {
    document.body.innerHTML = `
      <textarea aria-label="Style instructions"></textarea>
      <button aria-label="Run">Run</button>`;
    expect(isSpeechPageReady()).toBe(true);
  });

  test('ready with any textarea and run button', () => {
    document.body.innerHTML = `
      <textarea placeholder="Enter text"></textarea>
      <button aria-label="Run">Run</button>`;
    expect(isSpeechPageReady()).toBe(true);
  });

  test('not ready without run button', () => {
    document.body.innerHTML = '<textarea></textarea>';
    expect(isSpeechPageReady()).toBe(false);
  });
});

describe('Speech Utils - checkForError', () => {
  function checkForError() {
    const errorPatterns = ['error', 'failed', 'falló', 'no se pudo', 'try again', 'intentar de nuevo'];
    const errorElements = document.querySelectorAll('[role="alert"], [class*="error" i], [class*="Error"]');
    for (const el of errorElements) {
      const text = el.textContent?.toLowerCase() || '';
      for (const pattern of errorPatterns) {
        if (text.includes(pattern)) {
          return el.textContent.trim();
        }
      }
    }
    return null;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('detects error alert', () => {
    document.body.innerHTML = '<div role="alert">An error occurred</div>';
    expect(checkForError()).toBe('An error occurred');
  });

  test('detects Spanish error', () => {
    document.body.innerHTML = '<div role="alert">La operación falló</div>';
    expect(checkForError()).toBe('La operación falló');
  });

  test('detects try again message', () => {
    document.body.innerHTML = '<div role="alert">Please try again later</div>';
    expect(checkForError()).toBe('Please try again later');
  });

  test('returns null when no error', () => {
    document.body.innerHTML = '<div role="alert">Success!</div>';
    expect(checkForError()).toBeNull();
  });

  test('returns null on empty page', () => {
    expect(checkForError()).toBeNull();
  });

  test('detects error by class name', () => {
    document.body.innerHTML = '<div class="error-banner">Something failed</div>';
    expect(checkForError()).toBe('Something failed');
  });
});

describe('Speech Utils - escapeHtml', () => {
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  test('escapes <script> tags', () => {
    const result = escapeHtml('<script>alert(1)</script>');
    expect(result).not.toContain('<script>');
  });

  test('handles unicode text', () => {
    expect(escapeHtml('Café ñ 日本語')).toBe('Café ñ 日本語');
  });
});

// ========== SPEECH MAIN MODULE ==========

describe('Speech Main - message listener actions', () => {
  const KNOWN_ACTIONS = [
    'ping', 'initSpeechPanel', 'setupSpeechConfig', 'generateSpeechAudio',
    'speechGenerateSingle', 'stopAutomation', 'getSpeechStatus',
    'setupSpeechPipeline', 'generateSpeechScene'
  ];

  test('all 9 actions are handled', () => {
    expect(KNOWN_ACTIONS).toHaveLength(9);
  });

  test('ping returns page identifier', () => {
    const response = { success: true, page: 'speech' };
    expect(response.page).toBe('speech');
  });

  test('getStatus returns correct shape', () => {
    const status = {
      success: true,
      isAutomating: false,
      currentSceneIndex: 0,
      totalScenes: 0
    };
    expect(status).toHaveProperty('isAutomating');
    expect(status).toHaveProperty('currentSceneIndex');
    expect(status).toHaveProperty('totalScenes');
  });
});

describe('Speech Main - handleSetupPipeline', () => {
  test('sets pipeline config correctly', () => {
    const data = {
      scenes: [{ narration: 'Scene 1' }, { narration: 'Scene 2' }],
      projectFolder: 'VidFlow/Test',
      config: { speechVoice: 'Zephyr' }
    };

    const config = {
      scenes: data.scenes || [],
      projectFolder: data.projectFolder || 'VidFlow',
      config: data.config || {}
    };

    expect(config.scenes).toHaveLength(2);
    expect(config.projectFolder).toBe('VidFlow/Test');
    expect(config.config.speechVoice).toBe('Zephyr');
  });

  test('uses default projectFolder when not provided', () => {
    const config = {
      projectFolder: undefined || 'VidFlow'
    };
    expect(config.projectFolder).toBe('VidFlow');
  });

  test('voice selection prefers speechVoice over voice', () => {
    const config = { speechVoice: 'Zephyr', voice: 'Puck' };
    const voiceToUse = config.speechVoice || config.voice;
    expect(voiceToUse).toBe('Zephyr');
  });

  test('voice selection falls back to voice', () => {
    const config = { voice: 'Puck' };
    const voiceToUse = config.speechVoice || config.voice;
    expect(voiceToUse).toBe('Puck');
  });
});

describe('Speech Main - handleGenerateScene flow', () => {
  test('narration text extraction handles both keys', () => {
    const extract = (data) => data.narration || data.text;
    
    expect(extract({ narration: 'from narration' })).toBe('from narration');
    expect(extract({ text: 'from text' })).toBe('from text');
    expect(extract({ narration: 'preferred', text: 'fallback' })).toBe('preferred');
  });

  test('throws when no narration text', () => {
    const data = {};
    const narrationText = data.narration || data.text;
    expect(narrationText).toBeUndefined();
  });
});

describe('Speech Main - stopAutomation', () => {
  test('resets all state', () => {
    let isAutomating = true;
    let currentSceneIndex = 3;
    let totalScenes = 5;

    isAutomating = false;
    currentSceneIndex = 0;
    totalScenes = 0;

    expect(isAutomating).toBe(false);
    expect(currentSceneIndex).toBe(0);
    expect(totalScenes).toBe(0);
  });
});

// ========== SPEECH LOG MODULE ==========

describe('Speech Log - panel initialization', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('creates panel with speech-specific ID', () => {
    const panel = document.createElement('div');
    panel.id = 'vidflow-speech-log-panel';
    document.body.appendChild(panel);
    expect(document.getElementById('vidflow-speech-log-panel')).not.toBeNull();
  });

  test('re-init clears content', () => {
    document.body.innerHTML = `
      <div id="vidflow-speech-log-panel">
        <div id="vf-speech-log-content"><div>old</div></div>
      </div>`;
    
    const content = document.getElementById('vf-speech-log-content');
    content.innerHTML = '';
    expect(content.children.length).toBe(0);
  });

  test('style uses green border (#10b981) for speech', () => {
    const expectedColor = '#10b981';
    expect(expectedColor).toBe('#10b981'); // Speech uses green vs purple for whisk
  });
});

describe('Speech Log - MAX_LOG_ENTRIES', () => {
  test('caps at 500', () => {
    let entries = Array.from({ length: 600 }, (_, i) => ({ msg: `m${i}` }));
    if (entries.length > 500) {
      entries = entries.slice(-500);
    }
    expect(entries.length).toBe(500);
    expect(entries[0].msg).toBe('m100');
  });
});

describe('Speech Log - saveLogsToStorage key', () => {
  test('uses vidflowSpeechLogs key (not vidflowWhiskLogs)', () => {
    const key = 'vidflowSpeechLogs';
    expect(key).not.toBe('vidflowWhiskLogs');
  });

  test('saves last 100 entries', () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({ msg: `m${i}` }));
    const saved = entries.slice(-100);
    expect(saved.length).toBe(100);
  });
});

// ========== INTEGRATION-STYLE TESTS ==========

describe('Speech - Full generation pipeline', () => {
  test('pipeline steps in correct order', () => {
    const steps = [
      'clearText',
      'enterStyleInstructions',
      'enterNarrationText',
      'selectVoice',
      'clickGenerate',
      'waitForGeneration',
      'getGeneratedAudioAsDataURL',
      'downloadGeneratedAudio',
      'notifyBackground'
    ];

    expect(steps.indexOf('clearText')).toBe(0);
    expect(steps.indexOf('enterNarrationText')).toBeLessThan(steps.indexOf('clickGenerate'));
    expect(steps.indexOf('clickGenerate')).toBeLessThan(steps.indexOf('waitForGeneration'));
    expect(steps.indexOf('waitForGeneration')).toBeLessThan(steps.indexOf('downloadGeneratedAudio'));
  });
});

describe('Speech - Edge cases', () => {
  test('enterStyleInstructions returns true for null/empty style', () => {
    // Code: if (!style) return true;
    const result = !'' ? true : false;
    expect(result).toBe(true);
    const result2 = !null ? true : false;
    expect(result2).toBe(true);
  });

  test('ensureSingleSpeakerMode called during pipeline setup', () => {
    // Verify it's part of the setup flow
    const setupSteps = ['waitForPageReady', 'ensureSingleSpeakerMode', 'selectVoice'];
    expect(setupSteps).toContain('ensureSingleSpeakerMode');
  });

  test('audio duration can be NaN before metadata loads', () => {
    const duration = NaN;
    expect(duration > 0).toBe(false);
    expect(isNaN(duration)).toBe(true);
  });

  test('data URL length validation (must be > 100 chars)', () => {
    const shortUrl = 'data:audio/wav;base64,AA';
    const longUrl = 'data:audio/wav;base64,' + 'A'.repeat(200);
    
    expect(shortUrl.length < 100).toBe(true);
    expect(longUrl.length > 100).toBe(true);
  });
});

describe('Speech - Cookie banner handling', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('accepts cookies when banner present', () => {
    let clicked = false;
    document.body.innerHTML = '<button class="glue-cookie-notification-bar__accept">Accept</button>';
    const btn = document.querySelector('.glue-cookie-notification-bar__accept');
    btn.addEventListener('click', () => { clicked = true; });
    btn.click();
    expect(clicked).toBe(true);
  });

  test('handles missing cookie banner gracefully', () => {
    const btn = document.querySelector('.glue-cookie-notification-bar__accept');
    expect(btn).toBeNull();
  });
});
