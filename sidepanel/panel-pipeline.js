/**
 * VidFlow - Panel Pipeline & Config
 * Pipeline execution, batch upload, config init, queue management, and button logic.
 */

// ========== BATCH UPLOAD ==========

function initBatchUpload() {
  const dropzone = document.getElementById('vf-batch-dropzone');
  const input = document.getElementById('vf-batch-input');
  const clearBtn = document.getElementById('vf-batch-clear');

  if (!dropzone) return;

  dropzone.addEventListener('click', () => input.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      processBatchFiles(files);
    }
  });

  input?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      processBatchFiles(files);
    }
    input.value = '';
  });

  clearBtn?.addEventListener('click', () => {
    state.batchImages = [];
    updateBatchUI();
    updateStartButton();
    saveState();
  });
}

async function processBatchFiles(files) {
  const sortedFiles = files.sort((a, b) => {
    const numA = parseInt(a.name.match(/\d+/) || [0]);
    const numB = parseInt(b.name.match(/\d+/) || [0]);
    if (numA !== numB) return numA - numB;
    return a.name.localeCompare(b.name);
  });

  const newImages = [];
  for (const file of sortedFiles) {
    const data = await readFileAsDataURL(file);
    newImages.push({ name: file.name, data: data });
  }

  state.batchImages = [...state.batchImages, ...newImages].sort((a, b) => {
    const numA = parseInt(a.name.match(/\d+/) || [0]);
    const numB = parseInt(b.name.match(/\d+/) || [0]);
    if (numA !== numB) return numA - numB;
    return a.name.localeCompare(b.name);
  });

  updateBatchUI();
  updateStartButton();
  saveState();
}

// readFileAsDataURL is in panel-utils.js

function updateBatchUI() {
  const listContainer = document.getElementById('vf-batch-list');
  const itemsContainer = document.getElementById('vf-batch-items');
  const countSpan = document.getElementById('vf-batch-count');
  const batchAlert = document.getElementById('vf-batch-alert');

  const hasBatch = state.batchImages.length > 0;
  state.config.useBatch = hasBatch;
  // Auto-switch generationType based on batch images
  state.config.generationType = hasBatch ? 'image-to-video' : 'text-to-video';
  const genTypeSelect = document.getElementById('vf-gen-type');
  if (genTypeSelect) genTypeSelect.value = state.config.generationType;

  if (batchAlert) {
    batchAlert.style.display = hasBatch ? 'flex' : 'none';
  }

  if (!hasBatch) {
    if (listContainer) listContainer.style.display = 'none';
    return;
  }

  if (listContainer) listContainer.style.display = 'block';
  if (countSpan) countSpan.textContent = `${state.batchImages.length} imágenes`;

  if (itemsContainer) {
    itemsContainer.innerHTML = state.batchImages.map((img, i) => `
      <div class="vf-batch-item">
        <span class="vf-batch-item-num">${i + 1}</span>
        <img src="${escapeHtml(img.data)}" alt="${escapeHtml(img.name)}" class="vf-batch-item-thumb">
        <span class="vf-batch-item-name">${escapeHtml(img.name)}</span>
      </div>
    `).join('');
  }

  updateRefsMatch();
}

// ========== PIPELINE CONFIG ==========

function initPipelineConfig() {
  const flowCheckbox = document.getElementById('vf-step-flow');
  const speechCheckbox = document.getElementById('vf-step-speech');
  const parallelCheckbox = document.getElementById('vf-parallel-mode');

  flowCheckbox?.addEventListener('change', (e) => {
    state.config.runFlow = e.target.checked;
    updatePipelineIndicator();
    updateStartButton();
    updateParallelVisibility();
    saveState();
  });

  speechCheckbox?.addEventListener('change', (e) => {
    state.config.runSpeech = e.target.checked;
    updatePipelineIndicator();
    updateStartButton();
    updateParallelVisibility();
    saveState();
  });

  parallelCheckbox?.addEventListener('change', (e) => {
    state.config.parallelMode = e.target.checked;
    updatePipelineIndicator();
    updateStartButton();
    saveState();
  });

  updatePipelineIndicator();
  updateParallelVisibility();
}

/**
 * Muestra/oculta el modo paralelo según los pasos activos
 * Tiene sentido cuando Speech está activo + al menos otro paso
 * También actualiza el texto según los pasos activos
 */
function updateParallelVisibility() {
  const parallelSection = document.querySelector('.vf-parallel-mode-section');
  const parallelIndicator = document.getElementById('vf-parallel-indicator');
  const parallelLabel = document.querySelector('.vf-parallel-option span:last-child');
  const parallelHint = document.querySelector('.vf-parallel-hint');

  if (!parallelSection) return;

  const { runFlow, runSpeech } = state.config;

  // Modo paralelo tiene sentido cuando Flow + Speech activos
  const canParallel = runSpeech && runFlow;

  if (canParallel) {
    parallelSection.style.display = 'block';
    if (parallelLabel) parallelLabel.textContent = 'Modo Paralelo (Flow || Speech)';
    if (parallelHint) parallelHint.textContent = 'Flow y Speech se ejecutan simultáneamente.';
  } else {
    parallelSection.style.display = 'none';
    state.config.parallelMode = false;
    const parallelCheckbox = document.getElementById('vf-parallel-mode');
    if (parallelCheckbox) parallelCheckbox.checked = false;
    if (parallelIndicator) parallelIndicator.style.display = 'none';
  }
}

function updatePipelineIndicator() {
  const steps = document.querySelectorAll('.vf-pipeline-step');
  const connectors = document.querySelectorAll('.vf-pipeline-connector');
  const parallelIndicator = document.getElementById('vf-parallel-indicator');

  // Mostrar/ocultar indicador de modo paralelo
  if (parallelIndicator) {
    parallelIndicator.style.display = state.config.parallelMode ? 'block' : 'none';
  }

  steps.forEach(step => {
    const stepName = step.dataset.step;
    const isEnabled = state.config[`run${stepName.charAt(0).toUpperCase() + stepName.slice(1)}`];

    step.classList.toggle('disabled', !isEnabled);

    if (state.config.parallelMode && state.currentStep === 'parallel') {
      if (stepName === 'flow' || stepName === 'speech') {
        step.classList.add('active');
        step.classList.remove('completed');
      }
    } else if (state.currentStep === stepName) {
      step.classList.add('active');
      step.classList.remove('completed');
    } else if (state.currentStep && getStepOrder(stepName) < getStepOrder(state.currentStep)) {
      step.classList.add('completed');
      step.classList.remove('active');
    } else {
      step.classList.remove('active', 'completed');
    }
  });
}

// getStepOrder is in panel-utils.js

// ========== FLOW CONFIG ==========

function initFlowConfig() {
  document.getElementById('vf-generation-type')?.addEventListener('change', (e) => {
    state.config.generationType = e.target.value;
    saveState();
  });

  document.getElementById('vf-veo-model')?.addEventListener('change', (e) => {
    state.config.veoModel = e.target.value;
    saveState();
  });

  document.getElementById('vf-aspect-ratio')?.addEventListener('change', (e) => {
    state.config.aspectRatio = e.target.value;
    saveState();
  });

  document.getElementById('vf-results-per-request')?.addEventListener('change', (e) => {
    state.config.resultsPerRequest = parseInt(e.target.value) || 1;
    saveState();
  });
}

// ========== SPEECH CONFIG ==========

function initSpeechConfig() {
  // API Key de Gemini
  document.getElementById('vf-gemini-api-key')?.addEventListener('input', (e) => {
    state.config.geminiApiKey = e.target.value;
    saveState();
  });

  document.getElementById('vf-speech-style')?.addEventListener('input', (e) => {
    state.config.speechStyle = e.target.value;
    saveState();
  });

  // Selector de modelo TTS
  document.getElementById('vf-speech-model')?.addEventListener('change', (e) => {
    state.config.speechModel = e.target.value;
    console.log('VidFlow: Modelo TTS seleccionado:', e.target.value);
    saveState();
  });

  // Selector de voz
  document.getElementById('vf-speech-voice')?.addEventListener('change', (e) => {
    state.config.speechVoice = e.target.value;
    console.log('VidFlow: Voz seleccionada:', e.target.value);
    saveState();
  });
}

// ========== GENERAL CONFIG ==========

function initGeneralConfig() {
  document.getElementById('vf-delay')?.addEventListener('change', (e) => {
    state.config.delay = parseInt(e.target.value) || 60;
    saveState();
  });

  document.getElementById('vf-auto-download')?.addEventListener('change', (e) => {
    state.config.autoDownload = e.target.checked;
    saveState();
  });
}

// ========== FOLDER NAME ==========

function initFolderName() {
  const folderInput = document.getElementById('vf-folder-name');
  const autoNewFolderCheckbox = document.getElementById('vf-auto-new-folder');

  folderInput?.addEventListener('change', (e) => {
    state.config.folderName = e.target.value;
    saveState();
  });

  autoNewFolderCheckbox?.addEventListener('change', (e) => {
    state.config.autoNewFolder = e.target.checked;

    if (folderInput && e.target.checked && !folderInput.value) {
      folderInput.value = generateAutoFolderName();
    }
    saveState();
  });

  // Inicializar: pre-rellenar si está vacío y auto está activado
  if (folderInput && state.config.autoNewFolder !== false && !folderInput.value) {
    folderInput.value = generateAutoFolderName();
  }
}

function generateAutoFolderName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  return `Proyecto_${year}${month}${day}_${hours}${mins}`;
}

// ========== BUTTONS ==========

function initButtons() {
  document.getElementById('vf-start-btn')?.addEventListener('click', startPipeline);
  document.getElementById('vf-stop-btn')?.addEventListener('click', stopPipeline);
  document.getElementById('vf-add-queue-btn')?.addEventListener('click', addToQueue);
  document.getElementById('vf-queue-clear')?.addEventListener('click', clearQueue);

  document.getElementById('vf-open-flow')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://labs.google/fx/tools/video-fx/' });
  });

  document.getElementById('vf-open-speech')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aistudio.google.com/generate-speech' });
  });
}

// ========== START BUTTON STATE ==========

function updateStartButton() {
  const btn = document.getElementById('vf-start-btn');
  const textSpan = document.getElementById('vf-start-text');
  const queueBtn = document.getElementById('vf-add-queue-btn');

  if (!btn || !textSpan) return;

  const hasScenes = state.scenes.length > 0;
  const hasValidScenes = state.scenes.some(s => s.prompt.trim());
  const hasAnyStepEnabled = state.config.runFlow || state.config.runSpeech;
  const hasPendingQueue = batchQueue.some(b => b.status === 'pending');

  let canStart = hasValidScenes && hasAnyStepEnabled;
  let canQueue = canStart;
  let statusText = '';

  if (!hasScenes && !hasPendingQueue) {
    statusText = 'Añade escenas primero';
    canStart = false;
  } else if (!hasScenes && hasPendingQueue) {
    // No hay escenas nuevas pero hay cola pendiente
    statusText = `Iniciar cola (${batchQueue.filter(b => b.status === 'pending').length} proyectos)`;
    canStart = true;
  } else if (!hasValidScenes) {
    statusText = 'Escribe al menos un prompt';
    canStart = false;
  } else if (!hasAnyStepEnabled) {
    statusText = 'Activa al menos un paso';
    canStart = false;
  } else {
    const activeSteps = [];
    if (state.config.runFlow) activeSteps.push('Flow');
    if (state.config.runSpeech) activeSteps.push('Speech');

    if (hasPendingQueue) {
      const pendingCount = batchQueue.filter(b => b.status === 'pending').length;
      statusText = `Iniciar cola (${pendingCount} + este)`;
    } else if (state.config.parallelMode && state.config.runFlow && state.config.runSpeech) {
      statusText = `⚡ PARALELO (${state.scenes.length} escenas → Flow || Speech)`;
    } else {
      statusText = `Iniciar (${state.scenes.length} escenas → ${activeSteps.join(' → ')})`;
    }
    canStart = true;
  }

  btn.disabled = !canStart;
  textSpan.textContent = statusText;

  // Botón "+ Cola" habilitado solo cuando hay escenas válidas
  if (queueBtn) {
    queueBtn.disabled = !canQueue;
  }
}

// ========== PIPELINE EXECUTION ==========

/**
 * Construye sceneData a partir del estado actual del panel.
 * Se usa tanto para start directo como para addToQueue.
 */
function buildSceneData() {
  return state.scenes.filter(s => s.prompt.trim()).map((scene, index) => {
    let flowImage = null;
    if (state.config.useBatch && state.batchImages[index]) {
      flowImage = state.batchImages[index].data;
    }

    return {
      index,
      sceneNumber: scene.sceneNumber,
      prompt: scene.prompt,
      narration: scene.narration,
      style: scene.style,
      flowImage: flowImage
    };
  });
}

async function startPipeline() {
  // Si hay cola con items pendientes, procesar cola
  if (batchQueue.length > 0 && batchQueue.some(b => b.status === 'pending')) {
    // Si también hay escenas cargadas, añadirlas como último batch
    if (state.scenes.length > 0 && state.scenes.some(s => s.prompt.trim())) {
      addToQueue();
    }
    startNextBatch();
    return;
  }

  // Run directo (sin cola)
  state.isRunning = true;

  document.getElementById('vf-start-btn').parentElement.style.display = 'none';
  document.getElementById('vf-stop-btn').style.display = 'flex';
  document.getElementById('vf-pipeline-progress').style.display = 'block';

  // Usar nombre del input. Si auto está activado y el campo está vacío, generar uno.
  const folderInput = document.getElementById('vf-folder-name');
  const userValue = folderInput?.value?.trim() || '';
  if (userValue) {
    state.config.folderName = sanitizeFolderName(userValue) || generateAutoFolderName();
  } else {
    state.config.folderName = generateAutoFolderName();
  }
  if (folderInput) folderInput.value = state.config.folderName;

  // Parsear image prompts del textarea
  const imagePromptsText = document.getElementById('vf-image-prompts')?.value || '';
  state.config.imagePrompts = parseNumberedPrompts(imagePromptsText);

  const sceneData = buildSceneData();
  const action = state.config.parallelMode ? 'startParallelPipeline' : 'startPipeline';

  console.log(`VidFlow: Iniciando pipeline en modo ${state.config.parallelMode ? 'PARALELO' : 'lineal'}`);

  try {
    const response = await chrome.runtime.sendMessage({
      action: action,
      data: {
        scenes: sceneData,
        batchImages: state.batchImages,
        config: state.config,
        folderName: state.config.folderName,
        projectFolder: state.config.folderName,
        runFlow: state.config.runFlow,
        runSpeech: state.config.runSpeech
      }
    });

    if (response && !response.success) {
      console.error('VidFlow: Error al iniciar pipeline:', response.error);
      alert('Error: ' + (response.error || 'No se pudo iniciar el pipeline.'));
      stopPipeline();
    } else if (response && response.mode === 'parallel') {
      console.log('VidFlow: Pipeline paralelo iniciado correctamente');
    }
  } catch (error) {
    console.error('VidFlow: Error de comunicación:', error);
    alert('Error de comunicación con la extensión.');
    stopPipeline();
  }
}

// ========== BATCH QUEUE ==========

function addToQueue() {
  if (state.scenes.length === 0) return;

  const folderInput = document.getElementById('vf-folder-name');
  const folderName = sanitizeFolderName(folderInput?.value?.trim()) || generateAutoFolderName();

  const sceneData = buildSceneData();
  if (sceneData.length === 0) return;

  batchQueue.push({
    id: Date.now(),
    name: folderName,
    scenes: sceneData,
    referenceCategories: state.referenceCategories.map(c => ({ ...c })),
    batchImages: [...state.batchImages],
    config: { ...state.config },
    status: 'pending'
  });

  // Limpiar panel para el siguiente proyecto
  clearScenes(true);
  renderQueue();
  updateStartButton();
  saveState();

  console.log(`VidFlow: Batch "${folderName}" añadido a cola (${sceneData.length} escenas). Cola: ${batchQueue.length}`);
}

function startNextBatch() {
  const nextBatch = batchQueue.find(b => b.status === 'pending');
  if (!nextBatch) {
    state.isRunning = false;
    currentBatchIndex = -1;
    updateUIState();
    showQueueComplete();
    return;
  }

  currentBatchIndex = batchQueue.indexOf(nextBatch);
  nextBatch.status = 'running';
  state.isRunning = true;
  renderQueue();

  document.getElementById('vf-start-btn').parentElement.style.display = 'none';
  document.getElementById('vf-stop-btn').style.display = 'flex';
  document.getElementById('vf-pipeline-progress').style.display = 'block';

  const action = nextBatch.config.parallelMode ? 'startParallelPipeline' : 'startPipeline';

  console.log(`VidFlow: Iniciando batch ${currentBatchIndex + 1}/${batchQueue.length}: "${nextBatch.name}" (${nextBatch.scenes.length} escenas)`);

  chrome.runtime.sendMessage({
    action,
    data: {
      scenes: nextBatch.scenes,
      batchImages: nextBatch.batchImages,
      config: nextBatch.config,
      folderName: nextBatch.name,
      projectFolder: nextBatch.name,
      runFlow: nextBatch.config.runFlow,
      runSpeech: nextBatch.config.runSpeech
    }
  }).then(response => {
    if (response && !response.success) {
      console.error(`VidFlow: Error al iniciar batch: ${response.error}`);
      batchQueue[currentBatchIndex].status = 'error';
      renderQueue();
      const pendingBatches = batchQueue.filter(b => b.status === 'pending');
      if (pendingBatches.length > 0) {
        setTimeout(() => startNextBatch(), 2000);
      } else {
        state.isRunning = false;
        currentBatchIndex = -1;
        updateUIState();
        showQueueComplete();
      }
    }
  }).catch(err => {
    console.error('VidFlow: Error enviando mensaje startBatch:', err);
  });
}

function renderQueue() {
  const list = document.getElementById('vf-queue-list');
  const section = document.getElementById('vf-queue-section');
  const count = document.getElementById('vf-queue-count');

  if (!section) return;

  if (batchQueue.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  count.textContent = batchQueue.length;

  const statusIcons = { pending: '\u23F3', running: '\u25B6', done: '\u2713', error: '\u2717' };

  list.innerHTML = batchQueue.map(batch => {
    const icon = statusIcons[batch.status] || '\u23F3';
    const canRemove = batch.status === 'pending';
    const canEdit = batch.status === 'pending';
    return `
      <div class="vf-queue-item ${canEdit ? 'vf-queue-item-editable' : ''}" data-status="${batch.status}" ${canEdit ? `data-queue-id="${batch.id}"` : ''}>
        <span class="vf-queue-item-status">${icon}</span>
        <span class="vf-queue-item-name">${escapeHtml(batch.name)}</span>
        <span class="vf-queue-item-info">${batch.scenes.length} escenas</span>
        ${canRemove ? `<button class="vf-queue-item-remove" data-queue-remove-id="${batch.id}" title="Quitar">✕</button>` : ''}
      </div>
    `;
  }).join('');

  // Bind remove buttons
  list.querySelectorAll('.vf-queue-item-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.queueRemoveId);
      removeFromQueue(id);
    });
  });

  // Bind edit on click (pending items only)
  list.querySelectorAll('.vf-queue-item-editable').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.queueId);
      editQueueItem(id);
    });
  });
}

function removeFromQueue(id) {
  batchQueue = batchQueue.filter(b => b.id !== id);
  renderQueue();
  updateStartButton();
  saveState();
}

function editQueueItem(id) {
  const batchIdx = batchQueue.findIndex(b => b.id === id);
  if (batchIdx === -1) return;
  const batch = batchQueue[batchIdx];
  if (batch.status !== 'pending') return;

  // Restaurar escenas desde el batch al editor
  state.scenes = batch.scenes.map(s => ({
    id: 'scene_' + Date.now() + '_' + s.sceneNumber,
    sceneNumber: s.sceneNumber,
    prompt: s.prompt,
    narration: s.narration || '',
    style: s.style || '',
    references: { subject: null, scene: null, style: null }
  }));

  // Restaurar referencias y config
  state.referenceCategories = batch.referenceCategories || [];
  state.batchImages = batch.batchImages || [];

  // Restaurar folder name
  const folderInput = document.getElementById('vf-folder-name');
  if (folderInput) folderInput.value = batch.name || '';

  // Reconstruir textareas con los prompts/narrations
  const promptsEl = document.getElementById('vf-import-prompts');
  const narrationsEl = document.getElementById('vf-import-narrations');
  if (promptsEl) {
    promptsEl.value = batch.scenes.map(s => `${s.sceneNumber}. ${s.prompt}`).join('\n\n');
  }
  if (narrationsEl) {
    const withNarration = batch.scenes.filter(s => s.narration?.trim());
    narrationsEl.value = withNarration.map(s => `${s.sceneNumber}. ${s.narration}`).join('\n\n');
  }

  // Quitar de la cola
  batchQueue.splice(batchIdx, 1);

  // Actualizar UI
  renderReferenceCategories();
  renderScenesSummary();
  renderQueue();
  updateStartButton();
  saveState();

  console.log(`VidFlow: Batch "${batch.name}" cargado para edición (${batch.scenes.length} escenas)`);
}

function clearQueue() {
  if (state.isRunning) return;
  batchQueue = [];
  currentBatchIndex = -1;
  renderQueue();
  updateStartButton();
  saveState();
}

function updateUIState() {
  const actionBtns = document.getElementById('vf-start-btn')?.parentElement;
  if (actionBtns) actionBtns.style.display = 'flex';
  document.getElementById('vf-stop-btn').style.display = 'none';
  document.getElementById('vf-pipeline-progress').style.display = 'none';
  updatePipelineIndicator();
  updateStartButton();
}

function showQueueComplete() {
  const done = batchQueue.filter(b => b.status === 'done').length;
  const errors = batchQueue.filter(b => b.status === 'error').length;
  const total = batchQueue.length;

  let msg = `Cola completada: ${done}/${total} proyectos exitosos.`;
  if (errors > 0) msg += `\n${errors} proyecto(s) con errores.`;

  alert(msg);
}

function stopPipeline() {
  state.isRunning = false;
  state.currentStep = null;

  // Si hay cola activa, marcar el batch running como error (fue detenido manualmente)
  if (currentBatchIndex >= 0 && batchQueue[currentBatchIndex]?.status === 'running') {
    batchQueue[currentBatchIndex].status = 'error';
  }
  currentBatchIndex = -1;

  updateUIState();
  renderQueue();

  chrome.runtime.sendMessage({ action: 'stopPipeline' });
}

function updateProgress(step, current, total, status) {
  state.currentStep = step;

  const icons = { images: '🖼️', flow: '🎬', speech: '🎙️', parallel: '⚡' };
  const names = { images: 'Imagenes', flow: 'Flow', speech: 'Speech', parallel: 'Paralelo' };

  document.getElementById('vf-current-step-icon').textContent = icons[step] || '⏳';
  document.getElementById('vf-current-step-name').textContent = names[step] || step;
  document.getElementById('vf-progress-status').textContent = status;
  document.getElementById('vf-progress-count').textContent = `${current}/${total}`;
  document.getElementById('vf-progress-fill').style.width = `${(current / total) * 100}%`;

  updatePipelineIndicator();
}

console.log('VidFlow: panel-pipeline.js cargado');
