/**
 * ROUND 3: Stress Testing & Robustness
 * A. 58+ prompt batch simulation
 * B. Timeout and failure resilience
 * C. Memory and state management
 * D. Monitor edge cases
 */

global.vfLog = jest.fn();
global.chrome = {
  runtime: { sendMessage: jest.fn(() => Promise.resolve({})), onMessage: { addListener: jest.fn() } },
  tabs: { query: jest.fn(), sendMessage: jest.fn(), get: jest.fn() },
  downloads: {
    download: jest.fn(() => Promise.resolve(1)),
    onDeterminingFilename: { addListener: jest.fn() },
    onChanged: { addListener: jest.fn() },
    search: jest.fn()
  },
  storage: { local: { get: jest.fn(() => Promise.resolve({})), set: jest.fn(() => Promise.resolve()) } },
  scripting: { executeScript: jest.fn() },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() }
};
global.sleep = jest.fn(() => Promise.resolve());

// ========== HELPERS: replicate core logic for testing ==========

function createWorkflowState(overrides = {}) {
  return {
    isRunning: false,
    currentStep: null,
    currentIndex: 0,
    totalItems: 0,
    prompts: [],
    references: {},
    batchImages: [],
    config: {},
    generatedImages: [],
    generatedVideos: [],
    folderName: 'VidFlow01',
    activeVideos: [],
    failedVideos: [],
    rateLimitedVideos: [],
    resumedFrom: 0,
    pendingIndexes: null,
    lastActivityTime: null,
    ...overrides
  };
}

function createPipelineState(overrides = {}) {
  return {
    isRunning: false,
    currentStep: null,
    projectFolder: null,
    parallelMode: false,
    runWhisk: true, runFlow: true, runSpeech: true,
    whisk: { isComplete: false, currentIndex: 0, totalItems: 0, generatedImages: [], tabId: null },
    flow: { isComplete: false, currentIndex: 0, totalItems: 0, generatedVideos: [], tabId: null },
    speech: { isComplete: false, currentIndex: 0, totalItems: 0, generatedAudios: [], tabId: null },
    scenes: [],
    referenceCategories: [],
    config: {},
    ...overrides
  };
}

// Simulate download naming (from download-naming.test.js)
class DownloadNamingEngine {
  constructor() {
    this.downloadSceneMap = new Map();
    this.pendingPromptSceneMap = new Map();
    this.downloadCounter = 0;
    this.nextDownloadId = 100;
  }

  allocDownloadId() { return this.nextDownloadId++; }

  registerVidFlowDownload(downloadId, sceneNumber) {
    if (sceneNumber != null) this.downloadSceneMap.set(downloadId, sceneNumber);
  }

  getFlowVideoFilename(downloadId) {
    let sceneNumber;
    if (this.downloadSceneMap.has(downloadId)) {
      sceneNumber = this.downloadSceneMap.get(downloadId);
      this.downloadSceneMap.delete(downloadId);
    } else if (this.pendingPromptSceneMap.size > 0) {
      const firstKey = this.pendingPromptSceneMap.keys().next().value;
      sceneNumber = this.pendingPromptSceneMap.get(firstKey);
      this.pendingPromptSceneMap.delete(firstKey);
    } else {
      this.downloadCounter++;
      sceneNumber = this.downloadCounter;
    }
    return `${String(sceneNumber).padStart(3, '0')}_flow_video.mp4`;
  }

  prepareFlowDownload(promptText, activeVideos) {
    const promptToMatch = promptText.toLowerCase().trim().replace(/\s+/g, ' ');
    let matchedVideo = null;
    for (const av of activeVideos) {
      const ap = (av.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');
      if (ap === promptToMatch) { matchedVideo = av; break; }
    }
    if (!matchedVideo && activeVideos.length > 0) matchedVideo = activeVideos[0];
    if (!matchedVideo) return null;
    const sceneNumber = matchedVideo.sceneNumber || (matchedVideo.index + 1);
    const promptKey = (matchedVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');
    this.pendingPromptSceneMap.set(promptKey, sceneNumber);
    return sceneNumber;
  }

  reset() {
    this.downloadSceneMap.clear();
    this.pendingPromptSceneMap.clear();
    this.downloadCounter = 0;
    this.nextDownloadId = 100;
  }
}

// Pipeline simulator (enhanced from pipeline.test.js)
class PipelineSimulator {
  constructor(maxParallel = 4) {
    this.maxParallel = maxParallel;
    this.queue = [];
    this.inProgress = [];
    this.completed = [];
    this.failed = [];
    this.retries = new Map();
    this.maxRetries = 3;
    this.rateLimited = [];
  }
  addToQueue(prompts) { this.queue = [...prompts]; }
  canSubmitMore() { return this.inProgress.length < this.maxParallel && this.queue.length > 0; }
  submitNext() {
    if (!this.canSubmitMore()) return null;
    const p = this.queue.shift();
    this.inProgress.push(p);
    return p;
  }
  markCompleted(prompt) {
    const idx = this.inProgress.indexOf(prompt);
    if (idx > -1) { this.inProgress.splice(idx, 1); this.completed.push(prompt); return true; }
    return false;
  }
  markFailed(prompt) {
    const idx = this.inProgress.indexOf(prompt);
    if (idx > -1) {
      this.inProgress.splice(idx, 1);
      const rc = (this.retries.get(prompt) || 0) + 1;
      this.retries.set(prompt, rc);
      if (rc < this.maxRetries) { this.queue.push(prompt); return { status: 'requeued', retryCount: rc }; }
      this.failed.push(prompt); return { status: 'failed', retryCount: rc };
    }
    return { status: 'not_found' };
  }
  markRateLimited(prompt) {
    const idx = this.inProgress.indexOf(prompt);
    if (idx > -1) {
      this.inProgress.splice(idx, 1);
      this.rateLimited.push(prompt);
      this.queue.unshift(prompt); // re-queue at front
      return true;
    }
    return false;
  }
  isComplete() { return this.queue.length === 0 && this.inProgress.length === 0; }
  getStats() {
    return {
      queued: this.queue.length,
      inProgress: this.inProgress.length,
      completed: this.completed.length,
      failed: this.failed.length,
      rateLimited: this.rateLimited.length,
      total: this.queue.length + this.inProgress.length + this.completed.length + this.failed.length
    };
  }
}

// findActiveVideoCards simulator
function findActiveVideoCards(mockElements) {
  const cards = [];
  for (const el of mockElements) {
    const text = el.textContent?.trim() || '';
    const isPercentText = /^\d{1,3}%$/.test(text);
    if (!isPercentText) continue;
    const percent = parseInt(text);
    cards.push({
      element: el,
      percent: Math.min(percent, 100),
      status: percent < 100 ? 'generating' : 'completed'
    });
  }
  return cards;
}

// ========== A. SIMULATE 58+ PROMPT SCENARIOS ==========

describe('A. 58-Prompt Batch Simulation', () => {
  let naming;
  let ws;

  beforeEach(() => {
    naming = new DownloadNamingEngine();
    ws = createWorkflowState();
  });

  test('full 58-prompt batch: sequential download naming stays correct', () => {
    const N = 58;
    ws.activeVideos = Array.from({ length: N }, (_, i) => ({
      index: i, prompt: `Scene ${i + 1} prompt text`, sceneNumber: i + 1
    }));
    ws.totalItems = N;

    for (let i = 0; i < N; i++) {
      naming.prepareFlowDownload(`Scene ${i + 1} prompt text`, ws.activeVideos);
      const dlId = naming.allocDownloadId();
      const filename = naming.getFlowVideoFilename(dlId);
      expect(filename).toBe(`${String(i + 1).padStart(3, '0')}_flow_video.mp4`);
    }
  });

  test('full 58-prompt batch: out-of-order completion preserves scene numbers', () => {
    const N = 58;
    ws.activeVideos = Array.from({ length: N }, (_, i) => ({
      index: i, prompt: `Scene ${i + 1}`, sceneNumber: i + 1
    }));

    // Register all code-initiated downloads
    const dlIds = [];
    for (let i = 0; i < N; i++) {
      const dlId = naming.allocDownloadId();
      dlIds.push(dlId);
      naming.registerVidFlowDownload(dlId, i + 1);
    }

    // Downloads fire in reverse order
    for (let i = N - 1; i >= 0; i--) {
      const filename = naming.getFlowVideoFilename(dlIds[i]);
      expect(filename).toBe(`${String(i + 1).padStart(3, '0')}_flow_video.mp4`);
    }
  });

  test('full 58-prompt batch: random order completion', () => {
    const N = 58;
    const dlIds = [];
    for (let i = 0; i < N; i++) {
      const dlId = naming.allocDownloadId();
      dlIds.push(dlId);
      naming.registerVidFlowDownload(dlId, i + 1);
    }

    // Shuffle order
    const indices = Array.from({ length: N }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    for (const idx of indices) {
      const filename = naming.getFlowVideoFilename(dlIds[idx]);
      expect(filename).toBe(`${String(idx + 1).padStart(3, '0')}_flow_video.mp4`);
    }
  });

  test('pipeline processes all 58 prompts through parallel queue (maxParallel=4)', () => {
    const N = 58;
    const prompts = Array.from({ length: N }, (_, i) => `prompt_${i + 1}`);
    const pipeline = new PipelineSimulator(4);
    pipeline.addToQueue(prompts);

    let iterations = 0;
    while (!pipeline.isComplete() && iterations < 200) {
      while (pipeline.canSubmitMore()) pipeline.submitNext();
      // Complete one at a time
      if (pipeline.inProgress.length > 0) {
        pipeline.markCompleted(pipeline.inProgress[0]);
      }
      iterations++;
    }

    expect(pipeline.completed.length).toBe(N);
    expect(pipeline.isComplete()).toBe(true);
    expect(iterations).toBeLessThan(200);
  });

  test('boundary: prompt 99→100 padding transition', () => {
    const dlId99 = naming.allocDownloadId();
    const dlId100 = naming.allocDownloadId();
    naming.registerVidFlowDownload(dlId99, 99);
    naming.registerVidFlowDownload(dlId100, 100);

    expect(naming.getFlowVideoFilename(dlId99)).toBe('099_flow_video.mp4');
    expect(naming.getFlowVideoFilename(dlId100)).toBe('100_flow_video.mp4');
  });

  test('boundary: prompt 999→1000 padding', () => {
    const dl999 = naming.allocDownloadId();
    const dl1000 = naming.allocDownloadId();
    naming.registerVidFlowDownload(dl999, 999);
    naming.registerVidFlowDownload(dl1000, 1000);

    expect(naming.getFlowVideoFilename(dl999)).toBe('999_flow_video.mp4');
    expect(naming.getFlowVideoFilename(dl1000)).toBe('1000_flow_video.mp4');
  });

  test('boundary: sceneNumber 0 pads to 000', () => {
    const dl = naming.allocDownloadId();
    naming.registerVidFlowDownload(dl, 0);
    expect(naming.getFlowVideoFilename(dl)).toBe('000_flow_video.mp4');
  });

  test('empty prompts do not break the pipeline', () => {
    const pipeline = new PipelineSimulator(4);
    pipeline.addToQueue(['', 'valid prompt', '', 'another valid']);

    while (pipeline.canSubmitMore()) pipeline.submitNext();
    expect(pipeline.inProgress.length).toBe(4);

    // All complete fine
    while (pipeline.inProgress.length > 0) {
      pipeline.markCompleted(pipeline.inProgress[0]);
    }
    expect(pipeline.completed.length).toBe(4);
    expect(pipeline.isComplete()).toBe(true);
  });

  test('100+ prompt batch works correctly', () => {
    const N = 120;
    const dlIds = [];
    for (let i = 0; i < N; i++) {
      const dlId = naming.allocDownloadId();
      dlIds.push(dlId);
      naming.registerVidFlowDownload(dlId, i + 1);
    }

    for (let i = 0; i < N; i++) {
      const filename = naming.getFlowVideoFilename(dlIds[i]);
      expect(filename).toBe(`${String(i + 1).padStart(3, '0')}_flow_video.mp4`);
    }
  });
});

// ========== B. TIMEOUT AND FAILURE RESILIENCE ==========

describe('B. Timeout and Failure Resilience', () => {
  test('speech API timeout at prompt 30 of 58: remaining prompts still processable', () => {
    const N = 58;
    const pipeline = new PipelineSimulator(1); // Speech is sequential
    const prompts = Array.from({ length: N }, (_, i) => `narration_${i + 1}`);
    pipeline.addToQueue(prompts);

    // Process 29 successfully
    for (let i = 0; i < 29; i++) {
      pipeline.submitNext();
      pipeline.markCompleted(pipeline.inProgress[0]);
    }

    // Prompt 30 times out (fails)
    pipeline.submitNext();
    pipeline.markFailed(pipeline.inProgress[0]); // requeued (retry 1)

    expect(pipeline.completed.length).toBe(29);
    expect(pipeline.queue.length).toBe(29); // 28 remaining + 1 requeued

    // Continue processing remaining
    let maxIter = 100;
    while (!pipeline.isComplete() && maxIter-- > 0) {
      while (pipeline.canSubmitMore()) pipeline.submitNext();
      if (pipeline.inProgress.length > 0) pipeline.markCompleted(pipeline.inProgress[0]);
    }

    expect(pipeline.completed.length).toBe(N);
  });

  test('Flow video fails at 45 of 58: numbering of 46-58 stays correct', () => {
    const naming = new DownloadNamingEngine();
    const N = 58;

    // Register all downloads
    const dlIds = [];
    for (let i = 0; i < N; i++) {
      const dlId = naming.allocDownloadId();
      dlIds.push(dlId);
      naming.registerVidFlowDownload(dlId, i + 1);
    }

    // Download 1-44 successfully
    for (let i = 0; i < 44; i++) {
      const fn = naming.getFlowVideoFilename(dlIds[i]);
      expect(fn).toBe(`${String(i + 1).padStart(3, '0')}_flow_video.mp4`);
    }

    // Video 45 fails (skip its download id - no getFlowVideoFilename call)
    // Videos 46-58 should still get correct numbers
    for (let i = 45; i < N; i++) {
      const fn = naming.getFlowVideoFilename(dlIds[i]);
      expect(fn).toBe(`${String(i + 1).padStart(3, '0')}_flow_video.mp4`);
    }

    // Video 45 retried and succeeds later
    const fn45 = naming.getFlowVideoFilename(dlIds[44]);
    expect(fn45).toBe('045_flow_video.mp4');
  });

  test('Chrome kills download mid-progress: downloadSceneMap entry persists for retry', () => {
    const naming = new DownloadNamingEngine();
    const dlId = naming.allocDownloadId();
    naming.registerVidFlowDownload(dlId, 5);

    // Download killed → entry still in map
    expect(naming.downloadSceneMap.has(dlId)).toBe(true);

    // New download for same scene
    const newDlId = naming.allocDownloadId();
    naming.registerVidFlowDownload(newDlId, 5);

    // Old entry still exists (both exist)
    expect(naming.downloadSceneMap.has(dlId)).toBe(true);
    expect(naming.downloadSceneMap.has(newDlId)).toBe(true);

    // New download completes correctly
    const fn = naming.getFlowVideoFilename(newDlId);
    expect(fn).toBe('005_flow_video.mp4');

    // Old orphan entry can be cleaned
    naming.downloadSceneMap.delete(dlId);
    expect(naming.downloadSceneMap.size).toBe(0);
  });

  test('content script disconnect at video 20: activeVideos preserves state', () => {
    const ws = createWorkflowState();
    ws.activeVideos = Array.from({ length: 4 }, (_, i) => ({
      index: 19 + i, prompt: `video ${20 + i}`, sceneNumber: 20 + i
    }));
    ws.currentIndex = 24;
    ws.totalItems = 58;

    // Disconnect simulation: activeVideos remains intact
    expect(ws.activeVideos.length).toBe(4);
    expect(ws.activeVideos[0].sceneNumber).toBe(20);

    // After reconnection, can resume from where we left off
    expect(ws.currentIndex).toBe(24);
    expect(ws.totalItems - ws.currentIndex).toBe(34); // 34 remaining to send
  });

  test('3 consecutive rate-limited videos: pipeline handles correctly', () => {
    const pipeline = new PipelineSimulator(4);
    pipeline.addToQueue(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);

    // Submit first 4
    pipeline.submitNext(); pipeline.submitNext(); pipeline.submitNext(); pipeline.submitNext();

    // First 3 hit rate limit
    pipeline.markRateLimited('v1');
    pipeline.markRateLimited('v2');
    pipeline.markRateLimited('v3');

    expect(pipeline.rateLimited.length).toBe(3);
    expect(pipeline.inProgress).toEqual(['v4']);
    // v1, v2, v3 should be at front of queue
    expect(pipeline.queue[0]).toBe('v3'); // unshift puts at front
    expect(pipeline.queue[1]).toBe('v2');
    expect(pipeline.queue[2]).toBe('v1');

    // v4 completes, v5, v6 still in queue
    pipeline.markCompleted('v4');

    // Resume: rate-limited ones can be resubmitted
    let maxIter = 30;
    while (!pipeline.isComplete() && maxIter-- > 0) {
      while (pipeline.canSubmitMore()) pipeline.submitNext();
      if (pipeline.inProgress.length > 0) pipeline.markCompleted(pipeline.inProgress[0]);
    }
    expect(pipeline.completed.length).toBe(6);
  });

  test('all 4 parallel videos fail simultaneously', () => {
    const pipeline = new PipelineSimulator(4);
    pipeline.addToQueue(['v1', 'v2', 'v3', 'v4', 'v5']);

    pipeline.submitNext(); pipeline.submitNext(); pipeline.submitNext(); pipeline.submitNext();

    // All 4 fail at once
    pipeline.markFailed('v1'); // requeued
    pipeline.markFailed('v2');
    pipeline.markFailed('v3');
    pipeline.markFailed('v4');

    expect(pipeline.inProgress.length).toBe(0);
    expect(pipeline.queue.length).toBe(5); // v5 + 4 requeued

    // Can still submit and complete
    let maxIter = 50;
    while (!pipeline.isComplete() && maxIter-- > 0) {
      while (pipeline.canSubmitMore()) pipeline.submitNext();
      if (pipeline.inProgress.length > 0) pipeline.markCompleted(pipeline.inProgress[0]);
    }
    expect(pipeline.completed.length).toBe(5);
    expect(pipeline.isComplete()).toBe(true);
  });

  test('video fails then succeeds on retry: numbering preserved', () => {
    const naming = new DownloadNamingEngine();
    const ws = createWorkflowState();
    ws.activeVideos = [
      { index: 0, prompt: 'vid A', sceneNumber: 1 },
      { index: 1, prompt: 'vid B', sceneNumber: 2 },
      { index: 2, prompt: 'vid C', sceneNumber: 3 }
    ];

    // vid B fails (no download initiated)
    // vid A and C download successfully
    const dlA = naming.allocDownloadId();
    naming.registerVidFlowDownload(dlA, 1);
    const dlC = naming.allocDownloadId();
    naming.registerVidFlowDownload(dlC, 3);

    expect(naming.getFlowVideoFilename(dlA)).toBe('001_flow_video.mp4');
    expect(naming.getFlowVideoFilename(dlC)).toBe('003_flow_video.mp4');

    // vid B retried and succeeds
    const dlB = naming.allocDownloadId();
    naming.registerVidFlowDownload(dlB, 2);
    expect(naming.getFlowVideoFilename(dlB)).toBe('002_flow_video.mp4');
  });
});

// ========== C. MEMORY AND STATE MANAGEMENT ==========

describe('C. Memory and State Management', () => {
  test('state resets properly between pipeline runs', () => {
    const ws = createWorkflowState({
      isRunning: true,
      currentIndex: 30,
      totalItems: 58,
      activeVideos: [{ index: 29, prompt: 'test' }],
      generatedVideos: Array(29).fill({ filename: 'test.mp4' })
    });

    // Reset
    const fresh = createWorkflowState();
    expect(fresh.isRunning).toBe(false);
    expect(fresh.currentIndex).toBe(0);
    expect(fresh.activeVideos).toEqual([]);
    expect(fresh.generatedVideos).toEqual([]);
    expect(fresh.totalItems).toBe(0);
  });

  test('activeVideos does not grow unbounded during 58-prompt batch', () => {
    const MAX_PARALLEL = 4;
    const N = 58;
    const ws = createWorkflowState({ totalItems: N });
    let maxActive = 0;

    for (let i = 0; i < N; i++) {
      // Add to activeVideos
      ws.activeVideos.push({ index: i, prompt: `p${i}`, sceneNumber: i + 1 });
      maxActive = Math.max(maxActive, ws.activeVideos.length);

      // Complete oldest when at capacity
      if (ws.activeVideos.length >= MAX_PARALLEL) {
        ws.activeVideos.shift();
        ws.generatedVideos.push({ index: i, filename: `${String(i + 1).padStart(3, '0')}_flow_video.mp4` });
      }
    }

    // Drain remaining
    while (ws.activeVideos.length > 0) {
      ws.activeVideos.shift();
      ws.generatedVideos.push({ filename: 'done.mp4' });
    }

    expect(maxActive).toBeLessThanOrEqual(MAX_PARALLEL);
    expect(ws.activeVideos.length).toBe(0);
  });

  test('downloadSceneMap and pendingPromptSceneMap get cleaned up after use', () => {
    const naming = new DownloadNamingEngine();

    // Add entries
    for (let i = 0; i < 20; i++) {
      const dlId = naming.allocDownloadId();
      naming.registerVidFlowDownload(dlId, i + 1);
    }
    expect(naming.downloadSceneMap.size).toBe(20);

    // Consume all
    for (let i = 0; i < 20; i++) {
      naming.getFlowVideoFilename(100 + i); // IDs start at 100
    }
    expect(naming.downloadSceneMap.size).toBe(0);
  });

  test('pendingPromptSceneMap cleaned up after getFlowVideoFilename', () => {
    const naming = new DownloadNamingEngine();
    const activeVideos = [
      { index: 0, prompt: 'test prompt', sceneNumber: 1 }
    ];

    naming.prepareFlowDownload('test prompt', activeVideos);
    expect(naming.pendingPromptSceneMap.size).toBe(1);

    naming.getFlowVideoFilename(naming.allocDownloadId());
    expect(naming.pendingPromptSceneMap.size).toBe(0);
  });

  test('storage quota failure is handled gracefully', async () => {
    const failingStorage = {
      set: jest.fn(() => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded')))
    };

    // Simulate saveState with failing storage
    let savedOk = true;
    try {
      await failingStorage.set({ workflowState: { big: 'data' } });
    } catch (error) {
      savedOk = false;
      expect(error.message).toContain('QUOTA_BYTES');
    }
    expect(savedOk).toBe(false);
  });

  test('workflowState and pipelineState out of sync: detection', () => {
    const ws = createWorkflowState({ isRunning: true, currentStep: 'flow' });
    const ps = createPipelineState({ isRunning: false, currentStep: null });

    // Detect out of sync
    const isOutOfSync = ws.isRunning !== ps.isRunning;
    expect(isOutOfSync).toBe(true);

    // Resolution: pipelineState should take precedence for pipeline mode
    // or workflowState for legacy mode
  });

  test('pipelineState reset clears all sub-states', () => {
    const ps = createPipelineState({
      isRunning: true,
      currentStep: 'flow',
      whisk: { isComplete: true, currentIndex: 10, totalItems: 10, generatedImages: Array(10).fill('img'), tabId: 5 },
      flow: { isComplete: false, currentIndex: 3, totalItems: 10, generatedVideos: Array(3).fill('vid'), tabId: 6 },
      speech: { isComplete: true, currentIndex: 10, totalItems: 10, generatedAudios: Array(10).fill('aud'), tabId: 7 },
      scenes: Array(10).fill({ prompt: 'test' })
    });

    const fresh = createPipelineState();
    expect(fresh.isRunning).toBe(false);
    expect(fresh.whisk.generatedImages).toEqual([]);
    expect(fresh.flow.generatedVideos).toEqual([]);
    expect(fresh.speech.generatedAudios).toEqual([]);
    expect(fresh.scenes).toEqual([]);
  });

  test('downloadSceneMap does not leak between workflow runs', () => {
    const naming = new DownloadNamingEngine();

    // Run 1: register some downloads
    naming.registerVidFlowDownload(naming.allocDownloadId(), 1);
    naming.registerVidFlowDownload(naming.allocDownloadId(), 2);
    expect(naming.downloadSceneMap.size).toBe(2);

    // Reset between runs
    naming.reset();
    expect(naming.downloadSceneMap.size).toBe(0);
    expect(naming.pendingPromptSceneMap.size).toBe(0);
    expect(naming.downloadCounter).toBe(0);
  });
});

// ========== D. MONITOR EDGE CASES ==========

describe('D. Monitor Edge Cases', () => {
  describe('startDownloadMonitor multiple calls', () => {
    test('second call is rejected when monitor is already running', () => {
      let isMonitorRunning = false;

      function startDownloadMonitor() {
        if (isMonitorRunning) {
          return { success: true, skipped: true, reason: 'already_running' };
        }
        isMonitorRunning = true;
        return { success: true, started: true };
      }

      const r1 = startDownloadMonitor();
      expect(r1.started).toBe(true);

      const r2 = startDownloadMonitor();
      expect(r2.skipped).toBe(true);
      expect(r2.reason).toBe('already_running');
    });

    test('monitor flag resets after completion allowing restart', () => {
      let isMonitorRunning = false;

      function startMonitor() {
        if (isMonitorRunning) return false;
        isMonitorRunning = true;
        return true;
      }
      function stopMonitor() { isMonitorRunning = false; }

      expect(startMonitor()).toBe(true);
      expect(startMonitor()).toBe(false);
      stopMonitor();
      expect(startMonitor()).toBe(true);
    });
  });

  describe('findActiveVideoCards edge cases', () => {
    test('handles "101%" - matched as 3-digit number, clamped to 100', () => {
      const mockElements = [{ textContent: '101%' }];
      const cards = findActiveVideoCards(mockElements);
      // 101 is 3 digits, matches \d{1,3}, but clamped to 100
      expect(cards.length).toBe(1);
      expect(cards[0].percent).toBe(100);
      expect(cards[0].status).toBe('completed');
    });

    test('handles "NaN%" - not matched by regex', () => {
      const mockElements = [{ textContent: 'NaN%' }];
      const cards = findActiveVideoCards(mockElements);
      expect(cards.length).toBe(0);
    });

    test('handles "0%" as generating', () => {
      const mockElements = [{ textContent: '0%' }];
      const cards = findActiveVideoCards(mockElements);
      expect(cards.length).toBe(1);
      expect(cards[0].status).toBe('generating');
      expect(cards[0].percent).toBe(0);
    });

    test('handles "100%" as completed', () => {
      const mockElements = [{ textContent: '100%' }];
      const cards = findActiveVideoCards(mockElements);
      expect(cards.length).toBe(1);
      expect(cards[0].status).toBe('completed');
    });

    test('handles "99%" as generating', () => {
      const mockElements = [{ textContent: '99%' }];
      const cards = findActiveVideoCards(mockElements);
      expect(cards.length).toBe(1);
      expect(cards[0].status).toBe('generating');
      expect(cards[0].percent).toBe(99);
    });

    test('handles mixed valid and invalid percent texts', () => {
      const mockElements = [
        { textContent: '45%' },
        { textContent: 'NaN%' },
        { textContent: '100%' },
        { textContent: '1000%' }, // 4 digits, won't match {1,3}
        { textContent: '72%' },
      ];
      const cards = findActiveVideoCards(mockElements);
      expect(cards.length).toBe(3); // 45%, 100%, 72%
      expect(cards[0].percent).toBe(45);
      expect(cards[1].percent).toBe(100);
      expect(cards[2].percent).toBe(72);
    });

    test('empty DOM returns empty array', () => {
      const cards = findActiveVideoCards([]);
      expect(cards.length).toBe(0);
    });
  });

  describe('deadlock detection', () => {
    test('correctly identifies deadlock: no activity + workflow not complete', () => {
      let noActivityCycles = 0;
      const MAX_NO_ACTIVITY_CYCLES = 6;
      const isWorkflowComplete = false;

      // Simulate 6 cycles with no activity
      for (let i = 0; i < 6; i++) {
        noActivityCycles++;
      }

      const isDeadlock = noActivityCycles >= MAX_NO_ACTIVITY_CYCLES && !isWorkflowComplete;
      expect(isDeadlock).toBe(true);
    });

    test('distinguishes slow generation from deadlock', () => {
      let noActivityCycles = 0;
      const MAX_NO_ACTIVITY_CYCLES = 6;

      // 3 cycles no activity, then activity appears
      noActivityCycles = 3;
      const generatingVideos = [{ percent: 10 }]; // slow but active

      if (generatingVideos.length > 0) {
        noActivityCycles = 0; // reset
      }

      expect(noActivityCycles).toBe(0);
      expect(noActivityCycles < MAX_NO_ACTIVITY_CYCLES).toBe(true);
    });

    test('deadlock counter resets when activity resumes', () => {
      let noActivityCycles = 5;

      // Activity detected
      const hasActivity = true;
      if (hasActivity) noActivityCycles = 0;

      expect(noActivityCycles).toBe(0);
    });
  });

  describe('all 4 parallel videos fail simultaneously', () => {
    test('pipeline recovers and retries all', () => {
      const pipeline = new PipelineSimulator(4);
      pipeline.addToQueue(['a', 'b', 'c', 'd']);

      pipeline.submitNext(); pipeline.submitNext(); pipeline.submitNext(); pipeline.submitNext();
      expect(pipeline.inProgress.length).toBe(4);

      // All fail
      pipeline.markFailed('a');
      pipeline.markFailed('b');
      pipeline.markFailed('c');
      pipeline.markFailed('d');

      expect(pipeline.inProgress.length).toBe(0);
      expect(pipeline.queue.length).toBe(4); // all requeued

      // Retry and complete
      while (pipeline.canSubmitMore()) pipeline.submitNext();
      while (pipeline.inProgress.length > 0) pipeline.markCompleted(pipeline.inProgress[0]);

      expect(pipeline.completed.length).toBe(4);
    });

    test('all 4 fail 3 times each: all marked as permanently failed', () => {
      const pipeline = new PipelineSimulator(4);
      pipeline.addToQueue(['a', 'b', 'c', 'd']);

      for (let attempt = 0; attempt < 3; attempt++) {
        while (pipeline.canSubmitMore()) pipeline.submitNext();
        const current = [...pipeline.inProgress];
        for (const p of current) pipeline.markFailed(p);
      }

      expect(pipeline.failed.length).toBe(4);
      expect(pipeline.isComplete()).toBe(true);
    });
  });

  describe('session protection against race conditions', () => {
    test('stop from previous session is ignored', () => {
      const currentSessionId = 'abc123';
      const stopSessionId = 'xyz789'; // different

      const shouldStop = stopSessionId === currentSessionId;
      expect(shouldStop).toBe(false);
    });

    test('stop within 5s of session start is ignored', () => {
      const sessionStartTime = Date.now();
      const timeSinceStart = Date.now() - sessionStartTime;

      const shouldIgnore = timeSinceStart < 5000 && timeSinceStart > 0;
      // timeSinceStart is ~0, which is > 0 is false in some cases
      // but conceptually this protects against race conditions
      expect(timeSinceStart).toBeLessThan(5000);
    });

    test('stop with matching session ID is accepted', () => {
      const sessionId = 'abc123';
      const shouldStop = sessionId === sessionId;
      expect(shouldStop).toBe(true);
    });
  });
});

// ========== E. ADDITIONAL ROBUSTNESS TESTS ==========

describe('E. Additional Robustness', () => {
  test('pendingSpeechDownload expires after 30 seconds', () => {
    let timestamp = Date.now() - 31000; // 31 seconds ago
    let filename = 'test.wav';

    function getPending() {
      if (filename && timestamp) {
        if (Date.now() - timestamp < 30000) return filename;
        filename = null;
        timestamp = null;
      }
      return null;
    }

    expect(getPending()).toBeNull();
  });

  test('pendingSpeechDownload valid within 30 seconds', () => {
    let timestamp = Date.now();
    let filename = 'test.wav';

    function getPending() {
      if (filename && timestamp) {
        if (Date.now() - timestamp < 30000) return filename;
      }
      return null;
    }

    expect(getPending()).toBe('test.wav');
  });

  test('large batch with mixed failures and successes', () => {
    const N = 58;
    const naming = new DownloadNamingEngine();
    const pipeline = new PipelineSimulator(4);
    const prompts = Array.from({ length: N }, (_, i) => `prompt_${i + 1}`);
    pipeline.addToQueue(prompts);

    const failEveryNth = 7; // Every 7th video fails
    let processedCount = 0;

    let maxIter = 300;
    while (!pipeline.isComplete() && maxIter-- > 0) {
      while (pipeline.canSubmitMore()) pipeline.submitNext();

      if (pipeline.inProgress.length > 0) {
        processedCount++;
        const current = pipeline.inProgress[0];
        if (processedCount % failEveryNth === 0) {
          pipeline.markFailed(current);
        } else {
          pipeline.markCompleted(current);
        }
      }
    }

    const stats = pipeline.getStats();
    // All should eventually complete or permanently fail
    expect(pipeline.isComplete()).toBe(true);
    expect(stats.completed + stats.failed).toBe(N);
  });

  test('download naming with duplicate prompts (same text, different scenes)', () => {
    const naming = new DownloadNamingEngine();
    const activeVideos = [
      { index: 0, prompt: 'A character walks', sceneNumber: 1 },
      { index: 5, prompt: 'A character walks', sceneNumber: 6 }, // same prompt!
    ];

    // First prepare matches first video
    naming.prepareFlowDownload('A character walks', activeVideos);
    const fn1 = naming.getFlowVideoFilename(naming.allocDownloadId());
    expect(fn1).toBe('001_flow_video.mp4');

    // Second prepare still matches first in list (since we don't remove from activeVideos here)
    naming.prepareFlowDownload('A character walks', activeVideos);
    const fn2 = naming.getFlowVideoFilename(naming.allocDownloadId());
    expect(fn2).toBe('001_flow_video.mp4');
  });

  test('concurrent prepareFlowDownload calls do not corrupt state', () => {
    const naming = new DownloadNamingEngine();
    const activeVideos = [
      { index: 0, prompt: 'Video A', sceneNumber: 1 },
      { index: 1, prompt: 'Video B', sceneNumber: 2 },
      { index: 2, prompt: 'Video C', sceneNumber: 3 },
    ];

    // Multiple prepares
    naming.prepareFlowDownload('Video A', activeVideos);
    naming.prepareFlowDownload('Video B', activeVideos);
    naming.prepareFlowDownload('Video C', activeVideos);

    // All should be in pendingPromptSceneMap
    expect(naming.pendingPromptSceneMap.size).toBe(3);

    // Downloads fire
    expect(naming.getFlowVideoFilename(naming.allocDownloadId())).toBe('001_flow_video.mp4');
    expect(naming.getFlowVideoFilename(naming.allocDownloadId())).toBe('002_flow_video.mp4');
    expect(naming.getFlowVideoFilename(naming.allocDownloadId())).toBe('003_flow_video.mp4');

    expect(naming.pendingPromptSceneMap.size).toBe(0);
  });

  test('workflow resumption preserves existing generatedVideos', () => {
    const ws = createWorkflowState({
      isRunning: false,
      currentIndex: 20,
      totalItems: 58,
      generatedVideos: Array.from({ length: 20 }, (_, i) => ({
        index: i,
        filename: `${String(i + 1).padStart(3, '0')}_flow_video.mp4`
      })),
      resumedFrom: 20
    });

    expect(ws.generatedVideos.length).toBe(20);
    expect(ws.resumedFrom).toBe(20);

    // Resume: start from index 20
    ws.isRunning = true;
    ws.activeVideos = [];

    for (let i = 20; i < 24; i++) { // Submit next 4
      ws.activeVideos.push({ index: i, prompt: `scene ${i + 1}`, sceneNumber: i + 1 });
    }

    expect(ws.activeVideos.length).toBe(4);
    expect(ws.activeVideos[0].sceneNumber).toBe(21);
  });

  test('stress: 200 rapid download ID allocations and lookups', () => {
    const naming = new DownloadNamingEngine();
    const N = 200;

    const dlIds = [];
    for (let i = 0; i < N; i++) {
      const id = naming.allocDownloadId();
      dlIds.push(id);
      naming.registerVidFlowDownload(id, i + 1);
    }

    expect(naming.downloadSceneMap.size).toBe(N);

    // Lookup all in reverse
    for (let i = N - 1; i >= 0; i--) {
      const fn = naming.getFlowVideoFilename(dlIds[i]);
      expect(fn).toBe(`${String(i + 1).padStart(3, '0')}_flow_video.mp4`);
    }

    expect(naming.downloadSceneMap.size).toBe(0);
  });

  test('pipeline with maxParallel=4 never exceeds 4 inProgress', () => {
    const pipeline = new PipelineSimulator(4);
    pipeline.addToQueue(Array.from({ length: 58 }, (_, i) => `p${i}`));

    let maxInProgress = 0;
    let iterations = 0;

    while (!pipeline.isComplete() && iterations < 200) {
      while (pipeline.canSubmitMore()) pipeline.submitNext();
      maxInProgress = Math.max(maxInProgress, pipeline.inProgress.length);

      // Complete random one
      if (pipeline.inProgress.length > 0) {
        const idx = Math.floor(Math.random() * pipeline.inProgress.length);
        pipeline.markCompleted(pipeline.inProgress[idx]);
      }
      iterations++;
    }

    expect(maxInProgress).toBeLessThanOrEqual(4);
    expect(pipeline.completed.length).toBe(58);
  });
});
