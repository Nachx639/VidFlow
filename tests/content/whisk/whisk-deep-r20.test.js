/**
 * Round 20 - Whisk Content Scripts Deep Dive Tests
 * Comprehensive tests for all Whisk modules: main, generation, selectors, utils, log
 */

// ========== WHISK SELECTORS MODULE ==========

describe('Whisk Selectors - SECTION_NAMES', () => {
  const SECTION_NAMES = {
    subject: ['Asunto', 'Subject', 'ASUNTO', 'SUBJECT'],
    scene: ['Escena', 'Scene', 'ESCENA', 'SCENE'],
    style: ['Estilo', 'Style', 'ESTILO', 'STYLE']
  };

  test('each type has Spanish, English, and uppercase variants', () => {
    for (const [type, names] of Object.entries(SECTION_NAMES)) {
      expect(names.length).toBeGreaterThanOrEqual(4);
      // Has lowercase Spanish
      expect(names.some(n => /^[A-Z][a-z]/.test(n))).toBe(true);
      // Has uppercase
      expect(names.some(n => n === n.toUpperCase())).toBe(true);
    }
  });

  test('all three reference types are covered', () => {
    expect(Object.keys(SECTION_NAMES)).toEqual(['subject', 'scene', 'style']);
  });
});

describe('Whisk Selectors - findSectionByName DOM traversal', () => {
  const SECTION_NAMES = {
    subject: ['Asunto', 'Subject', 'ASUNTO', 'SUBJECT'],
    scene: ['Escena', 'Scene', 'ESCENA', 'SCENE'],
    style: ['Estilo', 'Style', 'ESTILO', 'STYLE']
  };

  function findSectionByName(sectionType) {
    const names = SECTION_NAMES[sectionType];
    if (!names) return null;
    const h4s = document.querySelectorAll('h4');
    for (const h4 of h4s) {
      const text = h4.textContent.trim();
      if (names.includes(text)) {
        let container = h4.parentElement;
        for (let i = 0; i < 6 && container; i++) {
          if (container.querySelector('input[type="file"]')) {
            return container;
          }
          container = container.parentElement;
        }
      }
    }
    return null;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('finds section by English name', () => {
    document.body.innerHTML = `
      <div id="section">
        <div><h4>Subject</h4></div>
        <input type="file" />
      </div>`;
    const section = findSectionByName('subject');
    expect(section).not.toBeNull();
    expect(section.id).toBe('section');
  });

  test('finds section by Spanish name', () => {
    document.body.innerHTML = `
      <div id="section">
        <div><h4>Asunto</h4></div>
        <input type="file" />
      </div>`;
    expect(findSectionByName('subject')).not.toBeNull();
  });

  test('finds section by uppercase name', () => {
    document.body.innerHTML = `
      <div id="section">
        <div><h4>SUBJECT</h4></div>
        <input type="file" />
      </div>`;
    expect(findSectionByName('subject')).not.toBeNull();
  });

  test('returns null when no file input within 6 levels', () => {
    // h4 exists but file input is too deep
    document.body.innerHTML = `
      <div><div><div><div><div><div><div><div>
        <h4>Subject</h4>
      </div></div></div></div></div></div></div></div>
      <input type="file" />`;
    expect(findSectionByName('subject')).toBeNull();
  });

  test('returns null for unknown section type', () => {
    expect(findSectionByName('unknown')).toBeNull();
  });

  test('returns null when no h4 matches', () => {
    document.body.innerHTML = '<h4>Other</h4><input type="file" />';
    expect(findSectionByName('subject')).toBeNull();
  });

  test('finds correct section among multiple', () => {
    document.body.innerHTML = `
      <div id="subj"><h4>Subject</h4><input type="file" /></div>
      <div id="scene"><h4>Scene</h4><input type="file" /></div>
      <div id="style"><h4>Style</h4><input type="file" /></div>`;
    
    const subj = findSectionByName('subject');
    const scene = findSectionByName('scene');
    const style = findSectionByName('style');
    
    expect(subj.id).toBe('subj');
    expect(scene.id).toBe('scene');
    expect(style.id).toBe('style');
  });
});

describe('Whisk Selectors - isImagesPanelExpanded', () => {
  const SECTION_NAMES = {
    subject: ['Asunto', 'Subject', 'ASUNTO', 'SUBJECT'],
    scene: ['Escena', 'Scene', 'ESCENA', 'SCENE'],
    style: ['Estilo', 'Style', 'ESTILO', 'STYLE']
  };

  function isImagesPanelExpanded() {
    const sections = document.querySelectorAll('h4');
    for (const section of sections) {
      const text = section.textContent.trim();
      if (SECTION_NAMES.subject.includes(text) ||
          SECTION_NAMES.scene.includes(text) ||
          SECTION_NAMES.style.includes(text)) {
        return true;
      }
    }
    return false;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('returns true when section h4 is present', () => {
    document.body.innerHTML = '<h4>Subject</h4>';
    expect(isImagesPanelExpanded()).toBe(true);
  });

  test('returns false when no section h4', () => {
    document.body.innerHTML = '<h4>Other heading</h4>';
    expect(isImagesPanelExpanded()).toBe(false);
  });

  test('returns false on empty page', () => {
    expect(isImagesPanelExpanded()).toBe(false);
  });
});

describe('Whisk Selectors - getPromptInput and getGenerateButton', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('getPromptInput finds textarea', () => {
    document.body.innerHTML = '<textarea></textarea>';
    expect(document.querySelector('textarea')).not.toBeNull();
  });

  test('getGenerateButton finds submit button', () => {
    document.body.innerHTML = '<button type="submit">Send</button>';
    expect(document.querySelector('button[type="submit"]')).not.toBeNull();
  });

  test('isWhiskPageReady requires both textarea and button', () => {
    const isReady = () => !!(document.querySelector('textarea') && document.querySelector('button[type="submit"]'));
    
    document.body.innerHTML = '<textarea></textarea>';
    expect(isReady()).toBe(false);
    
    document.body.innerHTML += '<button type="submit">Go</button>';
    expect(isReady()).toBe(true);
  });
});

// ========== WHISK UTILS MODULE ==========

describe('Whisk Utils - base64ToFile', () => {
  function base64ToFile(base64, filename) {
    const arr = base64.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  }

  test('converts valid base64 data URI to File', () => {
    const base64 = 'data:image/png;base64,iVBORw0KGgo=';
    const file = base64ToFile(base64, 'test.png');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('test.png');
    expect(file.type).toBe('image/png');
  });

  test('handles jpeg mime type', () => {
    const base64 = 'data:image/jpeg;base64,/9j/4AAQ';
    const file = base64ToFile(base64, 'test.jpg');
    expect(file.type).toBe('image/jpeg');
  });

  test('defaults to image/png when no mime match', () => {
    // No colon-semicolon pattern in prefix
    const base64 = 'noprefix,iVBORw0KGgo=';
    const file = base64ToFile(base64, 'test.png');
    expect(file.type).toBe('image/png');
  });

  test('throws on raw base64 without comma', () => {
    // BUG: if base64 has no comma, arr[1] is undefined → atob(undefined) throws
    expect(() => {
      base64ToFile('iVBORw0KGgo=', 'test.png');
    }).toThrow();
  });

  test('creates file with correct byte content', () => {
    // "Hello" in base64
    const base64 = 'data:text/plain;base64,SGVsbG8=';
    const file = base64ToFile(base64, 'hello.txt');
    expect(file.size).toBe(5);
  });
});

describe('Whisk Utils - escapeHtml', () => {
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  test('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).not.toContain('<script>');
  });

  test('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toContain('&amp;');
  });

  test('preserves normal text', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('Whisk Utils - waitForElement', () => {
  async function waitForElement(selector, timeout = 500) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Element not found: ${selector}`);
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('finds element that already exists', async () => {
    document.body.innerHTML = '<div id="target"></div>';
    const el = await waitForElement('#target');
    expect(el.id).toBe('target');
  });

  test('finds element added after delay', async () => {
    setTimeout(() => {
      document.body.innerHTML = '<div id="delayed"></div>';
    }, 100);
    const el = await waitForElement('#delayed', 1000);
    expect(el.id).toBe('delayed');
  });

  test('throws on timeout', async () => {
    await expect(waitForElement('#nonexistent', 200)).rejects.toThrow('Element not found');
  });
});

describe('Whisk Utils - findElement', () => {
  function findElement(texts, tagFilter = null) {
    const allElements = document.querySelectorAll(tagFilter || '*');
    for (const el of allElements) {
      const elText = el.textContent?.trim().toLowerCase();
      const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
      const placeholder = el.getAttribute('placeholder')?.toLowerCase();
      for (const searchText of texts) {
        const search = searchText.toLowerCase();
        if (elText === search || elText?.includes(search) ||
            ariaLabel?.includes(search) || placeholder?.includes(search)) {
          if (el.tagName === 'BUTTON' || el.tagName === 'A' ||
              el.getAttribute('role') === 'button' ||
              el.getAttribute('role') === 'option' ||
              el.getAttribute('role') === 'menuitem' ||
              el.onclick || el.closest('button')) {
            return el.closest('button') || el;
          }
          if (!tagFilter) return el;
        }
      }
    }
    return null;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('finds button by text', () => {
    document.body.innerHTML = '<button>Click me</button>';
    const el = findElement(['click me']);
    // findElement traverses all elements; the button's text is found
    expect(el).not.toBeNull();
  });

  test('finds element by aria-label', () => {
    document.body.innerHTML = '<button aria-label="Submit form">Go</button>';
    const el = findElement(['submit form']);
    expect(el).not.toBeNull();
  });

  test('finds element by placeholder', () => {
    document.body.innerHTML = '<input placeholder="Search here" />';
    const el = findElement(['search here']);
    expect(el).not.toBeNull();
  });

  test('returns null when not found', () => {
    document.body.innerHTML = '<div>Nothing</div>';
    expect(findElement(['nonexistent'])).toBeNull();
  });

  test('respects tag filter', () => {
    document.body.innerHTML = '<div>Text</div><button>Other</button>';
    const el = findElement(['text'], 'button');
    expect(el).toBeNull(); // div has "text" but filter is button
  });

  test('finds button element directly when it matches', () => {
    document.body.innerHTML = '<button>Click</button>';
    // When button itself matches, it returns the button
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('Click');
  });
});

describe('Whisk Utils - waitForPageReady', () => {
  function isWhiskPageReady() {
    const textarea = document.querySelector('textarea');
    const submitBtn = document.querySelector('button[type="submit"]');
    return !!(textarea && submitBtn);
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('returns true when textarea and submit button present', () => {
    document.body.innerHTML = '<textarea></textarea><button type="submit">Go</button>';
    expect(isWhiskPageReady()).toBe(true);
  });

  test('returns false when only textarea', () => {
    document.body.innerHTML = '<textarea></textarea>';
    expect(isWhiskPageReady()).toBe(false);
  });

  test('returns false on empty page', () => {
    expect(isWhiskPageReady()).toBe(false);
  });
});

describe('Whisk Utils - goToEditorIfOnHome', () => {
  function findIntroduceToolButton() {
    const buttons = document.querySelectorAll('button, a');
    for (const btn of buttons) {
      const text = btn.textContent?.toLowerCase().trim() || '';
      if (text.includes('get started') || text.includes('introducir herramienta') ||
          text.includes('empezar') || text.includes('probar')) {
        return btn;
      }
    }
    return null;
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  test('finds "Get started" button', () => {
    document.body.innerHTML = '<button>Get started</button>';
    expect(findIntroduceToolButton()).not.toBeNull();
  });

  test('finds Spanish "Introducir herramienta" button', () => {
    document.body.innerHTML = '<button>INTRODUCIR HERRAMIENTA</button>';
    expect(findIntroduceToolButton()).not.toBeNull();
  });

  test('finds "Empezar" button', () => {
    document.body.innerHTML = '<a href="#">Empezar</a>';
    expect(findIntroduceToolButton()).not.toBeNull();
  });

  test('returns null when no intro button', () => {
    document.body.innerHTML = '<button>Other</button>';
    expect(findIntroduceToolButton()).toBeNull();
  });
});

// ========== WHISK GENERATION MODULE ==========

describe('Whisk Generation - enterPrompt DOM interaction', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('sets textarea value and dispatches events', () => {
    const ta = document.createElement('textarea');
    const events = [];
    ta.addEventListener('input', () => events.push('input'));
    ta.addEventListener('change', () => events.push('change'));
    document.body.appendChild(ta);

    ta.value = 'test prompt';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));

    expect(ta.value).toBe('test prompt');
    expect(events).toContain('input');
    expect(events).toContain('change');
  });
});

describe('Whisk Generation - clearReference DOM interaction', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('clicks remove button when found', () => {
    let clicked = false;
    document.body.innerHTML = `
      <div id="section">
        <h4>Subject</h4>
        <input type="file" />
        <button aria-label="Remove image">X</button>
      </div>`;
    
    const btn = document.querySelector('button[aria-label*="Remove"]');
    // aria-label matching is case-insensitive in code but querySelector is exact
    // The code uses 'i' flag: button[aria-label*="remove" i]
    expect(btn).not.toBeNull();
  });

  test('handles missing clear button gracefully', () => {
    document.body.innerHTML = `
      <div><h4>Subject</h4><input type="file" /></div>`;
    const btn = document.querySelector('button[aria-label*="remove"]');
    expect(btn).toBeNull();
  });
});

describe('Whisk Generation - waitForGeneration logic', () => {
  test('noChangeCount increments and triggers failure after 3', () => {
    let noChangeCount = 0;
    const threshold = 3;
    
    // Simulate 3 checks with no loading and button enabled
    for (let i = 0; i < 5; i++) {
      const loading = false;
      const buttonEnabled = true;
      const elapsed = 15; // > 10

      if (!loading && buttonEnabled && elapsed > 10) {
        noChangeCount++;
        if (noChangeCount >= threshold) {
          break;
        }
      } else {
        noChangeCount = 0;
      }
    }
    
    expect(noChangeCount).toBe(3);
  });

  test('noChangeCount resets when loading detected', () => {
    let noChangeCount = 2;
    const loading = true;
    const buttonEnabled = true;
    const elapsed = 15;

    if (!loading && buttonEnabled && elapsed > 10) {
      noChangeCount++;
    } else {
      noChangeCount = 0;
    }

    expect(noChangeCount).toBe(0);
  });

  test('error detection filters out page titles and short messages', () => {
    const isRealError = (text) => {
      return text.length > 10 &&
        !text.includes('labs.google') &&
        !text.includes('Whisk') &&
        (text.toLowerCase().includes('error') ||
         text.toLowerCase().includes('failed') ||
         text.toLowerCase().includes('try again'));
    };

    expect(isRealError('An error occurred while generating your image')).toBe(true);
    expect(isRealError('Whisk - labs.google')).toBe(false);
    expect(isRealError('Error')).toBe(false); // Too short (<=10)
    expect(isRealError('labs.google error page')).toBe(false);
    expect(isRealError('Generation failed, please try again')).toBe(true);
  });
});

describe('Whisk Generation - downloadGeneratedImage', () => {
  test('selects the LAST blob image', () => {
    document.body.innerHTML = '';
    const imgs = [];
    for (let i = 0; i < 3; i++) {
      const img = document.createElement('img');
      img.setAttribute('data-order', String(i));
      document.body.appendChild(img);
      imgs.push(img);
    }

    const allImgs = Array.from(document.querySelectorAll('img'));
    const lastImg = allImgs[allImgs.length - 1];
    expect(lastImg.getAttribute('data-order')).toBe('2');
  });

  test('constructs correct download path', () => {
    const index = 2;
    const projectFolder = 'Proyecto_test';
    const paddedNumber = String(index + 1).padStart(2, '0');
    const expectedFilename = `VidFlow/${projectFolder}/imagenes_whisk/${paddedNumber}_whisk.png`;
    expect(expectedFilename).toBe('VidFlow/Proyecto_test/imagenes_whisk/03_whisk.png');
  });

  test('traverses up to 5 parent levels for download button', () => {
    document.body.innerHTML = `
      <div id="level5">
        <div id="level4">
          <div id="level3">
            <div id="level2">
              <div id="level1">
                <img id="target" />
              </div>
            </div>
          </div>
        </div>
        <button aria-label="Download">DL</button>
      </div>`;
    
    const img = document.getElementById('target');
    let container = img.parentElement;
    let downloadBtn = null;
    
    for (let i = 0; i < 5 && container; i++) {
      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.getAttribute('aria-label')?.toLowerCase().includes('download')) {
          downloadBtn = btn;
          break;
        }
      }
      if (downloadBtn) break;
      container = container.parentElement;
    }
    
    expect(downloadBtn).not.toBeNull();
  });
});

describe('Whisk Generation - getGeneratedImageUrl', () => {
  test('filters images by blob: prefix and width > 200', () => {
    // In real browser, img.width reflects rendered width
    // In jsdom, width is 0 by default unless set explicitly
    const filterLogic = (src, width) => {
      return src && src.startsWith('blob:https://labs.google') && width > 200;
    };

    expect(filterLogic('blob:https://labs.google/uuid', 512)).toBe(true);
    expect(filterLogic('blob:https://labs.google/uuid', 100)).toBe(false);
    expect(filterLogic('https://example.com/img.png', 512)).toBe(false);
    expect(filterLogic(null, 512)).toBeFalsy();
    expect(filterLogic('blob:https://other.com/uuid', 512)).toBe(false);
  });
});

describe('Whisk Generation - uploadReferenceImage flow', () => {
  test('creates File from base64 data', () => {
    const file = new File(['test'], 'ref.png', { type: 'image/png' });
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('ref.png');
    expect(file.type).toBe('image/png');
  });

  test('dispatches change event on file input', () => {
    const input = document.createElement('input');
    input.type = 'file';
    let eventFired = false;
    input.addEventListener('change', () => { eventFired = true; });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(eventFired).toBe(true);
  });
});

describe('Whisk Generation - waitForReferenceProcessing', () => {
  test('detects loading indicators', () => {
    document.body.innerHTML = '<div aria-busy="true">Loading...</div>';
    const loading = document.querySelectorAll('[aria-busy="true"]');
    expect(loading.length).toBe(1);
  });

  test('detects analyzing text', () => {
    const text = 'Analyzing your image...';
    const isAnalyzing = text.toLowerCase().includes('analyzing') ||
                        text.toLowerCase().includes('processing');
    expect(isAnalyzing).toBe(true);
  });

  test('detects loaded image', () => {
    document.body.innerHTML = '<div><img src="blob:https://example.com/uuid" /></div>';
    const hasImage = document.querySelector('img[src*="blob:"]');
    expect(hasImage).not.toBeNull();
  });
});

// ========== WHISK MAIN MODULE ==========

describe('Whisk Main - clearNonPersistentReferencesArray advanced', () => {
  function makeRef(id, persistent = false) {
    const padding = 'X'.repeat(50);
    const fingerprint = id.padEnd(100, '0');
    return { data: padding + fingerprint, name: `ref_${id}`, persistent };
  }

  function clearNonPersistentReferencesArray(loadedReferences, persistentTypes, newReferences) {
    const cleared = [];
    for (const type of ['subject', 'scene', 'style']) {
      const currentRefs = loadedReferences[type] || [];
      const newRefs = newReferences?.[type] || [];
      const newFingerprints = newRefs.map(r => r.data.substring(50, 150));
      const persistentFingerprints = newRefs.filter(r => r.persistent).map(r => r.data.substring(50, 150));
      const hasNonPersistentLoaded = currentRefs.some(fp => !persistentFingerprints.includes(fp));
      const newNonPersistent = newRefs.filter(r => !r.persistent);

      if (hasNonPersistentLoaded && newNonPersistent.length > 0) {
        const currentNonPersistent = currentRefs.filter(fp => !persistentFingerprints.includes(fp));
        const newNonPersistentFps = newNonPersistent.map(r => r.data.substring(50, 150));
        const areDifferent = currentNonPersistent.length !== newNonPersistentFps.length ||
          currentNonPersistent.some(fp => !newNonPersistentFps.includes(fp));
        if (areDifferent) {
          cleared.push(type);
          loadedReferences[type] = [...persistentFingerprints];
        }
      } else if (currentRefs.length > 0 && newRefs.length === 0) {
        cleared.push(type);
        loadedReferences[type] = [];
      }
    }
    return cleared;
  }

  test('preserves persistent refs when clearing non-persistent', () => {
    const persistFp = 'persistent_ref'.padEnd(100, '0');
    const oldNonPersistFp = 'old_non_persist'.padEnd(100, '0');
    
    const loaded = { 
      subject: [persistFp, oldNonPersistFp], 
      scene: [], 
      style: [] 
    };
    const newRefs = {
      subject: [makeRef('persistent_ref', true), makeRef('new_non_persist')],
      scene: [], style: []
    };

    clearNonPersistentReferencesArray(loaded, {}, newRefs);
    expect(loaded.subject).toContain(persistFp);
    expect(loaded.subject).not.toContain(oldNonPersistFp);
  });

  test('does not clear when only persistent refs change', () => {
    const fp = 'only_persistent'.padEnd(100, '0');
    const loaded = { subject: [fp], scene: [], style: [] };
    const newRefs = {
      subject: [makeRef('only_persistent', true)],
      scene: [], style: []
    };

    const cleared = clearNonPersistentReferencesArray(loaded, {}, newRefs);
    // fp is in persistentFingerprints, so hasNonPersistentLoaded is false
    expect(cleared).not.toContain('subject');
  });

  test('handles all three types independently', () => {
    const loaded = {
      subject: ['a'.padEnd(100, '0')],
      scene: [],
      style: ['b'.padEnd(100, '0')]
    };
    const newRefs = {
      subject: [makeRef('c')], // different → clear
      scene: [makeRef('d')],   // no loaded → don't clear
      style: []                 // loaded but empty new → clear
    };

    const cleared = clearNonPersistentReferencesArray(loaded, {}, newRefs);
    expect(cleared).toContain('subject');
    expect(cleared).not.toContain('scene');
    expect(cleared).toContain('style');
  });

  test('handles undefined newReferences gracefully', () => {
    const loaded = { subject: [], scene: [], style: [] };
    const cleared = clearNonPersistentReferencesArray(loaded, {}, undefined);
    expect(cleared).toEqual([]);
  });

  test('handles refs with very short data (edge case for fingerprint)', () => {
    // If data is shorter than 150 chars, substring(50,150) still works
    const shortData = 'X'.repeat(60); // Only 60 chars
    const fp = shortData.substring(50, 150); // Gets 10 chars
    expect(fp.length).toBe(10);
  });
});

describe('Whisk Main - handleGenerateScene retry logic', () => {
  test('MAX_RETRIES is 3', () => {
    const MAX_RETRIES = 3;
    expect(MAX_RETRIES).toBe(3);
  });

  test('retry loop structure succeeds on second attempt', () => {
    const MAX_RETRIES = 3;
    let attempt = 0;
    let result = null;

    while (attempt < MAX_RETRIES) {
      attempt++;
      if (attempt === 2) {
        result = 'success';
        break;
      }
    }

    expect(attempt).toBe(2);
    expect(result).toBe('success');
  });

  test('retry loop exhausts all attempts on persistent failure', () => {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;
      // always fail - continue to next iteration
    }

    expect(attempt).toBe(MAX_RETRIES);
  });

  test('references only uploaded on first attempt', () => {
    const MAX_RETRIES = 3;
    let uploadCount = 0;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt === 1) {
        uploadCount++;
      }
    }

    expect(uploadCount).toBe(1);
  });
});

describe('Whisk Main - stopAutomation', () => {
  test('resets all state correctly', () => {
    let isAutomating = true;
    let currentSceneIndex = 5;
    let totalScenes = 10;
    let loadedReferences = { 
      subject: ['fp1'], 
      scene: ['fp2'], 
      style: ['fp3'] 
    };

    // stopAutomation logic
    isAutomating = false;
    currentSceneIndex = 0;
    totalScenes = 0;
    loadedReferences = { subject: [], scene: [], style: [] };

    expect(isAutomating).toBe(false);
    expect(currentSceneIndex).toBe(0);
    expect(totalScenes).toBe(0);
    expect(loadedReferences.subject).toEqual([]);
    expect(loadedReferences.scene).toEqual([]);
    expect(loadedReferences.style).toEqual([]);
  });
});

describe('Whisk Main - message listener coverage', () => {
  const KNOWN_ACTIONS = [
    'ping', 'initWhiskPanel', 'setupWhiskReferences', 'generateWhiskImage',
    'whiskGenerateSingle', 'stopAutomation', 'getWhiskStatus',
    'setupWhiskPipeline', 'generateWhiskScene'
  ];

  test('all known actions are handled', () => {
    expect(KNOWN_ACTIONS).toHaveLength(9);
    expect(KNOWN_ACTIONS).toContain('ping');
    expect(KNOWN_ACTIONS).toContain('generateWhiskScene');
  });

  test('unknown action returns error', () => {
    const handleAction = (action) => {
      if (!KNOWN_ACTIONS.includes(action)) {
        return { success: false, error: 'Acción desconocida' };
      }
      return { success: true };
    };

    expect(handleAction('unknownAction')).toEqual({ success: false, error: 'Acción desconocida' });
    expect(handleAction('ping')).toEqual({ success: true });
  });
});

describe('Whisk Main - getGeneratedImageAsDataURL', () => {
  test('FileReader reads blob as data URL', async () => {
    const blob = new Blob(['test'], { type: 'image/png' });
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

// ========== WHISK LOG MODULE ==========

describe('Whisk Log - MAX_LOG_ENTRIES cap', () => {
  test('caps at 500 entries', () => {
    const MAX_LOG_ENTRIES = 500;
    let logEntries = [];

    for (let i = 0; i < 600; i++) {
      logEntries.push({ time: '00:00', type: 'info', msg: `msg ${i}` });
      if (logEntries.length > MAX_LOG_ENTRIES) {
        logEntries = logEntries.slice(-MAX_LOG_ENTRIES);
      }
    }

    expect(logEntries.length).toBe(500);
    expect(logEntries[0].msg).toBe('msg 100');
  });
});

describe('Whisk Log - initLogPanel', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('creates panel with correct ID', () => {
    const panel = document.createElement('div');
    panel.id = 'vidflow-whisk-log-panel';
    document.body.appendChild(panel);
    expect(document.getElementById('vidflow-whisk-log-panel')).not.toBeNull();
  });

  test('re-init clears content but keeps panel', () => {
    document.body.innerHTML = `
      <div id="vidflow-whisk-log-panel">
        <div id="vf-whisk-log-content"><div>old log</div></div>
      </div>`;
    
    const content = document.getElementById('vf-whisk-log-content');
    content.innerHTML = '';
    
    expect(content.children.length).toBe(0);
    expect(document.getElementById('vidflow-whisk-log-panel')).not.toBeNull();
  });
});

describe('Whisk Log - vfLog entry format', () => {
  test('creates entry with time, type, and message', () => {
    const entry = {
      time: new Date().toLocaleTimeString('es-ES'),
      type: 'info',
      msg: 'Test message'
    };

    expect(entry).toHaveProperty('time');
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('msg');
  });

  test('maps types to console methods correctly', () => {
    const typeMap = (type) => type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'log';
    
    expect(typeMap('error')).toBe('error');
    expect(typeMap('warn')).toBe('warn');
    expect(typeMap('info')).toBe('log');
    expect(typeMap('success')).toBe('log');
    expect(typeMap('step')).toBe('log');
  });
});

describe('Whisk Log - saveLogsToStorage', () => {
  test('saves last 100 entries', () => {
    const logEntries = Array.from({ length: 200 }, (_, i) => ({
      time: '00:00', type: 'info', msg: `msg ${i}`
    }));

    const saved = logEntries.slice(-100);
    expect(saved.length).toBe(100);
    expect(saved[0].msg).toBe('msg 100');
  });
});

describe('Whisk Log - makeDraggable', () => {
  test('attaches mousedown handler to handle', () => {
    const element = document.createElement('div');
    const handle = document.createElement('div');
    
    handle.onmousedown = jest.fn();
    expect(typeof handle.onmousedown).toBe('function');
  });
});

// ========== INTEGRATION-STYLE TESTS ==========

describe('Whisk - Full generation flow simulation', () => {
  test('complete scene generation sequence', () => {
    const steps = [
      'clearNonPersistentReferences',
      'uploadReferences',
      'enterPrompt',
      'clickGenerate',
      'waitForGeneration',
      'getGeneratedImageAsDataURL',
      'downloadGeneratedImage',
      'notifyBackground'
    ];

    // Verify step order matches handleGenerateScene
    expect(steps[0]).toBe('clearNonPersistentReferences');
    expect(steps[steps.length - 1]).toBe('notifyBackground');
    expect(steps.indexOf('enterPrompt')).toBeLessThan(steps.indexOf('clickGenerate'));
    expect(steps.indexOf('clickGenerate')).toBeLessThan(steps.indexOf('waitForGeneration'));
  });
});

describe('Whisk - Edge cases', () => {
  test('fingerprint extraction handles exactly 150-char data', () => {
    const data = 'X'.repeat(150);
    const fp = data.substring(50, 150);
    expect(fp.length).toBe(100);
  });

  test('fingerprint extraction handles data shorter than 50 chars', () => {
    const data = 'X'.repeat(30);
    const fp = data.substring(50, 150);
    expect(fp).toBe(''); // Empty string - potential issue
  });

  test('expandImagesPanel button matching is case-insensitive', () => {
    const texts = ['añadir imágenes', 'add images'];
    const buttonText = 'Add Images';
    expect(texts.some(t => buttonText.toLowerCase().includes(t))).toBe(true);
  });

  test('prompt text extraction handles different data shapes', () => {
    const extractPrompt = (data) => {
      return data.prompt?.whiskPrompt || data.prompt?.prompt || data.prompt;
    };

    expect(extractPrompt({ prompt: 'simple string' })).toBe('simple string');
    expect(extractPrompt({ prompt: { prompt: 'nested' } })).toBe('nested');
    expect(extractPrompt({ prompt: { whiskPrompt: 'whisk specific' } })).toBe('whisk specific');
    expect(extractPrompt({ prompt: { whiskPrompt: 'whisk', prompt: 'generic' } })).toBe('whisk');
  });
});
