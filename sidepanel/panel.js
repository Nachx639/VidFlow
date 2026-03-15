/**
 * VidFlow - Side Panel JavaScript (Entry Point)
 * Pipeline: Flow (videos) + Speech (narration)
 * Utilities in panel-utils.js, state in panel-state.js,
 * scenes in panel-scenes.js, pipeline in panel-pipeline.js.
 */

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initScenes();
  initImagePrompts();
  initBatchUpload();
  initPipelineConfig();
  initFlowConfig();
  initSpeechConfig();
  initGeneralConfig();
  initFolderName();
  initButtons();
  loadSavedState();
});

// ========== TABS ==========

function initTabs() {
  document.querySelectorAll('.vf-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.vf-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.vf-tab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ========== STORAGE ==========

async function saveState() {
  try {
    // Guardar estado principal (sin imágenes grandes)
    const stateToSave = {
      scenes: state.scenes,
      batchCount: state.batchImages.length,
      config: state.config,
      importDrafts: state.importDrafts
    };

    await chrome.storage.local.set({ vidflowState: stateToSave });

    // Guardar cola de batches (solo pending, sin datos pesados innecesarios)
    const queueToSave = batchQueue
      .filter(b => b.status === 'pending')
      .map(b => ({
        id: b.id,
        name: b.name,
        scenes: b.scenes,
        config: b.config,
        status: b.status
      }));
    await chrome.storage.local.set({ vidflowBatchQueue: queueToSave });

    console.log('VidFlow: Estado guardado');
  } catch (error) {
    console.error('VidFlow: Error guardando estado', error);
  }
}

async function loadSavedState() {
  try {
    const result = await chrome.storage.local.get(['vidflowState']);

    if (result.vidflowState) {
      const saved = result.vidflowState;

      state.scenes = saved.scenes || [];
      state.config = { ...state.config, ...saved.config };
      // Remove legacy whisk config
      delete state.config.runWhisk;
      state.importDrafts = saved.importDrafts || { prompts: '', narrations: '', styles: '', imagePrompts: '' };
    }

    // Restaurar UI
    renderScenesSummary();
    updateBatchUI();

    // Restaurar drafts de importación
    const importPrompts = document.getElementById('vf-import-prompts');
    const importNarrations = document.getElementById('vf-import-narrations');
    const importStyles = document.getElementById('vf-import-styles');
    if (importPrompts && state.importDrafts.prompts) importPrompts.value = state.importDrafts.prompts;
    if (importNarrations && state.importDrafts.narrations) importNarrations.value = state.importDrafts.narrations;
    if (importStyles && state.importDrafts.styles) importStyles.value = state.importDrafts.styles;

    // Restaurar prompts de imagen
    const imagePromptsTextarea = document.getElementById('vf-image-prompts');
    if (imagePromptsTextarea && state.importDrafts.imagePrompts) imagePromptsTextarea.value = state.importDrafts.imagePrompts;

    // Restaurar configuración de estilos
    const sameStyleCheckbox = document.getElementById('vf-same-style');
    const defaultStyleInput = document.getElementById('vf-default-style');
    if (sameStyleCheckbox) {
      sameStyleCheckbox.checked = state.config.useSameStyle !== false;
      toggleStyleMode(state.config.useSameStyle !== false);
    }
    if (defaultStyleInput && state.config.defaultStyle) {
      defaultStyleInput.value = state.config.defaultStyle;
    }

    // Restaurar config checkboxes
    const flowCheckbox = document.getElementById('vf-step-flow');
    const speechCheckbox = document.getElementById('vf-step-speech');
    const parallelCheckbox = document.getElementById('vf-parallel-mode');

    if (flowCheckbox) flowCheckbox.checked = state.config.runFlow !== false;
    if (speechCheckbox) speechCheckbox.checked = state.config.runSpeech !== false;
    if (parallelCheckbox) parallelCheckbox.checked = state.config.parallelMode === true;

    // Restaurar selects
    const genType = document.getElementById('vf-generation-type');
    const veoModel = document.getElementById('vf-veo-model');
    const aspectRatio = document.getElementById('vf-aspect-ratio');
    const resultsPerRequest = document.getElementById('vf-results-per-request');
    const delay = document.getElementById('vf-delay');
    const autoDownload = document.getElementById('vf-auto-download');

    if (genType && state.config.generationType) genType.value = state.config.generationType;
    if (veoModel && state.config.veoModel) veoModel.value = state.config.veoModel;
    if (aspectRatio && state.config.aspectRatio) aspectRatio.value = state.config.aspectRatio;
    if (resultsPerRequest && state.config.resultsPerRequest) resultsPerRequest.value = state.config.resultsPerRequest;

    const speechStyle = document.getElementById('vf-speech-style');
    if (speechStyle && state.config.speechStyle) speechStyle.value = state.config.speechStyle;

    // Restaurar API Key de Gemini
    const geminiApiKey = document.getElementById('vf-gemini-api-key');
    if (geminiApiKey && state.config.geminiApiKey) geminiApiKey.value = state.config.geminiApiKey;

    // Restaurar modelo TTS
    const speechModel = document.getElementById('vf-speech-model');
    if (speechModel && state.config.speechModel) speechModel.value = state.config.speechModel;

    // Restaurar voz de narración
    const speechVoice = document.getElementById('vf-speech-voice');
    if (speechVoice && state.config.speechVoice) speechVoice.value = state.config.speechVoice;

    if (delay) delay.value = state.config.delay || 60;
    if (autoDownload) autoDownload.checked = state.config.autoDownload !== false;

    // Restaurar folder
    const folderInput = document.getElementById('vf-folder-name');
    const autoNewFolder = document.getElementById('vf-auto-new-folder');

    if (autoNewFolder) {
      autoNewFolder.checked = state.config.autoNewFolder !== false;
      if (folderInput) {
        folderInput.value = state.config.folderName || (state.config.autoNewFolder !== false ? generateAutoFolderName() : '');
      }
    }

    // Restaurar cola de batches
    const queueResult = await chrome.storage.local.get('vidflowBatchQueue');
    if (queueResult.vidflowBatchQueue && queueResult.vidflowBatchQueue.length > 0) {
      batchQueue = queueResult.vidflowBatchQueue;
      renderQueue();
    }

    updatePipelineIndicator();
    updateStartButton();
    updateParallelVisibility();

  } catch (error) {
    console.error('VidFlow: Error cargando estado', error);
  }
}

// ========== MESSAGE LISTENER ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'pipelineProgress':
      handlePipelineProgress(message);
      break;

    case 'pipelineStepComplete':
      console.log(`VidFlow: Paso ${message.step} completado`);
      break;

    case 'pipelineComplete':
      handlePipelineComplete(message.summary);
      break;

    case 'pipelineError':
      handlePipelineError(message.error);
      break;

    case 'progressUpdate':
      // Compatibilidad con mensajes antiguos de Flow
      if (state.isRunning) {
        updateProgress('flow', message.current, message.total, message.status);
      }
      break;

    case 'workflowComplete':
      // Compatibilidad con workflow antiguo
      console.log(`VidFlow: Workflow ${message.step} completado`);
      break;
  }
});

/**
 * Maneja actualizaciones de progreso del pipeline
 */
function handlePipelineProgress(message) {
  const { step, status, state: pipelineState } = message;

  if (!pipelineState) return;

  // Actualizar estado local
  state.currentStep = pipelineState.currentStep;

  // En modo paralelo, mostrar progreso de ambos (Flow y Speech)
  if (pipelineState.currentStep === 'parallel') {
    const flowProgress = pipelineState.flow ? pipelineState.flow.currentIndex : 0;
    const flowTotal = pipelineState.flow ? pipelineState.flow.totalItems : 0;
    const speechProgress = pipelineState.speech ? pipelineState.speech.currentIndex : 0;
    const speechTotal = pipelineState.speech ? pipelineState.speech.totalItems : 0;

    const combinedProgress = flowProgress + speechProgress;
    const combinedTotal = flowTotal + speechTotal;

    const statusText = `\u26A1 PARALELO: Flow ${flowProgress}/${flowTotal} | Speech ${speechProgress}/${speechTotal}`;
    updateProgress('parallel', combinedProgress, combinedTotal, message.message || statusText);
    updatePipelineIndicator();
    return;
  }

  // Determinar current y total basado en el paso actual
  let current = 0;
  let total = 1;
  let stepData = null;

  switch (pipelineState.currentStep) {
    case 'flow':
      stepData = pipelineState.flow;
      break;
    case 'speech':
      stepData = pipelineState.speech;
      break;
  }

  if (stepData) {
    current = stepData.currentIndex || 0;
    total = stepData.totalItems || 1;
    if (status === 'complete') {
      current = total;
    }
  }

  // Actualizar UI
  updateProgress(pipelineState.currentStep || step, current, total, message.message || status);
  updatePipelineIndicator();
}

/**
 * Maneja la finalización del pipeline
 */
function handlePipelineComplete(summary) {
  // Si estamos procesando cola, marcar batch actual como done y continuar
  if (currentBatchIndex >= 0 && batchQueue[currentBatchIndex]) {
    batchQueue[currentBatchIndex].status = 'done';
    renderQueue();
    console.log(`VidFlow: Batch "${batchQueue[currentBatchIndex].name}" completado`);

    const pendingBatches = batchQueue.filter(b => b.status === 'pending');
    if (pendingBatches.length > 0) {
      setTimeout(() => startNextBatch(), 2000);
      return;
    }

    // Cola completada
    state.isRunning = false;
    state.currentStep = null;
    currentBatchIndex = -1;
    updateUIState();
    showQueueComplete();
    return;
  }

  // Run directo (sin cola) — comportamiento original
  state.isRunning = false;
  state.currentStep = null;
  updateUIState();

  let message = '\u00A1Pipeline completado!\n\n';

  if (summary) {
    message += `Carpeta: ${summary.projectFolder}\n\n`;
    if (summary.flow > 0) message += `Videos (Flow): ${summary.flow}\n`;
    if (summary.speech > 0) message += `Audios (Speech): ${summary.speech}\n`;

    const errors = summary.errors || {};
    const totalErrors = (errors.flow || 0) + (errors.speech || 0);
    if (totalErrors > 0) {
      message += '\nErrores:\n';
      if (errors.flow > 0) message += `  Flow: ${errors.flow} fallos\n`;
      if (errors.speech > 0) message += `  Speech: ${errors.speech} fallos\n`;
    }
  }

  alert(message);
}

/**
 * Maneja errores del pipeline
 */
function handlePipelineError(error) {
  console.error('VidFlow: Error en pipeline:', error);

  // Si estamos procesando cola, marcar batch como error y continuar con el siguiente
  if (currentBatchIndex >= 0 && batchQueue[currentBatchIndex]) {
    batchQueue[currentBatchIndex].status = 'error';
    renderQueue();
    console.log(`VidFlow: Batch "${batchQueue[currentBatchIndex].name}" falló, continuando cola...`);

    const pendingBatches = batchQueue.filter(b => b.status === 'pending');
    if (pendingBatches.length > 0) {
      setTimeout(() => startNextBatch(), 2000);
      return;
    }

    // Cola completada (con errores)
    state.isRunning = false;
    state.currentStep = null;
    currentBatchIndex = -1;
    updateUIState();
    showQueueComplete();
    return;
  }

  // Run directo (sin cola) — comportamiento original
  alert('Error en el pipeline: ' + error);
  state.isRunning = false;
  state.currentStep = null;
  currentBatchIndex = -1;
  updateUIState();
}

console.log('VidFlow Side Panel loaded (v0.3 - Pipeline Paralelo)');
