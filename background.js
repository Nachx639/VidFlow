/**
 * VidFlow - Background Service Worker (Loader)
 * Orchestrates the workflow between popup and content scripts.
 *
 * This is the single service worker loaded by manifest.json.
 * It uses importScripts() to load modular files from background/,
 * then registers the central message listener.
 *
 * Module load order (respects dependencies):
 *   1. bg-constants.js — workflowState, pipelineState, keepalive, pendingSpeechDownload helpers
 *   2. bg-downloads.js — download maps, registerVidFlowDownload, onDeterminingFilename handler
 *   3. bg-utils.js     — sleep, saveState, loadState, connectToContentScript, notifyProgress, etc.
 *   4. bg-tts.js       — Gemini TTS API, WAV conversion (uses sleep, registerVidFlowDownload)
 *   5. bg-flow-workflow.js — Flow workflow logic (uses utils, downloads, constants)
 *   6. bg-pipeline.js  — Pipeline orchestration + image generation step
 *   7. bg-speech.js    — Flow video step + speech step processing
 *
 * CONSTANTS & MAGIC NUMBERS:
 * - MAX_PARALLEL_VIDEOS = 2: Max concurrent video generations in Google Flow queue
 * - Pending download expiry = 30s: Time window for speech download filename matching
 * - Rate limit retry delay = 60s: Wait before retrying rate-limited videos
 * - Content script connect retries = 7, delay = 1.5s (10.5s worst case)
 * - Gemini TTS max retries = 3
 * - Download ID cleanup = 5 min: Auto-cleanup of vidflowDownloadIds entries
 * - Stale workflow detection = 30s: Time before a "hung" workflow can be overridden
 * - WAV format: PCM 16-bit, 24000 Hz, mono (Gemini TTS output format)
 *
 * HARDCODED URLs (may break if Google changes paths):
 * - labs.google/fx/es/tools/video-fx — Flow video generation
 * - aistudio.google.com/generate-speech — Speech generation
 * - generativelanguage.googleapis.com/v1beta/models/ — Gemini TTS API
 */

// Load all modules in dependency order
importScripts(
  'background/bg-constants.js',
  'background/bg-downloads.js',
  'background/bg-utils.js',
  'background/bg-tts.js',
  'background/bg-flow-workflow.js',
  'background/bg-pipeline.js',
  'background/bg-speech.js'
);

// ========== MESSAGE LISTENER ==========
// Central message router — references handlers from all modules.

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('VidFlow BG: Mensaje recibido:', message.action);

  handleMessage(message, sender)
    .then(result => {
      console.log('VidFlow BG: Respondiendo a', message.action, ':', result?.success);
      sendResponse(result);
    })
    .catch(error => {
      console.error('VidFlow BG: Error en', message.action, ':', error.message);
      sendResponse({ success: false, error: error.message });
    });

  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  console.log('Background received:', message.action);

  switch (message.action) {
    case 'startFlow':
      // If called from bridge content script, inject the sender tab ID
      // so startFlowWorkflow can reuse it instead of opening a new tab
      if (message.data?.__fromBridge && sender?.tab?.id) {
        message.data.__bridgeTabId = sender.tab.id;
      }
      return await startFlowWorkflow(message.data);

    case 'startFlowPipeline':
      // Pass sender tab ID so pipeline runs on the same tab that sent the message
      if (message.data?.__fromBridge && sender?.tab?.id) {
        message.data.__bridgeTabId = sender.tab.id;
      }
      return await startFlowPipeline(message.data);

    case 'stopWorkflow':
      return stopWorkflow();

    case 'flowVideoGenerated':
      return handleFlowVideoGenerated(message.data);

    case 'flowVideoQueued':
      return handleFlowVideoQueued(message.data);

    case 'flowVideoError':
      return handleFlowVideoError(message.data);

    case 'flowVideoRetried': {
      const retryPrompt = message.data?.promptText;
      console.log(`VidFlow BG: Video retried - prompt: "${retryPrompt?.substring(0, 40)}...", retry #${message.data?.retryNumber}`);

      // Ensure the entry is in activeVideos and mark as awaitingRetry
      // so FIFO/partial matching don't steal this slot for a different video
      if (workflowState.activeVideos && retryPrompt) {
        const existing = workflowState.activeVideos.find(v => v.prompt === retryPrompt);
        if (existing) {
          existing.permanentlyFailed = false;
          existing.isRetry = true;
          existing.awaitingRetry = true;
          console.log(`VidFlow BG: Marcado video #${existing.index + 1} como awaitingRetry`);
        } else {
          // Re-add from prompts array
          const promptIdx = workflowState.prompts?.findIndex(p =>
            (typeof p === 'string' ? p : p.prompt) === retryPrompt
          );
          if (promptIdx >= 0) {
            const promptData = workflowState.prompts[promptIdx];
            workflowState.activeVideos.push({
              index: promptIdx,
              prompt: retryPrompt,
              sceneNumber: (typeof promptData === 'object' && promptData.sceneNumber != null) ? promptData.sceneNumber : (promptIdx + 1),
              startTime: Date.now(),
              isRetry: true,
              awaitingRetry: true
            });
            console.log(`VidFlow BG: Re-added video #${promptIdx + 1} to activeVideos as awaitingRetry`);
          }
        }
      }
      return { success: true };
    }

    case 'flowVideoPermanentlyFailed':
      return handleFlowVideoPermanentlyFailed(message.data);

    case 'flowVideoDownloaded':
      return handleFlowVideoDownloaded(message.data);

    case 'prepareFlowDownload':
      return handlePrepareFlowDownload(message.data);

    case 'downloadVideoUrl':
      return handleDownloadVideoUrl(message.data);

    case 'monitorStatus':
      return handleMonitorStatus(message.data);

    case 'monitorDeadlock':
      return handleMonitorDeadlock(message.data);

    case 'checkWorkflowComplete':
      return checkWorkflowComplete();

    case 'getWorkflowState':
      return { success: true, state: workflowState };

    case 'contentScriptReady':
      return handleContentScriptReady(sender);

    // ========== PIPELINE LINEAL HANDLERS ==========
    case 'startPipeline':
      return await startLinearPipeline(message.data);

    case 'startParallelPipeline':
      return await startParallelPipeline(message.data);

    case 'stopPipeline':
      return stopLinearPipeline();

    case 'getPipelineState':
      return { success: true, state: pipelineState };

    case 'flowImageGenerated':
      return await handleFlowImageGenerated(message.data);

    case 'downloadFlowVideo':
      return await handleDownloadFlowVideo(message.data);

    case 'flowSceneComplete':
      return await handleFlowSceneComplete(message.data);

    case 'downloadSpeechAudio':
      return await handleDownloadSpeechAudio(message.data);

    case 'speechAudioGenerated':
    case 'speechSceneComplete':
      return await handleSpeechSceneComplete(message.data);

    default:
      return { success: false, error: 'Unknown action' };
  }
}

// Load saved state on startup
loadState();
