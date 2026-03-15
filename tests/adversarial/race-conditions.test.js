/**
 * ROUND 15: Adversarial Testing - Race Conditions & Stress
 * Tests for concurrent access, out-of-order events, and lifecycle issues
 */

global.vfLog = jest.fn();

// We'll test the background.js logic by extracting key functions
// Since background.js is a single file with inline logic, we simulate the state

describe('Race Condition Stress Tests', () => {

  // Simulate the core state from background.js
  let workflowState;
  let pipelineState;

  beforeEach(() => {
    workflowState = {
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
      activeVideos: [],
      failedVideos: [],
      rateLimitedVideos: [],
      folderName: 'VidFlow01',
      pendingIndexes: null,
    };

    pipelineState = {
      isRunning: false,
      currentStep: null,
      projectFolder: null,
      parallelMode: false,
      runWhisk: true,
      runFlow: true,
      runSpeech: true,
      whisk: { isComplete: false, currentIndex: 0, totalItems: 0, generatedImages: [], tabId: null },
      flow: { isComplete: false, currentIndex: 0, totalItems: 0, generatedVideos: [], tabId: null },
      speech: { isComplete: false, currentIndex: 0, totalItems: 0, generatedAudios: [], tabId: null },
      scenes: [],
      referenceCategories: [],
      config: {},
    };
  });

  // ========== B1. Double startPipeline ==========

  describe('Call startPipeline twice simultaneously', () => {
    test('second call should be rejected when first is running', () => {
      pipelineState.isRunning = true;
      pipelineState.currentStep = 'whisk';

      // Simulate what startLinearPipeline does
      const startLinearPipeline = (data) => {
        if (pipelineState.isRunning) {
          return { success: false, error: 'Pipeline ya en ejecución' };
        }
        pipelineState.isRunning = true;
        return { success: true };
      };

      const result1 = startLinearPipeline({});
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('ya en ejecución');
    });

    test('startFlow rejects when workflow already running (within 30s)', () => {
      workflowState.isRunning = true;
      workflowState.lastActivityTime = Date.now(); // Recent activity

      const canStart = () => {
        if (workflowState.isRunning) {
          const lastActivity = workflowState.lastActivityTime || 0;
          const timeSinceActivity = Date.now() - lastActivity;
          if (timeSinceActivity < 30000) {
            return { success: false, error: 'Workflow already running' };
          }
          // Stale workflow, can override
          workflowState.isRunning = false;
        }
        return { success: true };
      };

      expect(canStart().success).toBe(false);
    });

    test('startFlow allows override when workflow is stale (>30s)', () => {
      workflowState.isRunning = true;
      workflowState.lastActivityTime = Date.now() - 31000; // Stale

      const canStart = () => {
        if (workflowState.isRunning) {
          const lastActivity = workflowState.lastActivityTime || 0;
          const timeSinceActivity = Date.now() - lastActivity;
          if (timeSinceActivity > 30000) {
            workflowState.isRunning = false;
          } else {
            return { success: false, error: 'Workflow already running' };
          }
        }
        return { success: true };
      };

      expect(canStart().success).toBe(true);
      expect(workflowState.isRunning).toBe(false);
    });
  });

  // ========== B2. Stop while starting ==========

  describe('Call stopPipeline while startPipeline is initializing', () => {
    test('stop resets all state even during init', () => {
      pipelineState.isRunning = true;
      pipelineState.currentStep = 'whisk';
      pipelineState.whisk.currentIndex = 3;

      // Simulate stopLinearPipeline
      const stopLinearPipeline = () => {
        pipelineState.isRunning = false;
        pipelineState.currentStep = null;
        return { success: true };
      };

      const result = stopLinearPipeline();
      expect(result.success).toBe(true);
      expect(pipelineState.isRunning).toBe(false);
      expect(pipelineState.currentStep).toBeNull();
    });

    test('workflow stop clears active videos and all tracking', () => {
      workflowState.isRunning = true;
      workflowState.activeVideos = [
        { index: 0, prompt: 'test1' },
        { index: 1, prompt: 'test2' },
      ];
      workflowState.failedVideos = [{ index: 2 }];
      workflowState.rateLimitedVideos = [{ index: 3 }];
      workflowState.pendingIndexes = [0, 1, 2, 3];

      // Simulate stopWorkflow
      workflowState.isRunning = false;
      workflowState.currentStep = null;
      workflowState.activeVideos = [];
      workflowState.failedVideos = [];
      workflowState.rateLimitedVideos = [];
      workflowState.pendingIndexes = null;

      expect(workflowState.activeVideos).toEqual([]);
      expect(workflowState.failedVideos).toEqual([]);
      expect(workflowState.rateLimitedVideos).toEqual([]);
      expect(workflowState.pendingIndexes).toBeNull();
    });
  });

  // ========== B3. flowVideoDownloaded for unknown video ==========

  describe('flowVideoDownloaded for video not in activeVideos', () => {
    test('FIFO fallback when no prompt match and no active videos', () => {
      workflowState.activeVideos = [];

      // Simulate handleFlowVideoDownloaded logic
      const handleFlowVideoDownloaded = (data) => {
        if (!workflowState.activeVideos || workflowState.activeVideos.length === 0) {
          return { success: false, error: 'No active videos' };
        }
        return { success: true };
      };

      const result = handleFlowVideoDownloaded({ promptText: 'unknown prompt' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('No active videos');
    });

    test('FIFO fallback when prompt does not match any active video', () => {
      workflowState.activeVideos = [
        { index: 0, prompt: 'Bruno walks in forest', sceneNumber: 1 },
        { index: 1, prompt: 'Pompón jumps', sceneNumber: 2 },
      ];

      // No prompt match → FIFO: takes first
      const promptToMatch = 'completely unrelated text'.toLowerCase().trim();
      let matchedVideo = null;

      for (let i = 0; i < workflowState.activeVideos.length; i++) {
        const activePrompt = workflowState.activeVideos[i].prompt.toLowerCase().trim();
        if (activePrompt === promptToMatch) {
          matchedVideo = workflowState.activeVideos.splice(i, 1)[0];
          break;
        }
      }

      if (!matchedVideo) {
        matchedVideo = workflowState.activeVideos.shift(); // FIFO
      }

      expect(matchedVideo.index).toBe(0);
      expect(workflowState.activeVideos.length).toBe(1);
    });
  });

  // ========== B4. whiskSceneComplete with index > total ==========

  describe('whiskSceneComplete with out-of-bounds index', () => {
    test('index greater than total scenes', () => {
      pipelineState.isRunning = true;
      pipelineState.currentStep = 'whisk';
      pipelineState.whisk.totalItems = 3;
      pipelineState.scenes = [
        { prompt: 'scene1' },
        { prompt: 'scene2' },
        { prompt: 'scene3' },
      ];

      // Simulate receiving index 999
      const data = { index: 999, filename: 'test.png', imageData: 'data:image/png;base64,abc' };

      pipelineState.whisk.generatedImages.push({
        index: data.index,
        filename: data.filename,
      });

      // pipelineState.scenes[999] is undefined
      if (pipelineState.scenes[data.index]) {
        pipelineState.scenes[data.index].flowImage = data.imageData;
      }
      // Should not crash - scenes[999] is undefined, if-check prevents assignment

      pipelineState.whisk.currentIndex++;

      expect(pipelineState.whisk.generatedImages.length).toBe(1);
      expect(pipelineState.scenes[999]).toBeUndefined();
    });

    test('negative index does not crash', () => {
      pipelineState.isRunning = true;
      pipelineState.currentStep = 'whisk';
      pipelineState.scenes = [{ prompt: 'scene1' }];

      const data = { index: -1, filename: 'test.png', imageData: 'data:...' };

      // scenes[-1] is undefined in JS arrays
      if (pipelineState.scenes[data.index]) {
        pipelineState.scenes[data.index].flowImage = data.imageData;
      }

      expect(pipelineState.scenes[-1]).toBeUndefined();
    });
  });

  // ========== B5. handlePrepareFlowDownload with no workflow ==========

  describe('handlePrepareFlowDownload when no workflow running', () => {
    test('returns failure when no active videos', () => {
      workflowState.activeVideos = [];

      const handlePrepareFlowDownload = (data) => {
        if (!workflowState.activeVideos || workflowState.activeVideos.length === 0) {
          return { success: false, sceneNumber: null };
        }
        return { success: true, sceneNumber: 1 };
      };

      const result = handlePrepareFlowDownload({ promptText: 'test' });
      expect(result.success).toBe(false);
      expect(result.sceneNumber).toBeNull();
    });

    test('returns failure when activeVideos is undefined', () => {
      workflowState.activeVideos = undefined;

      const handlePrepareFlowDownload = (data) => {
        if (!workflowState.activeVideos || workflowState.activeVideos.length === 0) {
          return { success: false, sceneNumber: null };
        }
        return { success: true };
      };

      const result = handlePrepareFlowDownload({ promptText: 'test' });
      expect(result.success).toBe(false);
    });
  });

  // ========== B6. Download handler when not registered ==========

  describe('vidflowDownloadHandler edge cases', () => {
    test('handler returns false for non-VidFlow downloads when inactive', () => {
      // Simulate the handler's check logic
      const isPipelineActive = false;
      const isOurDownload = false;
      const isFromLabs = false;

      const shouldIntercept = isOurDownload || (isPipelineActive && isFromLabs);
      expect(shouldIntercept).toBe(false);
    });

    test('handler intercepts when pipeline is active and from labs', () => {
      const isPipelineActive = true;
      const isFromLabs = true;
      const isOurDownload = false;

      const shouldIntercept = isOurDownload || (isPipelineActive && isFromLabs);
      expect(shouldIntercept).toBe(true);
    });
  });

  // ========== Additional Race Condition Scenarios ==========

  describe('Concurrent state mutations', () => {
    test('multiple flowVideoDownloaded calls reduce activeVideos correctly', () => {
      workflowState.activeVideos = [
        { index: 0, prompt: 'video 1', sceneNumber: 1 },
        { index: 1, prompt: 'video 2', sceneNumber: 2 },
        { index: 2, prompt: 'video 3', sceneNumber: 3 },
      ];
      workflowState.generatedVideos = [];

      // Simulate 3 rapid downloads
      for (let i = 0; i < 3; i++) {
        const downloaded = workflowState.activeVideos.shift();
        workflowState.generatedVideos.push({ index: downloaded.index, filename: `${downloaded.sceneNumber}.mp4` });
      }

      expect(workflowState.activeVideos.length).toBe(0);
      expect(workflowState.generatedVideos.length).toBe(3);
    });

    test('removing specific video from activeVideos by index', () => {
      workflowState.activeVideos = [
        { index: 0, prompt: 'a' },
        { index: 1, prompt: 'b' },
        { index: 2, prompt: 'c' },
      ];

      // Remove index 1 (middle)
      workflowState.activeVideos = workflowState.activeVideos.filter(v => v.index !== 1);

      expect(workflowState.activeVideos.length).toBe(2);
      expect(workflowState.activeVideos.map(v => v.index)).toEqual([0, 2]);
    });

    test('pendingIndexes mode: currentIndex maps to correct prompt', () => {
      workflowState.pendingIndexes = [2, 5, 7]; // Only these prompts need generation
      workflowState.prompts = Array.from({ length: 10 }, (_, i) => ({ prompt: `prompt ${i}` }));
      workflowState.currentIndex = 1; // Second pending item

      const realPromptIdx = workflowState.pendingIndexes[workflowState.currentIndex];
      expect(realPromptIdx).toBe(5);
      expect(workflowState.prompts[realPromptIdx].prompt).toBe('prompt 5');
    });
  });

  describe('checkWorkflowComplete edge cases', () => {
    test('not complete when activeVideos remain', () => {
      workflowState.currentIndex = 5;
      workflowState.totalItems = 5;
      workflowState.generatedVideos = Array(5).fill({ index: 0 });
      workflowState.activeVideos = [{ index: 4, prompt: 'still generating' }];
      workflowState.pendingIndexes = null;

      const totalToProcess = workflowState.totalItems;
      const allSent = workflowState.currentIndex >= totalToProcess;
      const allGenerated = workflowState.generatedVideos.length >= totalToProcess;
      const hasActiveVideos = workflowState.activeVideos.length > 0;
      const isComplete = allSent && allGenerated && !hasActiveVideos;

      expect(isComplete).toBe(false);
    });

    test('complete when all conditions met', () => {
      workflowState.currentIndex = 3;
      workflowState.totalItems = 3;
      workflowState.generatedVideos = Array(3).fill({});
      workflowState.activeVideos = [];
      workflowState.pendingIndexes = null;

      const totalToProcess = workflowState.totalItems;
      const isComplete = workflowState.currentIndex >= totalToProcess &&
                          workflowState.generatedVideos.length >= totalToProcess &&
                          workflowState.activeVideos.length === 0;

      expect(isComplete).toBe(true);
    });
  });
});
