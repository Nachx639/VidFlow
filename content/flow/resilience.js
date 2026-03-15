/**
 * VidFlow - Resilience Module
 * Handles Google UI changes, network issues, multi-tab chaos, and extension weirdness
 */

// ========== A. GOOGLE UI CHANGE DETECTION ==========

/**
 * Detects CAPTCHA or "Are you a robot?" dialogs
 * @returns {Object} {detected: boolean, type: string|null, element: Element|null}
 */
function detectCaptchaOrChallenge() {
  const captchaPatterns = [
    'captcha', 'recaptcha', 'are you a robot', 'eres un robot',
    'verificación de seguridad', 'security check', 'human verification',
    'verificar que no eres un robot', 'prove you are human',
    'complete the challenge', 'completa el desafío'
  ];

  // Check for reCAPTCHA iframe
  const recaptchaIframe = document.querySelector('iframe[src*="recaptcha"], iframe[src*="captcha"]');
  if (recaptchaIframe) {
    return { detected: true, type: 'recaptcha-iframe', element: recaptchaIframe };
  }

  // Check for challenge dialogs
  const dialogs = document.querySelectorAll('dialog, [role="dialog"], [role="alertdialog"]');
  for (const dialog of dialogs) {
    const text = dialog.textContent?.toLowerCase() || '';
    for (const pattern of captchaPatterns) {
      if (text.includes(pattern)) {
        return { detected: true, type: 'challenge-dialog', element: dialog };
      }
    }
  }

  // Check for full-page challenge
  const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
  for (const pattern of captchaPatterns) {
    if (bodyText.includes(pattern)) {
      // Verify it's prominent (not just a tiny mention)
      const allElements = document.querySelectorAll('h1, h2, h3, [role="heading"], .title, .header');
      for (const el of allElements) {
        if (el.textContent?.toLowerCase().includes(pattern)) {
          return { detected: true, type: 'full-page-challenge', element: el };
        }
      }
    }
  }

  return { detected: false, type: null, element: null };
}

/**
 * Detects download button using flexible multi-language patterns
 * Resilient to Google changing button text from "Descargar" to anything else
 * @returns {Element|null}
 */
function findDownloadButtonResilient() {
  const downloadTexts = [
    'descargar', 'download', 'télécharger', 'herunterladen', 'baixar',
    'scarica', 'ダウンロード', '下载', 'save video', 'guardar vídeo',
    'export', 'exportar'
  ];

  // Method 1: aria-label
  const ariaButtons = document.querySelectorAll('button[aria-label]');
  for (const btn of ariaButtons) {
    const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
    for (const text of downloadTexts) {
      if (label.includes(text)) return btn;
    }
  }

  // Method 2: button text
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const btnText = btn.textContent?.trim().toLowerCase() || '';
    for (const text of downloadTexts) {
      if (btnText.includes(text)) return btn;
    }
  }

  // Method 3: icon-based detection (download icon patterns)
  for (const btn of allButtons) {
    const hasDownloadIcon = btn.querySelector('[class*="download"], [data-icon*="download"]');
    const svgPath = btn.querySelector('svg path');
    const iconText = btn.textContent?.trim() || '';

    // Material Icons: "download", "file_download", "save_alt"
    if (hasDownloadIcon ||
        iconText === 'download' || iconText === 'file_download' ||
        iconText === 'save_alt' || iconText === 'get_app') {
      return btn;
    }
  }

  // Method 4: button near video element with download-like attributes
  const videoEl = document.querySelector('video[src]');
  if (videoEl) {
    const container = videoEl.closest('[class*="result"], [class*="video"], [class*="player"]') || videoEl.parentElement;
    if (container) {
      const nearbyButtons = container.querySelectorAll('button');
      for (const btn of nearbyButtons) {
        // Heuristic: button with icon only (no long text) near video
        if (btn.textContent?.trim().length < 20 && btn.querySelector('svg, [class*="icon"]')) {
          return btn;
        }
      }
    }
  }

  return null;
}

/**
 * Detects video quality options resilient to UI changes
 * Handles missing 720p, new 4K option, changed labels
 * @param {Element} menu - The quality menu element
 * @returns {Element|null} Best quality option to click
 */
function findBestQualityOption(menu) {
  if (!menu) return null;

  const items = menu.querySelectorAll('[role="menuitem"], [role="option"], li, button');
  const qualityPreference = [
    { pattern: '720p', priority: 1 },
    { pattern: 'hd', priority: 2 },
    { pattern: '1080p', priority: 3 },
    { pattern: '4k', priority: 4 },
    { pattern: '2160p', priority: 4 },
    { pattern: 'original', priority: 5 },
    { pattern: 'alta', priority: 6 },
    { pattern: 'high', priority: 6 },
    { pattern: 'media', priority: 7 },
    { pattern: 'medium', priority: 7 },
    { pattern: 'mp4', priority: 8 },
  ];

  let bestItem = null;
  let bestPriority = Infinity;

  for (const item of items) {
    const text = item.textContent?.toLowerCase() || '';
    // Skip GIF options
    if (text.includes('gif')) continue;

    for (const q of qualityPreference) {
      if (text.includes(q.pattern) && q.priority < bestPriority) {
        bestItem = item;
        bestPriority = q.priority;
      }
    }
  }

  // Fallback: first non-GIF option
  if (!bestItem) {
    for (const item of items) {
      const text = item.textContent?.toLowerCase() || '';
      if (!text.includes('gif')) {
        bestItem = item;
        break;
      }
    }
  }

  return bestItem;
}

/**
 * Detects progress using multiple strategies
 * Resilient to Google changing from text percentage to progress bar
 * @returns {Object} {status: string, progress: number|null}
 */
function detectProgressResilient() {
  // Strategy 1: Text percentage (current behavior)
  const allText = document.body?.innerText || document.body?.textContent || '';
  const percentMatch = allText.match(/\b(\d{1,3})\s*%/);
  if (percentMatch) {
    const pct = parseInt(percentMatch[1]);
    if (pct >= 0 && pct <= 100) {
      return { status: 'GENERATING', progress: pct };
    }
  }

  // Strategy 2: Progress bar elements
  const progressBars = document.querySelectorAll(
    'progress, [role="progressbar"], [class*="progress-bar"], ' +
    '[class*="progressBar"], [class*="progress_bar"]'
  );
  for (const bar of progressBars) {
    const value = bar.getAttribute('aria-valuenow') || bar.getAttribute('value') || bar.value;
    const max = bar.getAttribute('aria-valuemax') || bar.getAttribute('max') || bar.max || 100;
    if (value !== null && value !== undefined) {
      const pct = Math.round((parseFloat(value) / parseFloat(max)) * 100);
      if (pct >= 0 && pct <= 100) {
        return { status: 'GENERATING', progress: pct };
      }
    }

    // Check width-based progress (inline style)
    const style = bar.getAttribute('style') || '';
    const widthMatch = style.match(/width:\s*(\d+(?:\.\d+)?)\s*%/);
    if (widthMatch) {
      return { status: 'GENERATING', progress: Math.round(parseFloat(widthMatch[1])) };
    }
  }

  // Strategy 3: Animated/spinner indicators (no percentage)
  const spinners = document.querySelectorAll(
    '[class*="spinner"], [class*="loading"], [aria-busy="true"], ' +
    '[class*="generating"], [class*="pending"]'
  );
  if (spinners.length > 0) {
    return { status: 'GENERATING', progress: null };
  }

  // Strategy 4: Text-based status
  const statusTexts = {
    'generando': 'GENERATING',
    'generating': 'GENERATING',
    'en cola': 'GENERATING',
    'in queue': 'GENERATING',
    'procesando': 'GENERATING',
    'processing': 'GENERATING',
  };
  const bodyLower = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
  for (const [text, status] of Object.entries(statusTexts)) {
    if (bodyLower.includes(text)) {
      return { status, progress: null };
    }
  }

  return { status: 'UNKNOWN', progress: null };
}

/**
 * Detects rate limit page redirects
 * @returns {Object} {detected: boolean, message: string|null}
 */
function detectRateLimitRedirect() {
  const url = typeof window !== 'undefined' ? window.location?.href || '' : '';

  // Check URL patterns for rate limit pages
  const rateLimitUrlPatterns = [
    'rate-limit', 'ratelimit', 'too-many-requests', 'quota-exceeded',
    'error/429', '/429', 'blocked', 'temporarily-unavailable'
  ];

  for (const pattern of rateLimitUrlPatterns) {
    if (url.toLowerCase().includes(pattern)) {
      return { detected: true, message: `Rate limit redirect detected: ${url}` };
    }
  }

  // Check if we're no longer on a Google Labs page
  const expectedDomains = ['labs.google', 'aistudio.google'];
  const isExpectedDomain = expectedDomains.some(d => url.includes(d));

  if (url && !isExpectedDomain && !url.includes('chrome-extension://') && !url.startsWith('about:')) {
    return { detected: true, message: `Unexpected redirect to: ${url}` };
  }

  // Check page content for rate limit messages
  const rateLimitTexts = [
    'too many requests', 'rate limit exceeded', 'quota exceeded',
    'demasiadas solicitudes', 'límite de tasa', 'try again later',
    'inténtalo más tarde', 'temporarily unavailable', 'service unavailable',
    '429', 'gran número de solicitudes'
  ];

  const pageText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
  // Only flag if the page is mostly error (short content = error page)
  if (pageText.length < 2000) {
    for (const text of rateLimitTexts) {
      if (pageText.includes(text)) {
        return { detected: true, message: text };
      }
    }
  }

  return { detected: false, message: null };
}

// ========== B. NETWORK RESILIENCE ==========

/**
 * Monitors download progress and detects stuck downloads
 * @param {number} downloadId - Chrome download ID
 * @param {number} timeoutMs - Time before considering download stuck
 * @returns {Promise<Object>} {completed: boolean, error: string|null}
 */
async function monitorDownloadProgress(downloadId, timeoutMs = 60000) {
  const startTime = Date.now();
  let lastBytesReceived = 0;
  let lastProgressTime = startTime;
  const STUCK_THRESHOLD = 30000; // 30s with no progress = stuck

  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (typeof chrome === 'undefined' || !chrome.downloads) {
        clearInterval(checkInterval);
        resolve({ completed: false, error: 'chrome.downloads not available' });
        return;
      }

      chrome.downloads.search({ id: downloadId }, (downloads) => {
        if (!downloads || downloads.length === 0) {
          clearInterval(checkInterval);
          resolve({ completed: false, error: 'Download not found' });
          return;
        }

        const dl = downloads[0];

        if (dl.state === 'complete') {
          clearInterval(checkInterval);
          resolve({ completed: true, error: null });
          return;
        }

        if (dl.error) {
          clearInterval(checkInterval);
          resolve({ completed: false, error: dl.error });
          return;
        }

        // Check for stuck download
        const bytesReceived = dl.bytesReceived || 0;
        if (bytesReceived > lastBytesReceived) {
          lastBytesReceived = bytesReceived;
          lastProgressTime = Date.now();
        } else if (Date.now() - lastProgressTime > STUCK_THRESHOLD) {
          clearInterval(checkInterval);
          resolve({ completed: false, error: `Download stuck at ${bytesReceived} bytes for ${STUCK_THRESHOLD / 1000}s` });
          return;
        }

        // Overall timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          resolve({ completed: false, error: `Download timeout after ${timeoutMs / 1000}s` });
        }
      });
    }, 2000);
  });
}

/**
 * Validates TTS audio response
 * @param {ArrayBuffer|Blob} audioData - The audio data from API
 * @returns {Object} {valid: boolean, error: string|null, size: number}
 */
function validateAudioResponse(audioData) {
  if (!audioData) {
    return { valid: false, error: 'Audio data is null/undefined', size: 0 };
  }

  const size = audioData.byteLength || audioData.size || 0;

  if (size === 0) {
    return { valid: false, error: 'Audio data is empty (0 bytes)', size: 0 };
  }

  // Minimum viable audio: WAV header alone is 44 bytes, any real audio should be > 1KB
  if (size < 1024) {
    return { valid: false, error: `Audio data suspiciously small (${size} bytes)`, size };
  }

  return { valid: true, error: null, size };
}

/**
 * Checks network connectivity
 * @returns {Promise<Object>} {online: boolean, latency: number|null}
 */
async function checkNetworkHealth() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { online: false, latency: null };
  }

  try {
    const start = Date.now();
    const response = await fetch('https://labs.google/favicon.ico', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-cache',
      signal: AbortSignal.timeout(5000)
    });
    return { online: true, latency: Date.now() - start };
  } catch (e) {
    return { online: false, latency: null };
  }
}

// ========== C. MULTI-TAB PROTECTION ==========

/**
 * Checks if another VidFlow tab is already running
 * Uses BroadcastChannel for cross-tab communication
 * @returns {Promise<Object>} {conflict: boolean, message: string|null}
 */
function checkForDuplicateTabs() {
  if (typeof BroadcastChannel === 'undefined') {
    return { conflict: false, message: 'BroadcastChannel not available' };
  }

  return new Promise((resolve) => {
    const channel = new BroadcastChannel('vidflow-tab-sync');
    let responded = false;

    channel.onmessage = (event) => {
      if (event.data.type === 'PONG') {
        responded = true;
        channel.close();
        resolve({ conflict: true, message: `Another VidFlow tab is active (id: ${event.data.tabId})` });
      }
    };

    channel.postMessage({ type: 'PING', tabId: Date.now() });

    setTimeout(() => {
      if (!responded) {
        channel.close();
        resolve({ conflict: false, message: null });
      }
    }, 500);
  });
}

/**
 * Validates that the current tab is still on the expected URL
 * @param {string} expectedDomain - Expected domain pattern
 * @returns {Object} {valid: boolean, currentUrl: string}
 */
function validateTabUrl(expectedDomain = 'labs.google') {
  const currentUrl = typeof window !== 'undefined' ? window.location?.href || '' : '';
  const valid = currentUrl.includes(expectedDomain);
  return { valid, currentUrl };
}

// ========== D. EXTENSION HEALTH CHECKS ==========

/**
 * Checks if the extension context is still valid
 * (Detects if extension was disabled/updated mid-operation)
 * @returns {boolean}
 */
function isExtensionContextValid() {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime) return false;
    // Accessing runtime.id throws if context is invalidated
    const id = chrome.runtime.id;
    return !!id;
  } catch (e) {
    return false;
  }
}

/**
 * Checks if required permissions are still available
 * @returns {Object} {valid: boolean, missing: string[]}
 */
function checkRequiredPermissions() {
  const missing = [];

  if (typeof chrome === 'undefined') {
    return { valid: false, missing: ['chrome'] };
  }

  if (!chrome.downloads) missing.push('downloads');
  if (!chrome.storage) missing.push('storage');
  if (!chrome.tabs) missing.push('tabs');
  if (!chrome.runtime) missing.push('runtime');

  return { valid: missing.length === 0, missing };
}

/**
 * Wraps a chrome.downloads.download call with error handling for
 * disk full, permission revoked, etc.
 * @param {Object} options - chrome.downloads.download options
 * @returns {Promise<Object>} {success: boolean, downloadId: number|null, error: string|null}
 */
async function safeDownload(options) {
  try {
    if (!chrome?.downloads?.download) {
      return { success: false, downloadId: null, error: 'chrome.downloads.download not available' };
    }

    const downloadId = await chrome.downloads.download(options);

    if (chrome.runtime.lastError) {
      return { success: false, downloadId: null, error: chrome.runtime.lastError.message };
    }

    return { success: true, downloadId, error: null };
  } catch (err) {
    const errorMsg = err.message || String(err);

    // Detect disk full
    if (errorMsg.includes('DISK_FULL') || errorMsg.includes('disk full') ||
        errorMsg.includes('no space') || errorMsg.includes('not enough space')) {
      return { success: false, downloadId: null, error: 'DISK_FULL' };
    }

    // Detect permission errors
    if (errorMsg.includes('permission') || errorMsg.includes('not allowed')) {
      return { success: false, downloadId: null, error: 'PERMISSION_DENIED' };
    }

    return { success: false, downloadId: null, error: errorMsg };
  }
}

// ========== COMBINED HEALTH CHECK ==========

/**
 * Runs all health checks and returns a comprehensive status
 * @returns {Object}
 */
function runHealthCheck() {
  const captcha = detectCaptchaOrChallenge();
  const rateLimit = detectRateLimitRedirect();
  const tabUrl = validateTabUrl();
  const extensionValid = isExtensionContextValid();
  const permissions = checkRequiredPermissions();
  const progress = detectProgressResilient();

  return {
    healthy: !captcha.detected && !rateLimit.detected && tabUrl.valid && extensionValid && permissions.valid,
    captcha,
    rateLimit,
    tabUrl,
    extensionValid,
    permissions,
    progress,
    timestamp: Date.now()
  };
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectCaptchaOrChallenge,
    findDownloadButtonResilient,
    findBestQualityOption,
    detectProgressResilient,
    detectRateLimitRedirect,
    monitorDownloadProgress,
    validateAudioResponse,
    checkNetworkHealth,
    checkForDuplicateTabs,
    validateTabUrl,
    isExtensionContextValid,
    checkRequiredPermissions,
    safeDownload,
    runHealthCheck,
  };
}

console.log('VidFlow: resilience.js cargado');
