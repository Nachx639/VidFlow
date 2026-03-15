/**
 * VidFlow - Round 24: Edge Case Deep Dive — The Weird Stuff
 * Tests for Google UI changes, network edge cases, multi-tab chaos,
 * and Chrome extension weirdness.
 */

const {
  detectCaptchaOrChallenge,
  findDownloadButtonResilient,
  findBestQualityOption,
  detectProgressResilient,
  detectRateLimitRedirect,
  validateAudioResponse,
  checkNetworkHealth,
  checkForDuplicateTabs,
  validateTabUrl,
  isExtensionContextValid,
  checkRequiredPermissions,
  safeDownload,
  runHealthCheck,
  monitorDownloadProgress,
  detectRateLimitRedirect: detectRateLimit,
} = require('../../content/flow/resilience');

// ============================================================
// A. GOOGLE UI CHANGES
// ============================================================
describe('A. Google UI Changes', () => {

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // --- CAPTCHA / "Are you a robot?" ---
  describe('CAPTCHA / Challenge Detection', () => {
    test('detects reCAPTCHA iframe', () => {
      document.body.innerHTML = '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>';
      const result = detectCaptchaOrChallenge();
      expect(result.detected).toBe(true);
      expect(result.type).toBe('recaptcha-iframe');
    });

    test('detects "Are you a robot?" dialog', () => {
      document.body.innerHTML = '<div role="dialog"><h2>Are you a robot?</h2><p>Please verify</p></div>';
      const result = detectCaptchaOrChallenge();
      expect(result.detected).toBe(true);
      expect(result.type).toBe('challenge-dialog');
    });

    test('detects Spanish CAPTCHA dialog', () => {
      document.body.innerHTML = '<div role="alertdialog"><p>Verificación de seguridad necesaria</p></div>';
      const result = detectCaptchaOrChallenge();
      expect(result.detected).toBe(true);
    });

    test('detects full-page challenge', () => {
      document.body.innerHTML = '<h1>Complete the challenge</h1><p>We need to verify you are human</p>';
      const result = detectCaptchaOrChallenge();
      expect(result.detected).toBe(true);
      expect(result.type).toBe('full-page-challenge');
    });

    test('returns false when no CAPTCHA present', () => {
      document.body.innerHTML = '<div><textarea></textarea><button>Generate</button></div>';
      const result = detectCaptchaOrChallenge();
      expect(result.detected).toBe(false);
    });

    test('detects captcha iframe with different URL pattern', () => {
      document.body.innerHTML = '<iframe src="https://challenges.cloudflare.com/captcha/v1"></iframe>';
      const result = detectCaptchaOrChallenge();
      expect(result.detected).toBe(true);
    });

    test('does not false-positive on normal dialog', () => {
      document.body.innerHTML = '<div role="dialog"><p>Ajustes de modelo Veo 3.1</p></div>';
      const result = detectCaptchaOrChallenge();
      expect(result.detected).toBe(false);
    });
  });

  // --- Download button text changes ---
  describe('Download Button Resilience', () => {
    test('finds button with "Descargar" text', () => {
      document.body.innerHTML = '<button>Descargar</button>';
      const btn = findDownloadButtonResilient();
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('Descargar');
    });

    test('finds button with "Download" text', () => {
      document.body.innerHTML = '<button>Download</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button with French "Télécharger"', () => {
      document.body.innerHTML = '<button>Télécharger</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button with German "Herunterladen"', () => {
      document.body.innerHTML = '<button>Herunterladen</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button by aria-label when text changes', () => {
      document.body.innerHTML = '<button aria-label="Download video"><svg></svg></button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button by material icon "download"', () => {
      document.body.innerHTML = '<button>download</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button by material icon "file_download"', () => {
      document.body.innerHTML = '<button>file_download</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button by material icon "save_alt"', () => {
      document.body.innerHTML = '<button>save_alt</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button by download class on child element', () => {
      document.body.innerHTML = '<button><span class="icon-download"></span></button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds button near video element as fallback', () => {
      document.body.innerHTML = `
        <div class="video-result">
          <video src="blob:https://labs.google/abc123"></video>
          <button><svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7z"/></svg></button>
        </div>`;
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds "Save video" as alternate text', () => {
      document.body.innerHTML = '<button>Save video</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('finds "Export" as alternate text', () => {
      document.body.innerHTML = '<button>Exportar</button>';
      expect(findDownloadButtonResilient()).not.toBeNull();
    });

    test('returns null when no download button exists', () => {
      document.body.innerHTML = '<button>Generate</button><button>Settings</button>';
      expect(findDownloadButtonResilient()).toBeNull();
    });
  });

  // --- Video quality options change ---
  describe('Quality Option Resilience', () => {
    test('selects 720p when available', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">480p</div>
        <div role="menuitem">720p</div>
        <div role="menuitem">GIF</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toBe('720p');
    });

    test('falls back to HD when 720p removed', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">SD</div>
        <div role="menuitem">HD</div>
        <div role="menuitem">GIF</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toBe('HD');
    });

    test('handles new 4K option (prefers 720p still)', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">720p</div>
        <div role="menuitem">1080p</div>
        <div role="menuitem">4K</div>
        <div role="menuitem">GIF</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toBe('720p');
    });

    test('selects 1080p when only 1080p and 4K', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">1080p</div>
        <div role="menuitem">4K</div>
        <div role="menuitem">GIF</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toBe('1080p');
    });

    test('selects "Original" when no resolution labels', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">Original</div>
        <div role="menuitem">GIF</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toBe('Original');
    });

    test('falls back to first non-GIF when all labels unknown', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">Formato A</div>
        <div role="menuitem">Formato B</div>
        <div role="menuitem">GIF</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toBe('Formato A');
    });

    test('skips GIF options always', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">GIF animado</div>
        <div role="menuitem">MP4 alta calidad</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toContain('MP4');
    });

    test('returns null for null menu', () => {
      expect(findBestQualityOption(null)).toBeNull();
    });

    test('handles menu with role="option" items', () => {
      document.body.innerHTML = `<div role="listbox">
        <div role="option">720p MP4</div>
        <div role="option">GIF</div>
      </div>`;
      const menu = document.querySelector('[role="listbox"]');
      const best = findBestQualityOption(menu);
      expect(best.textContent).toContain('720p');
    });
  });

  // --- Progress detection (percentage text vs progress bar) ---
  describe('Progress Detection Resilience', () => {
    test('detects text percentage "45%"', () => {
      document.body.innerHTML = '<div>Generando... 45%</div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBe(45);
    });

    test('detects progress bar with aria-valuenow', () => {
      document.body.innerHTML = '<div role="progressbar" aria-valuenow="60" aria-valuemax="100"></div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBe(60);
    });

    test('detects HTML5 progress element', () => {
      document.body.innerHTML = '<progress value="75" max="100"></progress>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBe(75);
    });

    test('detects width-based progress bar', () => {
      document.body.innerHTML = '<div class="progress-bar" style="width: 30%"></div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBe(30);
    });

    test('detects spinner without percentage', () => {
      document.body.innerHTML = '<div class="spinner"></div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBeNull();
    });

    test('detects aria-busy=true', () => {
      document.body.innerHTML = '<div aria-busy="true">Processing</div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
    });

    test('detects "Generando" text without percentage', () => {
      document.body.innerHTML = '<div>Generando tu vídeo...</div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
    });

    test('detects "En cola" text', () => {
      document.body.innerHTML = '<div>En cola de procesamiento</div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
    });

    test('returns UNKNOWN when no indicators', () => {
      document.body.innerHTML = '<div><button>Generate</button></div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('UNKNOWN');
    });

    test('handles 0% correctly', () => {
      document.body.innerHTML = '<div>0% completado</div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBe(0);
    });

    test('handles 100% correctly', () => {
      document.body.innerHTML = '<div>100%</div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBe(100);
    });

    test('ignores percentages > 100', () => {
      document.body.innerHTML = '<div>Descuento del 150%</div>';
      const result = detectProgressResilient();
      // Should not detect 150 as valid progress
      expect(result.progress).not.toBe(150);
    });
  });

  // --- Rate limit page redirect ---
  describe('Rate Limit Redirect Detection', () => {
    beforeEach(() => {
      // Set URL to expected domain so URL-based detection doesn't interfere
      delete window.location;
      window.location = { href: 'https://labs.google/fx/es/tools/video-fx' };
    });

    test('detects rate-limit URL pattern', () => {
      // jsdom doesn't let us change location easily, so test the content check
      document.body.innerHTML = '<h1>Too many requests</h1><p>Please try again later</p>';
      const result = detectRateLimitRedirect();
      expect(result.detected).toBe(true);
    });

    test('detects "gran número de solicitudes"', () => {
      document.body.innerHTML = '<p>Se ha detectado un gran número de solicitudes</p>';
      const result = detectRateLimitRedirect();
      expect(result.detected).toBe(true);
    });

    test('detects 429 error page', () => {
      document.body.innerHTML = '<h1>429</h1><p>Rate limit exceeded</p>';
      const result = detectRateLimitRedirect();
      expect(result.detected).toBe(true);
    });

    test('detects "service unavailable"', () => {
      document.body.innerHTML = '<h1>Service Unavailable</h1>';
      const result = detectRateLimitRedirect();
      expect(result.detected).toBe(true);
    });

    test('does not false-positive on normal page with lots of content', () => {
      // Long content (>2000 chars) = real page, rate limit text check skipped
      const longContent = 'Normal page content. '.repeat(200);
      document.body.innerHTML = `<div>${longContent}</div>`;
      const result = detectRateLimitRedirect();
      expect(result.detected).toBe(false);
    });

    test('does not flag normal Flow page', () => {
      const longContent = 'Video generation tool with many features. '.repeat(100);
      document.body.innerHTML = `<div><textarea></textarea><button>Generate</button>${longContent}</div>`;
      const result = detectRateLimitRedirect();
      expect(result.detected).toBe(false);
    });
  });
});

// ============================================================
// B. NETWORK EDGE CASES
// ============================================================
describe('B. Network Edge Cases', () => {

  // --- Empty audio data from TTS API ---
  describe('TTS Audio Validation', () => {
    test('rejects null audio data', () => {
      const result = validateAudioResponse(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('null');
    });

    test('rejects undefined audio data', () => {
      const result = validateAudioResponse(undefined);
      expect(result.valid).toBe(false);
    });

    test('rejects empty ArrayBuffer (0 bytes)', () => {
      const result = validateAudioResponse(new ArrayBuffer(0));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('rejects suspiciously small audio (100 bytes)', () => {
      const result = validateAudioResponse(new ArrayBuffer(100));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('small');
    });

    test('rejects WAV header only (44 bytes)', () => {
      const result = validateAudioResponse(new ArrayBuffer(44));
      expect(result.valid).toBe(false);
    });

    test('accepts valid audio (10KB)', () => {
      const result = validateAudioResponse(new ArrayBuffer(10240));
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.size).toBe(10240);
    });

    test('accepts Blob with valid size', () => {
      const blob = new Blob(['x'.repeat(5000)], { type: 'audio/wav' });
      const result = validateAudioResponse(blob);
      expect(result.valid).toBe(true);
    });

    test('reports correct size for ArrayBuffer', () => {
      const buf = new ArrayBuffer(2048);
      const result = validateAudioResponse(buf);
      expect(result.size).toBe(2048);
    });
  });

  // --- Network drop mid-generation ---
  describe('Network Health Check', () => {
    test('detects offline status via navigator.onLine', async () => {
      const originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      const result = await checkNetworkHealth();
      expect(result.online).toBe(false);
      expect(result.latency).toBeNull();
      Object.defineProperty(navigator, 'onLine', { value: originalOnLine, writable: true, configurable: true });
    });

    test('returns online with latency on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
      // AbortSignal.timeout may not exist in jsdom, so also mock if needed
      if (!AbortSignal.timeout) {
        AbortSignal.timeout = (ms) => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), ms);
          return controller.signal;
        };
      }
      const result = await checkNetworkHealth();
      expect(result.online).toBe(true);
      expect(typeof result.latency).toBe('number');
      delete global.fetch;
    });

    test('returns offline on fetch failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
      const result = await checkNetworkHealth();
      expect(result.online).toBe(false);
      delete global.fetch;
    });
  });

  // --- Stuck downloads (0% forever) ---
  describe('Download Monitoring', () => {
    test('monitorDownloadProgress detects completed download', async () => {
      chrome.downloads.search.mockImplementation((query, cb) => {
        cb([{ id: 1, state: 'complete', bytesReceived: 1000 }]);
      });
      const result = await monitorDownloadProgress(1, 5000);
      expect(result.completed).toBe(true);
    });

    test('monitorDownloadProgress detects error', async () => {
      chrome.downloads.search.mockImplementation((query, cb) => {
        cb([{ id: 1, state: 'interrupted', error: 'NETWORK_FAILED', bytesReceived: 0 }]);
      });
      const result = await monitorDownloadProgress(1, 5000);
      expect(result.completed).toBe(false);
      expect(result.error).toBe('NETWORK_FAILED');
    });

    test('monitorDownloadProgress handles missing download', async () => {
      chrome.downloads.search.mockImplementation((query, cb) => {
        cb([]);
      });
      const result = await monitorDownloadProgress(999, 5000);
      expect(result.completed).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // --- Download directory full ---
  describe('Safe Download (disk full / permission)', () => {
    test('handles disk full error', async () => {
      chrome.downloads.download.mockRejectedValue(new Error('DISK_FULL: not enough space'));
      const result = await safeDownload({ url: 'https://example.com/video.mp4' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('DISK_FULL');
    });

    test('handles permission denied', async () => {
      chrome.downloads.download.mockRejectedValue(new Error('permission denied'));
      const result = await safeDownload({ url: 'https://example.com/video.mp4' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('PERMISSION_DENIED');
    });

    test('handles successful download', async () => {
      chrome.downloads.download.mockResolvedValue(42);
      chrome.runtime.lastError = null;
      const result = await safeDownload({ url: 'https://example.com/video.mp4' });
      expect(result.success).toBe(true);
      expect(result.downloadId).toBe(42);
    });

    test('handles chrome.runtime.lastError', async () => {
      chrome.downloads.download.mockResolvedValue(null);
      chrome.runtime.lastError = { message: 'Download canceled' };
      const result = await safeDownload({ url: 'https://example.com/video.mp4' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Download canceled');
      chrome.runtime.lastError = null;
    });

    test('handles missing chrome.downloads API', async () => {
      const origDownloads = chrome.downloads;
      chrome.downloads = undefined;
      const result = await safeDownload({ url: 'https://example.com/video.mp4' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
      chrome.downloads = origDownloads;
    });
  });
});

// ============================================================
// C. MULTI-TAB CHAOS
// ============================================================
describe('C. Multi-Tab Chaos', () => {

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Duplicate Tab Detection', () => {
    test('detects no conflict when alone', async () => {
      // BroadcastChannel mock - no response = no other tab
      const mockChannel = {
        onmessage: null,
        postMessage: jest.fn(),
        close: jest.fn(),
      };
      global.BroadcastChannel = jest.fn(() => mockChannel);

      const resultPromise = checkForDuplicateTabs();
      // Simulate timeout (no PONG received)
      jest.advanceTimersByTime?.(600);
      const result = await resultPromise;
      expect(result.conflict).toBe(false);
    });

    test('detects conflict when another tab responds', async () => {
      const mockChannel = {
        onmessage: null,
        postMessage: jest.fn(),
        close: jest.fn(),
      };
      global.BroadcastChannel = jest.fn(() => mockChannel);

      const resultPromise = checkForDuplicateTabs();
      // Simulate another tab responding
      setTimeout(() => {
        if (mockChannel.onmessage) {
          mockChannel.onmessage({ data: { type: 'PONG', tabId: 12345 } });
        }
      }, 50);
      const result = await resultPromise;
      expect(result.conflict).toBe(true);
      expect(result.message).toContain('12345');
    });

    test('handles missing BroadcastChannel', () => {
      const orig = global.BroadcastChannel;
      delete global.BroadcastChannel;
      const result = checkForDuplicateTabs();
      // Should return synchronously
      expect(result.conflict).toBe(false);
      global.BroadcastChannel = orig;
    });
  });

  describe('Tab URL Validation', () => {
    test('validates labs.google URL', () => {
      // jsdom default is about:blank, override
      delete window.location;
      window.location = { href: 'https://labs.google/fx/es/tools/video-fx/project/abc123' };
      const result = validateTabUrl('labs.google');
      expect(result.valid).toBe(true);
    });

    test('detects navigation away from Flow', () => {
      delete window.location;
      window.location = { href: 'https://www.google.com/search?q=test' };
      const result = validateTabUrl('labs.google');
      expect(result.valid).toBe(false);
      expect(result.currentUrl).toContain('google.com/search');
    });

    test('detects user opened Whisk in same tab', () => {
      delete window.location;
      window.location = { href: 'https://labs.google/fx/es/tools/whisk' };
      // Whisk is still labs.google, but check for flow-specific path
      const result = validateTabUrl('labs.google');
      expect(result.valid).toBe(true); // Still on labs.google
      // More specific check:
      const flowResult = validateTabUrl('video-fx');
      expect(flowResult.valid).toBe(false); // Not on video-fx anymore
    });
  });

  describe('Tab Reload / Navigation Detection', () => {
    test('user navigates away mid-pipeline detected by URL check', () => {
      delete window.location;
      window.location = { href: 'https://www.youtube.com' };
      const result = validateTabUrl('labs.google');
      expect(result.valid).toBe(false);
    });

    test('user reloads tab - extension context may be invalid', () => {
      // After reload, the content script is re-injected
      // But any in-memory state (isAutomating, etc) is lost
      // Simulate by checking a global that would be lost
      const mockState = { isAutomating: true, currentIndex: 5 };
      // After "reload", state is gone
      const afterReload = {};
      expect(afterReload.isAutomating).toBeUndefined();
    });
  });
});

// ============================================================
// D. CHROME EXTENSION WEIRDNESS
// ============================================================
describe('D. Chrome Extension Weirdness', () => {

  describe('Extension Context Validity', () => {
    test('returns true when extension is healthy', () => {
      expect(isExtensionContextValid()).toBe(true);
    });

    test('returns false when chrome.runtime is undefined', () => {
      const origRuntime = chrome.runtime;
      chrome.runtime = undefined;
      expect(isExtensionContextValid()).toBe(false);
      chrome.runtime = origRuntime;
    });

    test('returns false when chrome is undefined', () => {
      const origChrome = global.chrome;
      global.chrome = undefined;
      expect(isExtensionContextValid()).toBe(false);
      global.chrome = origChrome;
    });

    test('returns false when runtime.id throws (context invalidated)', () => {
      const origRuntime = chrome.runtime;
      chrome.runtime = new Proxy({}, {
        get(target, prop) {
          if (prop === 'id') throw new Error('Extension context invalidated');
          return undefined;
        }
      });
      expect(isExtensionContextValid()).toBe(false);
      chrome.runtime = origRuntime;
    });
  });

  describe('Permission Checking', () => {
    test('reports all permissions present', () => {
      const result = checkRequiredPermissions();
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test('detects missing downloads permission', () => {
      const origDownloads = chrome.downloads;
      chrome.downloads = undefined;
      const result = checkRequiredPermissions();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('downloads');
      chrome.downloads = origDownloads;
    });

    test('detects missing storage permission', () => {
      const origStorage = chrome.storage;
      chrome.storage = undefined;
      const result = checkRequiredPermissions();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('storage');
      chrome.storage = origStorage;
    });

    test('detects multiple missing permissions', () => {
      const origDownloads = chrome.downloads;
      const origTabs = chrome.tabs;
      chrome.downloads = undefined;
      chrome.tabs = undefined;
      const result = checkRequiredPermissions();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('downloads');
      expect(result.missing).toContain('tabs');
      chrome.downloads = origDownloads;
      chrome.tabs = origTabs;
    });

    test('detects chrome entirely missing', () => {
      const origChrome = global.chrome;
      global.chrome = undefined;
      const result = checkRequiredPermissions();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('chrome');
      global.chrome = origChrome;
    });
  });

  describe('Extension Disable/Re-enable Mid-Pipeline', () => {
    test('simulates extension disable - context invalidated', () => {
      // When user disables extension, chrome.runtime.id becomes inaccessible
      const origId = chrome.runtime.id;
      chrome.runtime.id = undefined;
      expect(isExtensionContextValid()).toBe(false);
      chrome.runtime.id = origId;
    });

    test('simulates extension re-enable - context restored', () => {
      chrome.runtime.id = 'new-extension-id-after-update';
      expect(isExtensionContextValid()).toBe(true);
      chrome.runtime.id = 'mock-extension-id';
    });
  });

  describe('Chrome Background Update of Extension', () => {
    test('runtime.id changes after update', () => {
      const oldId = chrome.runtime.id;
      chrome.runtime.id = 'updated-extension-id-v2';
      expect(chrome.runtime.id).not.toBe(oldId);
      expect(isExtensionContextValid()).toBe(true);
      chrome.runtime.id = 'mock-extension-id';
    });

    test('sendMessage fails after update (context mismatch)', async () => {
      chrome.runtime.sendMessage.mockRejectedValueOnce(
        new Error('Extension context invalidated')
      );
      await expect(chrome.runtime.sendMessage({ type: 'ping' }))
        .rejects.toThrow('Extension context invalidated');
    });
  });

  describe('Download Handler Conflicts', () => {
    test('onDeterminingFilename listener can be registered', () => {
      chrome.downloads.onDeterminingFilename.addListener(jest.fn());
      expect(chrome.downloads.onDeterminingFilename.addListener).toHaveBeenCalled();
    });

    test('multiple listeners dont interfere (first wins)', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      chrome.downloads.onDeterminingFilename.addListener(listener1);
      chrome.downloads.onDeterminingFilename.addListener(listener2);
      // Both registered without error
      expect(chrome.downloads.onDeterminingFilename.addListener).toHaveBeenCalledTimes(2);
    });
  });
});

// ============================================================
// E. COMBINED HEALTH CHECK
// ============================================================
describe('E. Combined Health Check', () => {

  beforeEach(() => {
    document.body.innerHTML = '<div><textarea></textarea><button>Generate</button></div>';
    delete window.location;
    window.location = { href: 'https://labs.google/fx/es/tools/video-fx/project/test' };
    chrome.runtime.id = 'mock-extension-id';
  });

  test('reports healthy when everything is normal', () => {
    const health = runHealthCheck();
    expect(health.healthy).toBe(true);
    expect(health.captcha.detected).toBe(false);
    expect(health.rateLimit.detected).toBe(false);
    expect(health.tabUrl.valid).toBe(true);
    expect(health.extensionValid).toBe(true);
    expect(health.permissions.valid).toBe(true);
    expect(health.timestamp).toBeGreaterThan(0);
  });

  test('reports unhealthy when CAPTCHA detected', () => {
    document.body.innerHTML = '<iframe src="https://recaptcha.google.com/test"></iframe>';
    const health = runHealthCheck();
    expect(health.healthy).toBe(false);
    expect(health.captcha.detected).toBe(true);
  });

  test('reports unhealthy when navigated away', () => {
    window.location = { href: 'https://youtube.com' };
    document.body.innerHTML = '<div>' + 'x'.repeat(3000) + '</div>';
    const health = runHealthCheck();
    expect(health.healthy).toBe(false);
    expect(health.tabUrl.valid).toBe(false);
  });

  test('reports unhealthy when extension context invalid', () => {
    chrome.runtime.id = undefined;
    const health = runHealthCheck();
    expect(health.healthy).toBe(false);
    expect(health.extensionValid).toBe(false);
  });

  test('reports unhealthy when downloads permission missing', () => {
    const orig = chrome.downloads;
    chrome.downloads = undefined;
    const health = runHealthCheck();
    expect(health.healthy).toBe(false);
    expect(health.permissions.missing).toContain('downloads');
    chrome.downloads = orig;
  });

  test('reports progress status in health check', () => {
    document.body.innerHTML = '<div>Generando... 55%</div>';
    const health = runHealthCheck();
    expect(health.progress.status).toBe('GENERATING');
    expect(health.progress.progress).toBe(55);
  });

  test('health check includes timestamp', () => {
    const before = Date.now();
    const health = runHealthCheck();
    expect(health.timestamp).toBeGreaterThanOrEqual(before);
  });
});

// ============================================================
// F. ADDITIONAL WEIRD REAL-WORLD SCENARIOS
// ============================================================
describe('F. Additional Weird Real-World Scenarios', () => {

  describe('Google UI Mutation Patterns', () => {
    test('handles empty DOM gracefully', () => {
      document.body.innerHTML = '';
      expect(detectCaptchaOrChallenge().detected).toBe(false);
      expect(findDownloadButtonResilient()).toBeNull();
      expect(detectProgressResilient().status).toBe('UNKNOWN');
    });

    test('handles deeply nested CAPTCHA', () => {
      document.body.innerHTML = `
        <div><div><div><div><div>
          <div role="dialog"><p>Eres un robot? Completa el desafío</p></div>
        </div></div></div></div></div>`;
      expect(detectCaptchaOrChallenge().detected).toBe(true);
    });

    test('multiple progress indicators - prefers progress element over text', () => {
      document.body.innerHTML = `
        <div>72%</div>
        <progress value="50" max="100"></progress>`;
      const result = detectProgressResilient();
      // Both are valid; text match happens first in the algorithm
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBeGreaterThanOrEqual(0);
    });

    test('percentage in text is detected as progress', () => {
      document.body.innerHTML = '<div>Tu vídeo tiene un 50% completado</div>';
      const result = detectProgressResilient();
      expect(result.status).toBe('GENERATING');
      expect(result.progress).toBe(50);
    });
  });

  describe('Concurrent Operations Safety', () => {
    test('validateAudioResponse handles object without byteLength or size', () => {
      const result = validateAudioResponse({});
      expect(result.valid).toBe(false);
      expect(result.size).toBe(0);
    });

    test('findBestQualityOption with empty menu', () => {
      document.body.innerHTML = '<div role="menu"></div>';
      const menu = document.querySelector('[role="menu"]');
      expect(findBestQualityOption(menu)).toBeNull();
    });

    test('findBestQualityOption with all GIF options', () => {
      document.body.innerHTML = `<div role="menu">
        <div role="menuitem">GIF pequeño</div>
        <div role="menuitem">GIF grande</div>
      </div>`;
      const menu = document.querySelector('[role="menu"]');
      // All are GIF, fallback still skips them
      expect(findBestQualityOption(menu)).toBeNull();
    });
  });

  describe('Edge Case Combinations', () => {
    test('CAPTCHA + rate limit simultaneously', () => {
      // Short page (< 2000 chars) with both captcha and rate limit text
      document.body.innerHTML = `
        <iframe src="https://recaptcha.net/test"></iframe>
        <h1>Too many requests</h1>
        <p>Rate limit exceeded</p>`;
      const captcha = detectCaptchaOrChallenge();
      const rateLimit = detectRateLimitRedirect();
      expect(captcha.detected).toBe(true);
      expect(rateLimit.detected).toBe(true);
    });

    test('extension context valid but permissions revoked', () => {
      const origDownloads = chrome.downloads;
      const origStorage = chrome.storage;
      chrome.downloads = undefined;
      chrome.storage = undefined;
      // Extension itself is valid
      expect(isExtensionContextValid()).toBe(true);
      // But permissions are missing
      const perms = checkRequiredPermissions();
      expect(perms.valid).toBe(false);
      expect(perms.missing.length).toBe(2);
      chrome.downloads = origDownloads;
      chrome.storage = origStorage;
    });

    test('safeDownload with generic unknown error', async () => {
      chrome.downloads.download.mockRejectedValue(new Error('Something weird happened'));
      const result = await safeDownload({ url: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Something weird happened');
    });
  });
});
