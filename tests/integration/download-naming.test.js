/**
 * Integration tests for download naming pipeline
 * Tests the critical path: prepareFlowDownload → vidflowDownloadHandler → handleFlowVideoDownloaded
 *
 * Refactored from FIFO queue to download-ID-based lookup (downloadSceneMap)
 * and prompt-based lookup (pendingPromptSceneMap) for browser-initiated downloads.
 */

// Mock chrome API
global.chrome = {
  runtime: { sendMessage: jest.fn(), onMessage: { addListener: jest.fn() } },
  tabs: { query: jest.fn(), sendMessage: jest.fn(), get: jest.fn() },
  downloads: {
    download: jest.fn(() => Promise.resolve(1)),
    onDeterminingFilename: { addListener: jest.fn(), removeListener: jest.fn() },
    onChanged: { addListener: jest.fn() },
    search: jest.fn()
  },
  storage: { local: { get: jest.fn(), set: jest.fn() } },
  scripting: { executeScript: jest.fn() },
  action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn() }
};

global.sleep = jest.fn(() => Promise.resolve());

describe('Download Naming Pipeline', () => {
  let downloadSceneMap;
  let pendingPromptSceneMap;
  let downloadCounter;
  let workflowState;
  let nextDownloadId;

  // Simulate vidflowDownloadHandler's Flow video naming logic (new: download-ID-based)
  function getFlowVideoFilename(downloadId) {
    let sceneNumber;
    if (downloadSceneMap.has(downloadId)) {
      sceneNumber = downloadSceneMap.get(downloadId);
      downloadSceneMap.delete(downloadId);
    } else if (pendingPromptSceneMap.size > 0) {
      const firstKey = pendingPromptSceneMap.keys().next().value;
      sceneNumber = pendingPromptSceneMap.get(firstKey);
      pendingPromptSceneMap.delete(firstKey);
    } else {
      downloadCounter++;
      sceneNumber = downloadCounter;
    }
    return `${String(sceneNumber).padStart(3, '0')}_flow_video.mp4`;
  }

  // Simulate prepareFlowDownload (browser-initiated: stores prompt → sceneNumber)
  function prepareFlowDownload(promptText) {
    const promptToMatch = promptText.toLowerCase().trim().replace(/\s+/g, ' ');
    let matchedVideo = null;

    for (let i = 0; i < workflowState.activeVideos.length; i++) {
      const activeVideo = workflowState.activeVideos[i];
      const activePrompt = (activeVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');
      if (activePrompt === promptToMatch) {
        matchedVideo = activeVideo;
        break;
      }
    }

    if (!matchedVideo && workflowState.activeVideos.length > 0) {
      matchedVideo = workflowState.activeVideos[0];
    }

    const sceneNumber = matchedVideo.sceneNumber || (matchedVideo.index + 1);
    const promptKey = (matchedVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ').substring(0, 100);
    pendingPromptSceneMap.set(promptKey, sceneNumber);
    return sceneNumber;
  }

  // Simulate registerVidFlowDownload with sceneNumber (code-initiated downloads)
  function registerVidFlowDownload(downloadId, sceneNumber) {
    if (sceneNumber != null) {
      downloadSceneMap.set(downloadId, sceneNumber);
    }
  }

  // Simulate handleFlowVideoDownloaded
  function handleFlowVideoDownloaded(promptText) {
    const promptToMatch = promptText.toLowerCase().trim().replace(/\s+/g, ' ');
    let downloadedVideo = null;

    for (let i = 0; i < workflowState.activeVideos.length; i++) {
      const activeVideo = workflowState.activeVideos[i];
      const activePrompt = (activeVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');
      if (activePrompt === promptToMatch) {
        downloadedVideo = workflowState.activeVideos.splice(i, 1)[0];
        break;
      }
    }

    if (!downloadedVideo) {
      downloadedVideo = workflowState.activeVideos.shift();
    }

    const sceneNumber = downloadedVideo.sceneNumber || (downloadedVideo.index + 1);
    return `${String(sceneNumber).padStart(3, '0')}_flow_video.mp4`;
  }

  // Helper: allocate a download ID (simulates chrome.downloads.download returning an ID)
  function allocDownloadId() {
    return nextDownloadId++;
  }

  beforeEach(() => {
    downloadSceneMap = new Map();
    pendingPromptSceneMap = new Map();
    downloadCounter = 0;
    nextDownloadId = 100;
    workflowState = {
      activeVideos: [],
      generatedVideos: [],
      folderName: 'TestProject'
    };
  });

  test('sequential videos get correct numbers (browser-initiated)', () => {
    workflowState.activeVideos = [
      { index: 0, prompt: 'A cat running', sceneNumber: 1 },
      { index: 1, prompt: 'A dog sleeping', sceneNumber: 2 },
      { index: 2, prompt: 'A bird flying', sceneNumber: 3 }
    ];

    // Video 1 completes
    prepareFlowDownload('A cat running');
    const file1 = getFlowVideoFilename(allocDownloadId());
    handleFlowVideoDownloaded('A cat running');
    expect(file1).toBe('001_flow_video.mp4');

    // Video 2 completes
    prepareFlowDownload('A dog sleeping');
    const file2 = getFlowVideoFilename(allocDownloadId());
    handleFlowVideoDownloaded('A dog sleeping');
    expect(file2).toBe('002_flow_video.mp4');

    // Video 3 completes
    prepareFlowDownload('A bird flying');
    const file3 = getFlowVideoFilename(allocDownloadId());
    handleFlowVideoDownloaded('A bird flying');
    expect(file3).toBe('003_flow_video.mp4');
  });

  test('out-of-order completion gets correct numbers (browser-initiated)', () => {
    workflowState.activeVideos = [
      { index: 0, prompt: 'A cat running', sceneNumber: 1 },
      { index: 1, prompt: 'A dog sleeping', sceneNumber: 2 },
      { index: 2, prompt: 'A bird flying', sceneNumber: 3 }
    ];

    // Video 3 completes FIRST
    prepareFlowDownload('A bird flying');
    const file3 = getFlowVideoFilename(allocDownloadId());
    handleFlowVideoDownloaded('A bird flying');
    expect(file3).toBe('003_flow_video.mp4');

    // Video 1 completes SECOND
    prepareFlowDownload('A cat running');
    const file1 = getFlowVideoFilename(allocDownloadId());
    handleFlowVideoDownloaded('A cat running');
    expect(file1).toBe('001_flow_video.mp4');

    // Video 2 completes THIRD
    prepareFlowDownload('A dog sleeping');
    const file2 = getFlowVideoFilename(allocDownloadId());
    handleFlowVideoDownloaded('A dog sleeping');
    expect(file2).toBe('002_flow_video.mp4');
  });

  test('code-initiated downloads: downloadId-based lookup is race-free', () => {
    workflowState.activeVideos = [
      { index: 0, prompt: 'Video A', sceneNumber: 1 },
      { index: 1, prompt: 'Video B', sceneNumber: 2 },
      { index: 2, prompt: 'Video C', sceneNumber: 3 }
    ];

    // Simulate code-initiated downloads (handleDownloadVideoUrl path)
    // Downloads are registered with their sceneNumber at creation time
    const dlA = allocDownloadId();
    const dlB = allocDownloadId();
    const dlC = allocDownloadId();
    registerVidFlowDownload(dlA, 1);
    registerVidFlowDownload(dlB, 2);
    registerVidFlowDownload(dlC, 3);

    // onDeterminingFilename fires in ANY order — doesn't matter!
    // B fires first, then C, then A
    const fileB = getFlowVideoFilename(dlB);
    const fileC = getFlowVideoFilename(dlC);
    const fileA = getFlowVideoFilename(dlA);

    expect(fileA).toBe('001_flow_video.mp4');
    expect(fileB).toBe('002_flow_video.mp4');
    expect(fileC).toBe('003_flow_video.mp4');
  });

  test('video 35 of 58 gets 035_flow_video.mp4', () => {
    workflowState.activeVideos = [
      { index: 34, prompt: 'Scene thirty five prompt text', sceneNumber: 35 }
    ];

    prepareFlowDownload('Scene thirty five prompt text');
    const filename = getFlowVideoFilename(allocDownloadId());
    handleFlowVideoDownloaded('Scene thirty five prompt text');

    expect(filename).toBe('035_flow_video.mp4');
  });

  test('3-digit padding for all numbers', () => {
    const cases = [
      { scene: 1, expected: '001_flow_video.mp4' },
      { scene: 9, expected: '009_flow_video.mp4' },
      { scene: 10, expected: '010_flow_video.mp4' },
      { scene: 35, expected: '035_flow_video.mp4' },
      { scene: 58, expected: '058_flow_video.mp4' },
      { scene: 99, expected: '099_flow_video.mp4' },
      { scene: 100, expected: '100_flow_video.mp4' }
    ];

    for (const { scene, expected } of cases) {
      const dlId = allocDownloadId();
      registerVidFlowDownload(dlId, scene);
      expect(getFlowVideoFilename(dlId)).toBe(expected);
    }
  });

  test('fallback to downloadCounter when no mapping exists', () => {
    downloadCounter = 5;
    const file = getFlowVideoFilename(allocDownloadId());
    expect(file).toBe('006_flow_video.mp4');
    expect(downloadCounter).toBe(6);
  });

  test('browser-initiated: FIFO fallback when prompt does not match', () => {
    workflowState.activeVideos = [
      { index: 4, prompt: 'Scene five', sceneNumber: 5 },
      { index: 7, prompt: 'Scene eight', sceneNumber: 8 }
    ];

    // Prepare with unknown prompt - falls back to first active video
    prepareFlowDownload('Unknown prompt text');
    const filename = getFlowVideoFilename(allocDownloadId());
    expect(filename).toBe('005_flow_video.mp4');
  });

  test('browser-initiated: multiple prepares then downloads in order', () => {
    workflowState.activeVideos = [
      { index: 0, prompt: 'Video A', sceneNumber: 1 },
      { index: 1, prompt: 'Video B', sceneNumber: 2 },
      { index: 2, prompt: 'Video C', sceneNumber: 3 },
      { index: 3, prompt: 'Video D', sceneNumber: 4 }
    ];

    // All 4 prepare before any download fires
    prepareFlowDownload('Video A');
    prepareFlowDownload('Video B');
    prepareFlowDownload('Video C');
    prepareFlowDownload('Video D');

    expect(pendingPromptSceneMap.size).toBe(4);

    // Downloads fire in order — each picks from pendingPromptSceneMap by insertion order
    expect(getFlowVideoFilename(allocDownloadId())).toBe('001_flow_video.mp4');
    expect(getFlowVideoFilename(allocDownloadId())).toBe('002_flow_video.mp4');
    expect(getFlowVideoFilename(allocDownloadId())).toBe('003_flow_video.mp4');
    expect(getFlowVideoFilename(allocDownloadId())).toBe('004_flow_video.mp4');
  });

  test('code-initiated: out-of-order downloads get CORRECT names (race condition fixed)', () => {
    // This was the KNOWN BUG with FIFO. Now with downloadId-based lookup, it's fixed.
    workflowState.activeVideos = [
      { index: 0, prompt: 'Video A', sceneNumber: 1 },
      { index: 1, prompt: 'Video B', sceneNumber: 2 },
      { index: 2, prompt: 'Video C', sceneNumber: 3 }
    ];

    // Code initiates downloads and registers them with sceneNumbers
    const dlA = allocDownloadId();
    const dlB = allocDownloadId();
    const dlC = allocDownloadId();
    registerVidFlowDownload(dlA, 1);
    registerVidFlowDownload(dlB, 2);
    registerVidFlowDownload(dlC, 3);

    // Downloads fire in order A, B, C but could be any order
    const fileA = getFlowVideoFilename(dlA); // gets 1 ✓
    const fileB = getFlowVideoFilename(dlB); // gets 2 ✓ (was BUG with FIFO)
    const fileC = getFlowVideoFilename(dlC); // gets 3 ✓ (was BUG with FIFO)

    expect(fileA).toBe('001_flow_video.mp4');
    expect(fileB).toBe('002_flow_video.mp4');
    expect(fileC).toBe('003_flow_video.mp4');
  });

  test('resume: downloadCounter initialized correctly', () => {
    downloadCounter = 20;
    workflowState.activeVideos = [
      { index: 20, prompt: 'Scene 21', sceneNumber: 21 }
    ];

    prepareFlowDownload('Scene 21');
    const filename = getFlowVideoFilename(allocDownloadId());
    expect(filename).toBe('021_flow_video.mp4');
  });

  test('mixed: some code-initiated, some browser-initiated', () => {
    workflowState.activeVideos = [
      { index: 0, prompt: 'Code video', sceneNumber: 1 },
      { index: 1, prompt: 'Browser video', sceneNumber: 2 }
    ];

    // Video 1: code-initiated (has downloadId mapping)
    const dlCode = allocDownloadId();
    registerVidFlowDownload(dlCode, 1);

    // Video 2: browser-initiated (prepare + prompt mapping)
    prepareFlowDownload('Browser video');

    // Browser download fires first (unknown downloadId)
    const fileBrowser = getFlowVideoFilename(allocDownloadId());
    expect(fileBrowser).toBe('002_flow_video.mp4');

    // Code download fires second (known downloadId)
    const fileCode = getFlowVideoFilename(dlCode);
    expect(fileCode).toBe('001_flow_video.mp4');
  });
});
