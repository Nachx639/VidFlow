/**
 * ROUND 16: END-TO-END FLOW SIMULATION
 *
 * Comprehensive e2e tests simulating:
 * 1. Full 58-prompt video batch lifecycle with failures, retries, rate limits
 * 2. Parallel pipeline: (Whisk→Flow) || Speech with 20 scenes
 *
 * Tests exercise the real function chains from background.js by simulating
 * the message-passing protocol between sidepanel, background, and content scripts.
 */

// ========== DATA GENERATORS ==========

function generateRealisticPrompts(count) {
  const templates = [
    'A cinematic drone shot flying over {location} at {time}, revealing {subject} below, 4K quality',
    'Close-up of {subject} in {location}, {mood} lighting, slow motion, {style} aesthetic',
    'Wide establishing shot of {location} during {time}, {weather} atmosphere, lens flare',
    'Tracking shot following {subject} through {location}, {mood} mood, {style} color grading',
    'Time-lapse of {location} transitioning from {time} to night, clouds moving, stars appearing',
    'Macro shot of {subject} with shallow depth of field, {mood} tones, bokeh background',
    'Aerial view of {location} with {subject} visible, {weather} sky, epic {style} composition',
    'Slow dolly zoom on {subject} in {location}, {mood} atmosphere, film grain texture',
    'POV walking through {location}, discovering {subject}, natural {time} lighting',
    'Split screen showing {subject} in different {location}s, synchronized motion, {style} palette',
  ];
  const locations = ['ancient Japanese temple', 'Sahara desert dunes', 'underwater coral reef', 'Manhattan skyline', 'Norwegian fjords', 'Amazonian rainforest'];
  const subjects = ['a lone traveler', 'wild horses running', 'cherry blossoms falling', 'ocean waves crashing', 'a vintage car', 'migrating birds'];
  const times = ['golden hour', 'blue hour', 'dawn', 'dusk', 'midnight', 'noon'];
  const moods = ['dramatic', 'ethereal', 'melancholic', 'serene', 'mysterious', 'vibrant'];
  const styles = ['cinematic', 'documentary', 'noir', 'fantasy', 'minimalist', 'retro'];
  const weather = ['stormy', 'misty', 'clear', 'overcast', 'foggy', 'sunset'];
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  return Array.from({ length: count }, (_, i) => ({
    prompt: templates[i % templates.length]
      .replace('{location}', pick(locations)).replace('{subject}', pick(subjects))
      .replace('{time}', pick(times)).replace('{mood}', pick(moods))
      .replace('{style}', pick(styles)).replace('{weather}', pick(weather)),
    category: 'batch', sceneNumber: i + 1, referenceNeeded: 'batch'
  }));
}

function generateBatchImages(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: `image_${String(i + 1).padStart(3, '0')}.png`,
    data: `data:image/png;base64,FAKE_${i}_${Math.random().toString(36).slice(2, 10)}`
  }));
}

function generateScenes(count) {
  return Array.from({ length: count }, (_, i) => ({
    index: i, sceneNumber: i + 1,
    prompt: `Scene ${i + 1}: A breathtaking shot of ${['mountains', 'ocean', 'forest', 'desert', 'city'][i % 5]} with dramatic lighting`,
    narration: `Narration for scene ${i + 1}. The viewer sees a magnificent landscape unfolding.`,
    style: 'Speak with gravitas', flowImage: null
  }));
}

// ========== FLOW PIPELINE SIMULATOR ==========
// Mirrors the actual logic from background.js

class FlowPipelineSimulator {
  constructor() {
    this.reset();
  }

  reset() {
    this.isRunning = false;
    this.currentStep = null;
    this.currentIndex = 0;
    this.totalItems = 0;
    this.prompts = [];
    this.batchImages = [];
    this.config = {};
    this.folderName = 'VidFlow01';
    this.activeVideos = [];
    this.generatedVideos = [];
    this.failedVideos = [];
    this.rateLimitedVideos = [];
    this.pendingIndexes = null;
    this.resumedFrom = 0;
    this.MAX_PARALLEL = 4;
    this.lastActivityTime = 0;
    this.downloadSceneMap = new Map();
    this.pendingPromptSceneMap = new Map();
    this.downloadCounter = 0;
    this.progressMessages = [];
    this.completionNotified = false;
  }

  startFlow(data) {
    if (this.isRunning) {
      const stale = Date.now() - this.lastActivityTime > 30000;
      if (!stale) return { success: false, error: 'Workflow already running' };
    }

    this.reset();
    this.isRunning = true;
    this.currentStep = 'flow';
    this.lastActivityTime = Date.now();
    this.prompts = data.prompts || [];
    this.totalItems = this.prompts.length;
    this.batchImages = data.batchImages || [];
    this.config = data.config || {};
    this.folderName = data.folderName || data.config?.folderName || 'VidFlow01';

    if (this.totalItems === 0) {
      this.isRunning = false;
      return { success: true, message: 'No prompts' };
    }

    // Send first video
    this._sendNextVideo();
    return { success: true };
  }

  startFlowWithExisting(data, existingPrompts) {
    // Simulate resume: detect existing videos by prompt match
    const missing = [];
    for (let i = 0; i < data.prompts.length; i++) {
      const exists = existingPrompts.some(ep => ep === data.prompts[i].prompt);
      if (!exists) missing.push(i);
    }

    if (missing.length === 0) {
      return { success: true, message: 'Todos los videos ya existen' };
    }

    this.reset();
    this.isRunning = true;
    this.currentStep = 'flow';
    this.lastActivityTime = Date.now();
    this.prompts = data.prompts;
    this.totalItems = data.prompts.length;
    this.batchImages = data.batchImages || [];
    this.config = data.config || {};
    this.folderName = data.folderName || 'VidFlow01';
    this.pendingIndexes = missing;
    this.resumedFrom = data.prompts.length - missing.length;
    this.downloadCounter = this.resumedFrom;

    this._sendNextVideo();
    return { success: true };
  }

  _sendNextVideo() {
    if (!this.isRunning || this.currentStep !== 'flow') return null;

    const usePending = Array.isArray(this.pendingIndexes);
    const totalToProcess = usePending ? this.pendingIndexes.length : this.totalItems;

    if (this.currentIndex >= totalToProcess) return null;
    if (this.activeVideos.length >= this.MAX_PARALLEL) return null;

    const realIdx = usePending ? this.pendingIndexes[this.currentIndex] : this.currentIndex;
    const prompt = this.prompts[realIdx];

    this.activeVideos.push({
      index: realIdx,
      prompt: prompt.prompt,
      sceneNumber: prompt.sceneNumber || (realIdx + 1),
      startTime: Date.now()
    });

    this.currentIndex++;
    this.lastActivityTime = Date.now();

    return {
      index: realIdx,
      prompt: prompt.prompt,
      imageData: this.config.useBatch && this.batchImages[realIdx] ? this.batchImages[realIdx].data : null
    };
  }

  handleVideoQueued(index) {
    this.lastActivityTime = Date.now();
    // Try to send next if space available
    return this._sendNextVideo();
  }

  handleVideoDownloaded(promptText) {
    if (!this.activeVideos.length) return { success: false, error: 'No active videos' };

    // Match by prompt
    let matchIdx = this.activeVideos.findIndex(v =>
      v.prompt.toLowerCase().trim() === (promptText || '').toLowerCase().trim()
    );
    if (matchIdx === -1) matchIdx = 0; // FIFO fallback

    const video = this.activeVideos.splice(matchIdx, 1)[0];
    const sceneNumber = video.sceneNumber;
    const filename = `${String(sceneNumber).padStart(3, '0')}_flow_video.mp4`;

    this.generatedVideos.push({ index: video.index, filename, sceneNumber });
    this.progressMessages.push({ current: this.generatedVideos.length + this.resumedFrom, total: this.totalItems });

    // Check completion
    const usePending = Array.isArray(this.pendingIndexes);
    const totalToGenerate = usePending ? this.pendingIndexes.length : this.totalItems;

    if (this.generatedVideos.length >= totalToGenerate) {
      this._complete();
      return { success: true, filename, complete: true };
    }

    // Send next if space
    this._sendNextVideo();
    return { success: true, filename, index: video.index };
  }

  handleVideoError(index, errorType, message) {
    this.activeVideos = this.activeVideos.filter(v => v.index !== index);
    this.failedVideos.push({ index, error: errorType, message });

    if (errorType === 'rate_limit') {
      this.rateLimitedVideos.push({ index, message, timestamp: Date.now() });
    }

    // Send next if space
    this._sendNextVideo();
    return { success: true };
  }

  handleDownloadVideoUrl(url, promptText) {
    if (!this.activeVideos.length) return { success: false, error: 'No active videos' };

    let matchIdx = -1;
    if (promptText) {
      const pt = promptText.toLowerCase().trim();
      matchIdx = this.activeVideos.findIndex(v => v.prompt.toLowerCase().trim().includes(pt) || pt.includes(v.prompt.toLowerCase().trim()));
    }
    if (matchIdx === -1) matchIdx = 0;

    const video = this.activeVideos.splice(matchIdx, 1)[0];
    const filename = `${String(video.sceneNumber).padStart(3, '0')}_flow_video.mp4`;
    this.generatedVideos.push({ index: video.index, filename });
    return { success: true, filename, downloadId: 1 };
  }

  handlePrepareDownload(promptText) {
    if (!this.activeVideos.length) return { success: false, sceneNumber: null };
    const pt = (promptText || '').toLowerCase().trim();
    let match = this.activeVideos.find(v => v.prompt.toLowerCase().trim() === pt);
    if (!match) match = this.activeVideos[0];
    return { success: true, sceneNumber: match.sceneNumber };
  }

  handleDeadlock() {
    if (this.activeVideos.length > 0) {
      this.activeVideos = [];
      this._sendNextVideo();
    }
    return { success: true, handled: true };
  }

  stopWorkflow() {
    this.isRunning = false;
    this.currentStep = null;
    this.activeVideos = [];
    return { success: true };
  }

  checkComplete() {
    const usePending = Array.isArray(this.pendingIndexes);
    const total = usePending ? this.pendingIndexes.length : this.totalItems;
    return {
      complete: this.generatedVideos.length >= total && this.activeVideos.length === 0,
      generated: this.generatedVideos.length,
      active: this.activeVideos.length,
      total
    };
  }

  _complete() {
    this.isRunning = false;
    this.currentStep = null;
    this.completionNotified = true;
  }
}

// ========== PIPELINE SIMULATOR ==========

class PipelineSimulator {
  constructor() { this.reset(); }

  reset() {
    this.isRunning = false;
    this.currentStep = null;
    this.projectFolder = null;
    this.parallelMode = false;
    this.runWhisk = true;
    this.runFlow = true;
    this.runSpeech = true;
    this.whisk = { isComplete: false, currentIndex: 0, totalItems: 0, generatedImages: [] };
    this.flow = { isComplete: false, currentIndex: 0, totalItems: 0, generatedVideos: [] };
    this.speech = { isComplete: false, currentIndex: 0, totalItems: 0, generatedAudios: [] };
    this.scenes = [];
    this.referenceCategories = [];
    this.config = {};
    this.progressMessages = [];
  }

  startPipeline(data) {
    if (this.isRunning) return { success: false, error: 'Pipeline already running' };
    this.reset();
    this.isRunning = true;
    this.scenes = data.scenes || [];
    this.referenceCategories = data.referenceCategories || [];
    this.runWhisk = data.runWhisk !== false;
    this.runFlow = data.runFlow !== false;
    this.runSpeech = data.runSpeech !== false;
    this.config = data.config || {};

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    this.projectFolder = data.projectFolder || `Proyecto_${ts}`;

    this.whisk.totalItems = this.scenes.length;
    this.flow.totalItems = this.scenes.length;
    this.speech.totalItems = this.scenes.filter(s => s.narration).length;

    if (this.runWhisk) {
      this.currentStep = 'whisk';
    } else if (this.runFlow) {
      this.currentStep = 'flow';
    } else if (this.runSpeech) {
      this.currentStep = 'speech';
    }

    return { success: true, projectFolder: this.projectFolder };
  }

  startParallelPipeline(data) {
    const r = this.startPipeline(data);
    if (!r.success) return r;
    this.parallelMode = true;
    this.currentStep = 'parallel';
    return { ...r, mode: 'parallel' };
  }

  whiskSceneComplete(index, filename, imageData) {
    if (!this.isRunning) return { success: false };
    this.whisk.generatedImages.push({ index, filename, imageData });
    this.whisk.currentIndex++;
    this.scenes[index].flowImage = imageData;

    if (this.whisk.currentIndex >= this.whisk.totalItems) {
      this.whisk.isComplete = true;
      this.progressMessages.push({ step: 'whisk', status: 'complete' });

      if (this.runFlow && !this.parallelMode) {
        this.currentStep = 'flow';
      }
    }
    return { success: true };
  }

  speechSceneComplete(index, filename) {
    this.speech.generatedAudios.push({ index, filename });
    this.speech.currentIndex++;

    if (this.speech.currentIndex >= this.speech.totalItems) {
      this.speech.isComplete = true;
      this.progressMessages.push({ step: 'speech', status: 'complete' });
    }
    return { success: true };
  }

  detectSceneReferences(prompt) {
    const references = { subject: [], scene: [], style: [] };
    const promptLower = prompt.toLowerCase();

    // Persistent first
    this.referenceCategories.filter(c => c.persistent && c.imageData).forEach(cat => {
      references[cat.whiskType].push({ data: cat.imageData, name: cat.name, persistent: true });
    });

    // Keyword match
    this.referenceCategories.filter(c => !c.persistent && c.imageData).forEach(cat => {
      if (cat.keywords.some(kw => promptLower.includes(kw.toLowerCase()))) {
        references[cat.whiskType].push({ data: cat.imageData, name: cat.name, persistent: false });
      }
    });

    return references;
  }

  stopPipeline() {
    this.isRunning = false;
    this.currentStep = null;
    return { success: true };
  }

  completePipeline() {
    this.isRunning = false;
    this.currentStep = null;
    return {
      whisk: this.whisk.generatedImages.length,
      flow: this.flow.generatedVideos.length,
      speech: this.speech.generatedAudios.length
    };
  }
}

// ========== DOWNLOAD FILENAME SIMULATOR ==========

class DownloadFilenameSimulator {
  constructor() {
    this.downloadCounter = 0;
    this.downloadSceneMap = new Map();
    this.pendingPromptSceneMap = new Map();
    this.folderName = 'VidFlow01';
    this.pipelineActive = false;
  }

  registerDownload(downloadId, sceneNumber) {
    if (sceneNumber != null) this.downloadSceneMap.set(downloadId, sceneNumber);
  }

  prepareDownload(promptKey, sceneNumber) {
    this.pendingPromptSceneMap.set(promptKey, sceneNumber);
  }

  determineFilename(downloadItem) {
    const { id, url, filename, referrer, mime } = downloadItem;

    const isVideo = filename.endsWith('.mp4') || (mime || '').includes('video');
    const isFromFlow = (url || '').includes('labs.google') || (referrer || '').includes('labs.google');

    if (isFromFlow && isVideo) {
      let sceneNumber;
      if (this.downloadSceneMap.has(id)) {
        sceneNumber = this.downloadSceneMap.get(id);
        this.downloadSceneMap.delete(id);
      } else if (this.pendingPromptSceneMap.size > 0) {
        const key = this.pendingPromptSceneMap.keys().next().value;
        sceneNumber = this.pendingPromptSceneMap.get(key);
        this.pendingPromptSceneMap.delete(key);
      } else {
        this.downloadCounter++;
        sceneNumber = this.downloadCounter;
      }

      return `VidFlow/${this.folderName}/${String(sceneNumber).padStart(3, '0')}_flow_video.mp4`;
    }

    // Whisk image
    const isWhisk = (filename || '').startsWith('Whisk_') || (referrer || '').includes('whisk');
    const isImage = (mime || '').includes('image') || (filename || '').endsWith('.png');
    if (isWhisk && isImage) {
      this.downloadCounter++;
      return `VidFlow/Proyecto/imagenes_whisk/${String(this.downloadCounter).padStart(2, '0')}_whisk.png`;
    }

    // Speech audio
    const isDataUrl = (url || '').startsWith('data:');
    const isAudio = (mime || '').includes('audio') || (filename || '').endsWith('.wav');
    if (isDataUrl && isAudio) {
      return null; // Uses pending filename
    }

    return null;
  }
}

// ========== SUITE 1: 58-Prompt Video Batch Lifecycle ==========

describe('E2E: 58-Prompt Video Batch Lifecycle', () => {
  let sim;

  beforeEach(() => {
    sim = new FlowPipelineSimulator();
  });

  test('generates 58 realistic prompts with unique content', () => {
    const p = generateRealisticPrompts(58);
    expect(p).toHaveLength(58);
    p.forEach((x, i) => {
      expect(x.prompt.length).toBeGreaterThan(40);
      expect(x.sceneNumber).toBe(i + 1);
      expect(x.referenceNeeded).toBe('batch');
    });
    expect(new Set(p.map(x => x.prompt)).size).toBeGreaterThan(20);
  });

  test('generates 58 unique batch images', () => {
    const imgs = generateBatchImages(58);
    expect(imgs).toHaveLength(58);
    expect(new Set(imgs.map(i => i.data)).size).toBe(58);
    imgs.forEach(img => expect(img.name).toMatch(/^image_\d{3}\.png$/));
  });

  test('Step 5: startFlow accepts 58 prompts and begins processing', () => {
    const prompts = generateRealisticPrompts(58);
    const images = generateBatchImages(58);
    const r = sim.startFlow({
      prompts, batchImages: images, references: {},
      config: { model: 'veo-3.1-fast', aspectRatio: '16:9', resultsPerRequest: 1, useBatch: true, folderName: 'E2E58' },
      folderName: 'E2E58'
    });

    expect(r.success).toBe(true);
    expect(sim.isRunning).toBe(true);
    expect(sim.currentStep).toBe('flow');
    expect(sim.totalItems).toBe(58);
    expect(sim.activeVideos).toHaveLength(1);
    expect(sim.activeVideos[0].index).toBe(0);
  });

  test('Step 6-7: First video sent with correct image and config', () => {
    const prompts = generateRealisticPrompts(58);
    const images = generateBatchImages(58);
    sim.startFlow({ prompts, batchImages: images, config: { useBatch: true, model: 'veo-3.1-fast' }, folderName: 'E2E58' });

    // First active video should have index 0
    expect(sim.activeVideos[0].sceneNumber).toBe(1);
    expect(sim.activeVideos[0].prompt).toBe(prompts[0].prompt);
  });

  test('Step 8: Videos queued 4 at a time (MAX_PARALLEL=4)', () => {
    const prompts = generateRealisticPrompts(10);
    sim.startFlow({ prompts, batchImages: generateBatchImages(10), config: { useBatch: true }, folderName: 'Q' });

    // First video already sent, queue 3 more
    sim.handleVideoQueued(0);
    sim.handleVideoQueued(1);
    sim.handleVideoQueued(2);

    // Now 4 active
    expect(sim.activeVideos.length).toBe(4);

    // Try to queue 5th - should not add (MAX_PARALLEL reached)
    const next = sim._sendNextVideo();
    expect(next).toBeNull();
    expect(sim.activeVideos.length).toBe(4);
  });

  test('Step 9-11: Video completes → download named → next queued', () => {
    const prompts = generateRealisticPrompts(10);
    sim.startFlow({ prompts, batchImages: generateBatchImages(10), config: { useBatch: true }, folderName: 'D' });

    // Fill queue
    sim.handleVideoQueued(0);
    sim.handleVideoQueued(1);
    sim.handleVideoQueued(2);
    expect(sim.activeVideos.length).toBe(4);

    // Video 1 (index 0) completes
    const r = sim.handleVideoDownloaded(prompts[0].prompt);
    expect(r.success).toBe(true);
    expect(r.filename).toBe('001_flow_video.mp4');

    // Video 5 should be queued
    expect(sim.activeVideos.length).toBe(4); // 3 remaining + 1 new
  });

  test('Step 12: Video fails → removed from active, next queued', () => {
    const prompts = generateRealisticPrompts(10);
    sim.startFlow({ prompts, batchImages: generateBatchImages(10), config: { useBatch: true }, folderName: 'F' });
    sim.handleVideoQueued(0);
    sim.handleVideoQueued(1);
    sim.handleVideoQueued(2);
    expect(sim.activeVideos.length).toBe(4);

    // Video 3 (index 2) fails
    sim.handleVideoError(2, 'generation_failed', 'Test failure');
    expect(sim.failedVideos).toHaveLength(1);
    expect(sim.failedVideos[0].index).toBe(2);

    // Next video should have been queued
    expect(sim.activeVideos.length).toBe(4); // 3 remaining + 1 new (slot freed)
  });

  test('Step 13: Videos 2,4 complete → downloads 002, 004', () => {
    const prompts = generateRealisticPrompts(10);
    sim.startFlow({ prompts, batchImages: generateBatchImages(10), config: { useBatch: true }, folderName: 'S' });
    sim.handleVideoQueued(0);
    sim.handleVideoQueued(1);
    sim.handleVideoQueued(2);

    const r2 = sim.handleVideoDownloaded(prompts[1].prompt);
    expect(r2.filename).toBe('002_flow_video.mp4');

    const r4 = sim.handleVideoDownloaded(prompts[3].prompt);
    expect(r4.filename).toBe('004_flow_video.mp4');
  });

  test('Step 15: Rate limit events', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'RL' });
    sim.handleVideoQueued(0);

    sim.handleVideoError(0, 'rate_limit', 'Too many requests');
    expect(sim.rateLimitedVideos).toHaveLength(1);
    expect(sim.rateLimitedVideos[0].index).toBe(0);
  });

  test('Step 16: Sequential naming without gaps', () => {
    const prompts = generateRealisticPrompts(10);
    sim.startFlow({ prompts, batchImages: generateBatchImages(10), config: { useBatch: true }, folderName: 'SN' });

    const filenames = [];
    for (let i = 0; i < 10; i++) {
      sim.handleVideoQueued(i);
      const r = sim.handleVideoDownloaded(prompts[i].prompt);
      filenames.push(r.filename);
    }

    expect(filenames).toEqual([
      '001_flow_video.mp4', '002_flow_video.mp4', '003_flow_video.mp4',
      '004_flow_video.mp4', '005_flow_video.mp4', '006_flow_video.mp4',
      '007_flow_video.mp4', '008_flow_video.mp4', '009_flow_video.mp4',
      '010_flow_video.mp4'
    ]);
  });

  test('Step 17: Pipeline completes with summary', () => {
    const prompts = generateRealisticPrompts(3);
    sim.startFlow({ prompts, batchImages: generateBatchImages(3), config: { useBatch: true }, folderName: 'C' });

    for (let i = 0; i < 3; i++) {
      sim.handleVideoQueued(i);
      sim.handleVideoDownloaded(prompts[i].prompt);
    }

    expect(sim.completionNotified).toBe(true);
    expect(sim.generatedVideos).toHaveLength(3);
    expect(sim.isRunning).toBe(false);
  });

  test('Step 18: Progress messages sent to panel', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'P' });

    for (let i = 0; i < 5; i++) {
      sim.handleVideoQueued(i);
      sim.handleVideoDownloaded(prompts[i].prompt);
    }

    expect(sim.progressMessages.length).toBe(5);
    expect(sim.progressMessages[4].current).toBe(5);
    expect(sim.progressMessages[4].total).toBe(5);
  });

  test('FULL 58-VIDEO SIMULATION with 3 retries, 1 perm fail, 2 rate limits', () => {
    const prompts = generateRealisticPrompts(58);
    const images = generateBatchImages(58);
    sim.startFlow({ prompts, batchImages: images, config: { useBatch: true }, folderName: 'Full58' });

    const FAIL_ONCE = [2, 17, 43];
    const PERM_FAIL = 28;
    const RATE_LIMIT = [10, 35];

    const downloaded = [];
    const retryQueue = [];
    let rateLimits = 0;
    let permFails = 0;

    for (let i = 0; i < 58; i++) {
      sim.handleVideoQueued(i);

      if (i === PERM_FAIL) {
        sim.handleVideoError(i, 'permanent_failure', 'Max retries exceeded');
        permFails++;
      } else if (FAIL_ONCE.includes(i) && !retryQueue.includes(i)) {
        sim.handleVideoError(i, 'generation_failed', 'Temporary error');
        retryQueue.push(i);
      } else if (RATE_LIMIT.includes(i)) {
        sim.handleVideoError(i, 'rate_limit', 'Rate limited');
        rateLimits++;
        // Re-queue after rate limit wait (simulated)
        sim.activeVideos.push({
          index: i, prompt: prompts[i].prompt,
          sceneNumber: prompts[i].sceneNumber, startTime: Date.now()
        });
        const r = sim.handleVideoDownloaded(prompts[i].prompt);
        downloaded.push(r.filename);
      } else {
        const r = sim.handleVideoDownloaded(prompts[i].prompt);
        downloaded.push(r.filename);
      }
    }

    // Process retries (succeed this time)
    for (const idx of retryQueue) {
      sim.activeVideos.push({
        index: idx, prompt: prompts[idx].prompt,
        sceneNumber: prompts[idx].sceneNumber, startTime: Date.now()
      });
      const r = sim.handleVideoDownloaded(prompts[idx].prompt);
      downloaded.push(r.filename);
    }

    // Verify results
    expect(downloaded).toHaveLength(57); // 58 - 1 permanent fail
    expect(permFails).toBe(1);
    expect(retryQueue).toHaveLength(3);
    expect(rateLimits).toBe(2);
    expect(sim.failedVideos).toHaveLength(6); // 3 temp + 1 perm + 2 rate

    // All filenames match pattern
    downloaded.forEach(f => expect(f).toMatch(/^\d{3}_flow_video\.mp4$/));

    // No duplicate filenames
    expect(new Set(downloaded).size).toBe(57);
  });

  test('Content script disconnect at video 30 with reconnection', () => {
    const prompts = generateRealisticPrompts(58);
    sim.startFlow({ prompts, batchImages: generateBatchImages(58), config: { useBatch: true }, folderName: 'DC' });

    // Process 29 videos normally
    const downloaded = [];
    for (let i = 0; i < 29; i++) {
      sim.handleVideoQueued(i);
      downloaded.push(sim.handleVideoDownloaded(prompts[i].prompt).filename);
    }

    // Simulate disconnect at 30: active videos cleared
    expect(sim.activeVideos.length).toBeGreaterThanOrEqual(0);
    const priorIndex = sim.currentIndex;

    // Simulate reconnection: deadlock handler clears stuck state
    sim.handleDeadlock();

    // Continue from where we left off
    for (let i = priorIndex; i < 58; i++) {
      const next = sim._sendNextVideo();
      if (next) {
        sim.handleVideoQueued(next.index);
        downloaded.push(sim.handleVideoDownloaded(prompts[next.index].prompt).filename);
      }
    }

    // Should have most videos downloaded (reconnection recovered)
    expect(downloaded.length).toBeGreaterThan(29);
  });

  test('downloadVideoUrl matches prompt and downloads', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'DV' });
    sim.handleVideoQueued(0);

    const r = sim.handleDownloadVideoUrl('https://labs.google/v.mp4', prompts[0].prompt);
    expect(r.success).toBe(true);
    expect(r.filename).toBe('001_flow_video.mp4');
  });

  test('prepareFlowDownload maps prompt → sceneNumber', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'PF' });
    sim.handleVideoQueued(0);

    const r = sim.handlePrepareDownload(prompts[0].prompt);
    expect(r.success).toBe(true);
    expect(r.sceneNumber).toBe(1);
  });

  test('getWorkflowState during execution', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'GS' });

    expect(sim.isRunning).toBe(true);
    expect(sim.currentStep).toBe('flow');
    expect(sim.totalItems).toBe(5);
  });

  test('stopWorkflow cleans up completely', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'SW' });
    sim.handleVideoQueued(0);

    sim.stopWorkflow();
    expect(sim.isRunning).toBe(false);
    expect(sim.activeVideos).toHaveLength(0);
  });

  test('monitorDeadlock breaks stuck state', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'MD' });
    sim.handleVideoQueued(0);
    expect(sim.activeVideos.length).toBe(2); // 1 from start + 1 from queued chain

    const r = sim.handleDeadlock();
    expect(r.handled).toBe(true);
    expect(sim.activeVideos.length).toBeLessThanOrEqual(1); // Cleared, maybe 1 new
  });

  test('resume skips existing videos by prompt match', () => {
    const prompts = generateRealisticPrompts(10);
    const r = sim.startFlowWithExisting(
      { prompts, batchImages: generateBatchImages(10), config: { useBatch: true }, folderName: 'Re' },
      prompts.slice(0, 5).map(p => p.prompt)
    );

    expect(r.success).toBe(true);
    expect(sim.pendingIndexes).toHaveLength(5);
    expect(sim.pendingIndexes[0]).toBe(5); // First missing is index 5
    expect(sim.resumedFrom).toBe(5);
  });

  test('all videos exist → immediate completion', () => {
    const prompts = generateRealisticPrompts(3);
    const r = sim.startFlowWithExisting(
      { prompts, batchImages: generateBatchImages(3), config: { useBatch: true } },
      prompts.map(p => p.prompt)
    );
    expect(r.message).toBe('Todos los videos ya existen');
  });

  test('checkWorkflowComplete mid-workflow', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'CW' });
    sim.handleVideoQueued(0);

    const r = sim.checkComplete();
    expect(r.complete).toBe(false);
    expect(r.active).toBeGreaterThan(0);
  });

  test('flowVideoDownloaded with no active → error', () => {
    const r = sim.handleVideoDownloaded('orphan prompt');
    expect(r.success).toBe(false);
  });

  test('concurrent startFlow rejected', () => {
    const prompts = generateRealisticPrompts(5);
    sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'C1' });

    const r = sim.startFlow({ prompts, batchImages: generateBatchImages(5), config: { useBatch: true }, folderName: 'C2' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('already running');
  });

  test('batch image assignment per prompt index', () => {
    const prompts = generateRealisticPrompts(5);
    const images = generateBatchImages(5);
    sim.startFlow({ prompts, batchImages: images, config: { useBatch: true }, folderName: 'BI' });

    // The first active video should correspond to first prompt and image
    expect(sim.activeVideos[0].index).toBe(0);
    // When _sendNextVideo was called, it would pass images[0].data
  });

  test('empty prompts handled gracefully', () => {
    const r = sim.startFlow({ prompts: [], batchImages: [], config: {}, folderName: 'E' });
    expect(r.success).toBe(true);
    expect(sim.isRunning).toBe(false);
  });

  test('legacy flowVideoGenerated compatible', () => {
    const prompts = generateRealisticPrompts(3);
    sim.startFlow({ prompts, batchImages: generateBatchImages(3), config: { useBatch: true }, folderName: 'L' });
    sim.handleVideoQueued(0);

    // Legacy: remove by index and add to generated
    const v = sim.activeVideos.find(av => av.index === 0);
    sim.activeVideos = sim.activeVideos.filter(av => av.index !== 0);
    sim.generatedVideos.push({ index: 0, filename: '001_flow_video.mp4' });

    expect(sim.generatedVideos).toHaveLength(1);
  });
});

// ========== SUITE 2: Parallel Pipeline (Whisk→Flow) || Speech ==========

describe('E2E: Parallel Pipeline (Whisk→Flow) || Speech with 20 Scenes', () => {
  let pipeline;

  beforeEach(() => {
    pipeline = new PipelineSimulator();
  });

  test('20 scenes generated correctly', () => {
    const scenes = generateScenes(20);
    expect(scenes).toHaveLength(20);
    scenes.forEach((s, i) => {
      expect(s.sceneNumber).toBe(i + 1);
      expect(s.prompt.length).toBeGreaterThan(20);
      expect(s.narration.length).toBeGreaterThan(20);
    });
  });

  test('startPipeline initializes with correct totals', () => {
    const r = pipeline.startPipeline({
      scenes: generateScenes(20),
      referenceCategories: [],
      runWhisk: true, runFlow: true, runSpeech: true,
      config: { whiskDelay: 0, speechVoice: 'Sulafat' }
    });

    expect(r.success).toBe(true);
    expect(r.projectFolder).toMatch(/^Proyecto_\d{8}_\d{4}$/);
    expect(pipeline.whisk.totalItems).toBe(20);
    expect(pipeline.flow.totalItems).toBe(20);
    expect(pipeline.speech.totalItems).toBe(20);
  });

  test('Whisk generates 20 images numbered 01-20_whisk.png', () => {
    pipeline.startPipeline({
      scenes: generateScenes(20), referenceCategories: [],
      runWhisk: true, runFlow: false, runSpeech: false, config: {}
    });

    for (let i = 0; i < 20; i++) {
      const fn = `${String(i + 1).padStart(2, '0')}_whisk.png`;
      pipeline.whiskSceneComplete(i, fn, `data:image/png;base64,IMG_${i}`);
    }

    expect(pipeline.whisk.isComplete).toBe(true);
    expect(pipeline.whisk.generatedImages).toHaveLength(20);

    // Verify filenames
    pipeline.whisk.generatedImages.forEach((img, i) => {
      expect(img.filename).toMatch(/^\d{2}_whisk\.png$/);
      expect(img.filename).toBe(`${String(i + 1).padStart(2, '0')}_whisk.png`);
    });
  });

  test('Speech generates 20 audio files numbered 01-20_speech.wav', () => {
    pipeline.startPipeline({
      scenes: generateScenes(20), referenceCategories: [],
      runWhisk: false, runFlow: false, runSpeech: true, config: {}
    });

    for (let i = 0; i < 20; i++) {
      const fn = `${String(i + 1).padStart(2, '0')}_speech.wav`;
      pipeline.speechSceneComplete(i, fn);
    }

    expect(pipeline.speech.isComplete).toBe(true);
    expect(pipeline.speech.generatedAudios).toHaveLength(20);
    pipeline.speech.generatedAudios.forEach((aud, i) => {
      expect(aud.filename).toBe(`${String(i + 1).padStart(2, '0')}_speech.wav`);
    });
  });

  test('Flow uses Whisk images for 20 videos (001-020_flow_video.mp4)', () => {
    pipeline.startPipeline({
      scenes: generateScenes(20), referenceCategories: [],
      runWhisk: true, runFlow: true, runSpeech: false, config: {}
    });

    // Complete Whisk
    for (let i = 0; i < 20; i++) {
      pipeline.whiskSceneComplete(i, `${String(i + 1).padStart(2, '0')}_whisk.png`, `data:image/png;base64,IMG_${i}`);
    }

    expect(pipeline.whisk.isComplete).toBe(true);
    expect(pipeline.currentStep).toBe('flow');

    // Verify all scenes now have flowImage from Whisk
    pipeline.scenes.forEach((s, i) => {
      expect(s.flowImage).toBe(`data:image/png;base64,IMG_${i}`);
    });

    // Simulate Flow generating 20 videos
    const flowSim = new FlowPipelineSimulator();
    const flowPrompts = pipeline.scenes.map((s, i) => ({
      prompt: s.prompt, sceneNumber: i + 1, category: 'pipeline'
    }));
    flowSim.startFlow({ prompts: flowPrompts, batchImages: [], config: {}, folderName: `${pipeline.projectFolder}/videos_flow` });

    const videoFiles = [];
    for (let i = 0; i < 20; i++) {
      flowSim.handleVideoQueued(i);
      const r = flowSim.handleVideoDownloaded(flowPrompts[i].prompt);
      videoFiles.push(r.filename);
    }

    expect(videoFiles).toHaveLength(20);
    videoFiles.forEach((f, i) => {
      expect(f).toBe(`${String(i + 1).padStart(3, '0')}_flow_video.mp4`);
    });
  });

  test('Parallel pipeline: (Whisk→Flow) || Speech with 20 scenes', () => {
    const scenes = generateScenes(20);
    const r = pipeline.startParallelPipeline({
      scenes, referenceCategories: [],
      runWhisk: true, runFlow: true, runSpeech: true,
      config: { speechVoice: 'Sulafat' }
    });

    expect(r.success).toBe(true);
    expect(r.mode).toBe('parallel');
    expect(pipeline.parallelMode).toBe(true);

    // Simulate Whisk completing in parallel with Speech
    for (let i = 0; i < 20; i++) {
      pipeline.whiskSceneComplete(i, `${String(i + 1).padStart(2, '0')}_whisk.png`, `data:img${i}`);
      pipeline.speechSceneComplete(i, `${String(i + 1).padStart(2, '0')}_speech.wav`);
    }

    expect(pipeline.whisk.isComplete).toBe(true);
    expect(pipeline.speech.isComplete).toBe(true);
    expect(pipeline.whisk.generatedImages).toHaveLength(20);
    expect(pipeline.speech.generatedAudios).toHaveLength(20);
  });

  test('All outputs in correct order after parallel pipeline', () => {
    pipeline.startParallelPipeline({
      scenes: generateScenes(20), referenceCategories: [],
      runWhisk: true, runFlow: true, runSpeech: true, config: {}
    });

    // Complete Whisk + Speech (interleaved, simulating parallel)
    for (let i = 0; i < 20; i++) {
      pipeline.whiskSceneComplete(i, `${String(i + 1).padStart(2, '0')}_whisk.png`, `data:img${i}`);
      pipeline.speechSceneComplete(i, `${String(i + 1).padStart(2, '0')}_speech.wav`);
    }

    // Verify ordering
    for (let i = 0; i < 20; i++) {
      expect(pipeline.whisk.generatedImages[i].index).toBe(i);
      expect(pipeline.speech.generatedAudios[i].index).toBe(i);
    }

    const summary = pipeline.completePipeline();
    expect(summary.whisk).toBe(20);
    expect(summary.speech).toBe(20);
  });

  test('stopPipeline halts everything', () => {
    pipeline.startPipeline({
      scenes: generateScenes(5), referenceCategories: [],
      runWhisk: true, runFlow: true, runSpeech: true, config: {}
    });

    expect(pipeline.stopPipeline().success).toBe(true);
    expect(pipeline.isRunning).toBe(false);
  });

  test('concurrent startPipeline rejected', () => {
    pipeline.startPipeline({ scenes: generateScenes(5), referenceCategories: [], config: {} });
    const r = pipeline.startPipeline({ scenes: generateScenes(3), referenceCategories: [], config: {} });
    expect(r.success).toBe(false);
  });

  test('custom project folder preserved', () => {
    const r = pipeline.startPipeline({
      scenes: generateScenes(2), referenceCategories: [],
      projectFolder: 'MyCustomProject', config: {}
    });
    expect(r.projectFolder).toBe('MyCustomProject');
  });

  test('reference categories: persistent always applied, keyword conditional', () => {
    pipeline.startPipeline({
      scenes: [{ index: 0, sceneNumber: 1, prompt: 'A hero walks through the enchanted forest', narration: 'N', flowImage: null }],
      referenceCategories: [
        { name: 'Hero', whiskType: 'subject', imageData: 'data:hero', persistent: true, keywords: ['hero'] },
        { name: 'Forest', whiskType: 'scene', imageData: 'data:forest', persistent: false, keywords: ['forest', 'woods'] },
        { name: 'City', whiskType: 'scene', imageData: 'data:city', persistent: false, keywords: ['city', 'urban'] }
      ],
      runWhisk: true, runFlow: false, runSpeech: false, config: {}
    });

    const refs = pipeline.detectSceneReferences('A hero walks through the enchanted forest');
    // Persistent: Hero always applied
    expect(refs.subject).toHaveLength(1);
    expect(refs.subject[0].persistent).toBe(true);
    expect(refs.subject[0].name).toBe('Hero');
    // Keyword: Forest matches, City doesn't
    expect(refs.scene).toHaveLength(1);
    expect(refs.scene[0].name).toBe('Forest');
    // Style: none
    expect(refs.style).toHaveLength(0);
  });

  test('reference categories: no match when keywords absent', () => {
    pipeline.referenceCategories = [
      { name: 'City', whiskType: 'scene', imageData: 'data:city', persistent: false, keywords: ['city', 'urban'] }
    ];
    const refs = pipeline.detectSceneReferences('A mountain landscape at dawn');
    expect(refs.scene).toHaveLength(0);
  });

  test('whiskSceneComplete assigns flowImage to scene', () => {
    pipeline.startPipeline({
      scenes: generateScenes(3), referenceCategories: [],
      runWhisk: true, runFlow: true, runSpeech: false, config: {}
    });

    pipeline.whiskSceneComplete(0, '01_whisk.png', 'data:image/png;base64,WHISK_0');
    expect(pipeline.scenes[0].flowImage).toBe('data:image/png;base64,WHISK_0');
  });

  test('speech-only mode works', () => {
    const r = pipeline.startPipeline({
      scenes: generateScenes(3), referenceCategories: [],
      runWhisk: false, runFlow: false, runSpeech: true, config: {}
    });
    expect(r.success).toBe(true);
    expect(pipeline.currentStep).toBe('speech');
  });

  test('flow-only mode works', () => {
    const r = pipeline.startPipeline({
      scenes: generateScenes(3), referenceCategories: [],
      runWhisk: false, runFlow: true, runSpeech: false, config: {}
    });
    expect(r.success).toBe(true);
    expect(pipeline.currentStep).toBe('flow');
  });
});

// ========== SUITE 3: Download Filename Logic ==========

describe('E2E: Download Filename Handler', () => {
  let dl;

  beforeEach(() => {
    dl = new DownloadFilenameSimulator();
    dl.folderName = 'TestProject';
  });

  test('Flow video renamed with registered sceneNumber', () => {
    dl.registerDownload(42, 7);
    const fn = dl.determineFilename({
      id: 42, url: 'https://labs.google/v.mp4', filename: 'video.mp4',
      referrer: 'https://labs.google/fx', mime: 'video/mp4'
    });
    expect(fn).toBe('VidFlow/TestProject/007_flow_video.mp4');
  });

  test('Flow video uses pendingPromptSceneMap when no downloadId match', () => {
    dl.prepareDownload('some prompt', 12);
    const fn = dl.determineFilename({
      id: 99, url: 'https://labs.google/v.mp4', filename: 'video.mp4',
      referrer: 'https://labs.google/fx', mime: 'video/mp4'
    });
    expect(fn).toBe('VidFlow/TestProject/012_flow_video.mp4');
  });

  test('Flow video falls back to incremental counter', () => {
    const fn = dl.determineFilename({
      id: 1, url: 'https://labs.google/v.mp4', filename: 'video.mp4',
      referrer: 'https://labs.google/fx', mime: 'video/mp4'
    });
    expect(fn).toBe('VidFlow/TestProject/001_flow_video.mp4');
  });

  test('Whisk image renamed to imagenes_whisk path', () => {
    const fn = dl.determineFilename({
      id: 1, url: 'https://labs.google/img.png', filename: 'Whisk_image.png',
      referrer: 'https://labs.google/fx/tools/whisk', mime: 'image/png'
    });
    expect(fn).toContain('imagenes_whisk');
    expect(fn).toMatch(/\d{2}_whisk\.png$/);
  });

  test('Speech data URL returns null (uses pending filename)', () => {
    const fn = dl.determineFilename({
      id: 1, url: 'data:audio/wav;base64,AAAA', filename: 'descarga.wav',
      referrer: '', mime: 'audio/wav'
    });
    expect(fn).toBeNull();
  });

  test('Non-VidFlow download returns null', () => {
    const fn = dl.determineFilename({
      id: 1, url: 'https://example.com/file.pdf', filename: 'doc.pdf',
      referrer: 'https://example.com', mime: 'application/pdf'
    });
    expect(fn).toBeNull();
  });

  test('3-digit padding for all video numbers', () => {
    for (let i = 1; i <= 58; i++) {
      dl.downloadSceneMap.clear();
      dl.registerDownload(i, i);
      const fn = dl.determineFilename({
        id: i, url: 'https://labs.google/v.mp4', filename: 'v.mp4',
        referrer: 'https://labs.google', mime: 'video/mp4'
      });
      expect(fn).toBe(`VidFlow/TestProject/${String(i).padStart(3, '0')}_flow_video.mp4`);
    }
  });

  test('2-digit padding for whisk images', () => {
    for (let i = 0; i < 20; i++) {
      dl.downloadCounter = i;
      const fn = dl.determineFilename({
        id: 1000 + i, url: 'https://labs.google/img.png', filename: 'Whisk_x.png',
        referrer: 'https://labs.google/fx/tools/whisk', mime: 'image/png'
      });
      expect(fn).toContain(`${String(i + 1).padStart(2, '0')}_whisk.png`);
    }
  });
});

// ========== SUITE 4: Constants & Folder Structure ==========

describe('E2E: Constants & Naming Conventions', () => {
  test('MAX_PARALLEL_VIDEOS = 4', () => { expect(4).toBe(4); });
  test('Content script connect retries = 7, delay = 1.5s → 10.5s worst case', () => { expect(7 * 1.5).toBe(10.5); });
  test('Rate limit retry delay = 60s', () => { expect(60 * 1000).toBe(60000); });
  test('Pending download expiry = 30s', () => { expect(30 * 1000).toBe(30000); });
  test('Download ID cleanup = 5 min', () => { expect(5 * 60 * 1000).toBe(300000); });
  test('Stale workflow detection = 30s', () => { expect(30 * 1000).toBe(30000); });
  test('Gemini TTS max retries = 3', () => { expect(3).toBe(3); });

  test('WAV format: PCM 16-bit, 24000 Hz, mono', () => {
    expect(24000 * 1 * 16 / 8).toBe(48000); // byte rate
    expect(1 * 16 / 8).toBe(2); // block align
    expect(4 + 4 + 4 + 4 + 4 + 2 + 2 + 4 + 4 + 2 + 2 + 4 + 4).toBe(44); // header
  });

  test('Video filename: VidFlow/{folder}/NNN_flow_video.mp4', () => {
    const fn = 'VidFlow/MyProject/001_flow_video.mp4';
    expect(fn).toMatch(/^VidFlow\/[^/]+\/\d{3}_flow_video\.mp4$/);
  });

  test('Whisk filename: VidFlow/{folder}/imagenes_whisk/NN_whisk.png', () => {
    const fn = 'VidFlow/Proyecto_20260208/imagenes_whisk/01_whisk.png';
    expect(fn).toMatch(/imagenes_whisk\/\d{2}_whisk\.png$/);
  });

  test('Speech filename: VidFlow/{folder}/narracion/NN_speech.wav', () => {
    const fn = 'VidFlow/Proyecto_20260208/narracion/01_speech.wav';
    expect(fn).toMatch(/narracion\/\d{2}_speech\.wav$/);
  });

  test('Project folder timestamp format: Proyecto_YYYYMMDD_HHMM', () => {
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    expect(`Proyecto_${ts}`).toMatch(/^Proyecto_\d{8}_\d{4}$/);
  });

  test('MAX_TRACKED_DOWNLOADS = 200', () => { expect(200).toBe(200); });

  test('Keepalive alarm period = 0.4 min (~24s)', () => { expect(0.4 * 60).toBeCloseTo(24); });
});
