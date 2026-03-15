/**
 * VidFlow - Flow Video Step + Speech Step
 * startFlowStep, handleFlowSceneComplete, completeFlowStep,
 * startSpeechStep, processNextSpeechSceneAPI, processNextSpeechScene,
 * handleDownloadSpeechAudio, handleSpeechSceneComplete, completeSpeechStep,
 * completePipeline, notifyPipelineProgress, savePipelineState.
 */

// ========== FLOW VIDEO STEP ==========

/**
 * Flow - Generar todos los videos
 */
// Flag global para evitar doble ejecución de startFlowStep
var flowStepStarting = false;

async function startFlowStep() {
  // Guard: evitar doble ejecución con flag inmediato
  if (flowStepStarting) {
    console.log('VidFlow BG: startFlowStep YA EJECUTÁNDOSE, ignorando llamada duplicada');
    return;
  }
  flowStepStarting = true;

  console.log('VidFlow BG: === PASO 2: FLOW ===');
  pipelineState.currentStep = 'flow';
  pipelineState.flow.currentIndex = 0;

  notifyPipelineProgress('flow', 'starting', 'Iniciando Flow...');

  // Abrir pestaña NUEVA de Flow (no reutilizar existente para empezar limpio)
  const flowTab = await openFreshTab('https://labs.google/fx/es/tools/flow');

  if (!flowTab) {
    notifyPipelineProgress('flow', 'error', 'No se pudo abrir Flow');
    return;
  }

  await sleep(3000);

  // Conectar con content script de Flow
  const connected = await connectToContentScript(flowTab.id, pipelineState.config);

  if (!connected) {
    notifyPipelineProgress('flow', 'error', 'No se pudo conectar con Flow');
    return;
  }

  // Preparar prompts con imágenes
  const flowPrompts = pipelineState.scenes.map((scene, i) => ({
    index: i,
    prompt: scene.prompt,
    sceneNumber: scene.sceneNumber ?? (i + 1), // Usar sceneNumber original
    referenceNeeded: scene.flowImage ? 'pipeline' : null,
    category: 'pipeline'
  }));

  // Preparar imágenes como batch
  const batchImages = pipelineState.scenes
    .map((scene, i) => scene.flowImage ? { name: `image_${i + 1}.png`, data: scene.flowImage } : null)
    .filter(Boolean);

  console.log('╔════════════════════════════════════════════════════════════');
  console.log(`║ INICIANDO FLOW STEP`);
  console.log(`║ Total prompts: ${flowPrompts.length}`);
  console.log(`║ Total imágenes batch: ${batchImages.length}`);
  console.log(`║ pipelineState.scenes.length: ${pipelineState.scenes.length}`);
  console.log('╚════════════════════════════════════════════════════════════');

  // Usar el workflow existente de Flow pero con carpeta específica
  workflowState = {
    isRunning: true,
    currentStep: 'flow',
    currentIndex: 0,
    totalItems: flowPrompts.length,
    prompts: flowPrompts,
    references: {},
    batchImages: batchImages,
    config: { ...pipelineState.config, useBatch: batchImages.length > 0 },
    generatedImages: [],
    generatedVideos: [],
    folderName: `${pipelineState.projectFolder}/videos_flow`,
    lastActivityTime: Date.now(),
    activeVideos: [],
    failedVideos: [],
    rateLimitedVideos: [],
    isPipelineMode: true, // Flag para saber que es parte del pipeline
    flowTabId: flowTab.id // Guardar el tabId para uso posterior
  };

  // También guardar en pipelineState
  pipelineState.flow.tabId = flowTab.id;

  await processNextFlowVideo(flowTab.id);
}

/**
 * Handler: Video de Flow completado (en modo pipeline)
 */
async function handleFlowSceneComplete(data) {
  if (!pipelineState.isRunning || pipelineState.currentStep !== 'flow') {
    return { success: false };
  }

  console.log(`VidFlow BG: Flow escena ${data.index + 1} completada`);

  pipelineState.flow.generatedVideos.push({
    index: data.index,
    filename: data.filename
  });

  pipelineState.flow.currentIndex++;
  await savePipelineState();

  // Verificar si Flow completado
  if (pipelineState.flow.generatedVideos.length >= pipelineState.flow.totalItems) {
    await completeFlowStep();
  }

  return { success: true };
}

/**
 * Flow completado - Transición a Speech o resolver promesa paralela
 */
async function completeFlowStep() {
  console.log('VidFlow BG: Flow completado!');
  pipelineState.flow.isComplete = true;
  workflowState.isRunning = false;
  workflowState.isPipelineMode = false;

  notifyPipelineProgress('flow', 'complete',
    `Flow completado: ${pipelineState.flow.generatedVideos.length} videos`);

  // Si estamos en modo paralelo, resolver la promesa y dejar que el orquestador maneje
  if (pipelineState.parallelMode && pipelineState.flow.resolveParallel) {
    console.log('VidFlow BG: [PARALELO] Resolviendo promesa de Flow');
    pipelineState.flow.resolveParallel();
    pipelineState.flow.resolveParallel = null;
    return;
  }

  // En modo paralelo sin resolveParallel, verificar si Speech ya completó
  // (esto puede pasar si Speech terminó antes que Flow en modo paralelo)
  if (pipelineState.parallelMode) {
    console.log('VidFlow BG: [PARALELO] Flow completado, modo paralelo activo');
    const speechRelevant = pipelineState.runSpeech && pipelineState.speech.totalItems > 0;
    if (pipelineState.speech.isComplete || !speechRelevant) {
      console.log('VidFlow BG: [PARALELO] Speech ya completó o no aplica, finalizando pipeline');
      await completePipeline();
    } else {
      console.log('VidFlow BG: [PARALELO] Esperando a que Speech complete...');
    }
    return;
  }

  // Modo lineal: Transición a Speech si está habilitado
  if (pipelineState.runSpeech && pipelineState.speech.totalItems > 0) {
    await sleep(2000);
    await startSpeechStep();
  } else {
    await completePipeline();
  }
}

/**
 * Paso 3: Speech - Generar toda la narración
 */
async function startSpeechStep() {
  console.log('VidFlow BG: === PASO 3: SPEECH (API) ===');
  pipelineState.currentStep = 'speech';
  pipelineState.speech.currentIndex = 0;

  // Filtrar escenas con narración
  const scenesWithNarration = pipelineState.scenes.filter(s => s.narration);
  pipelineState.speech.totalItems = scenesWithNarration.length;

  if (scenesWithNarration.length === 0) {
    console.log('VidFlow BG: No hay narraciones, saltando Speech');
    await completePipeline();
    return;
  }

  notifyPipelineProgress('speech', 'starting', `Generando ${scenesWithNarration.length} audios via API...`);

  // Procesar narraciones usando API de Gemini TTS
  await processNextSpeechSceneAPI();
}

/**
 * Procesa la siguiente escena en Speech usando API de Gemini TTS
 */
async function processNextSpeechSceneAPI() {
  const validStep = pipelineState.currentStep === 'speech' || pipelineState.currentStep === 'parallel';
  if (!pipelineState.isRunning || !validStep) {
    console.log(`VidFlow BG: processNextSpeechSceneAPI ignorado (step=${pipelineState.currentStep})`);
    return;
  }

  const scenesWithNarration = pipelineState.scenes.filter(s => s.narration);
  const index = pipelineState.speech.currentIndex;
  const total = scenesWithNarration.length;

  if (index >= total) {
    await completeSpeechStep();
    return;
  }

  const scene = scenesWithNarration[index];
  const originalIndex = pipelineState.scenes.indexOf(scene);
  const sceneNumber = scene.sceneNumber ?? (originalIndex + 1);

  notifyPipelineProgress('speech', 'processing', `Generando audio ${index + 1}/${total}...`);

  // Obtener configuración de voz y modelo
  const voiceName = pipelineState.config?.speechVoice || 'Sulafat';
  const model = pipelineState.config?.speechModel || 'gemini-2.5-pro-preview-tts';

  // Preparar texto con estilo si está configurado
  let textToSpeak = scene.narration;
  const styleInstructions = scene.style || pipelineState.config?.speechStyle || '';
  if (styleInstructions) {
    textToSpeak = `${styleInstructions} ${scene.narration}`;
  }

  console.log(`VidFlow BG: [Speech API] Escena ${index + 1}/${total} - Voz: ${voiceName}, Modelo: ${model}`);

  // Generar audio via API
  const result = await generateSpeechViaAPI(textToSpeak, voiceName, model);

  if (!result.success) {
    console.error(`VidFlow BG: Error generando audio ${index + 1}:`, result.error);
    notifyPipelineProgress('speech', 'error', `Error en audio ${index + 1}: ${result.error}`);
    // Continuar con el siguiente aunque falle
    pipelineState.speech.currentIndex++;
    await processNextSpeechSceneAPI();
    return;
  }

  // Construir filename
  const paddedNumber = String(sceneNumber).padStart(2, '0');
  const filename = `${pipelineState.projectFolder}/narracion/${paddedNumber}_speech.wav`;

  // Descargar audio
  const downloadResult = await downloadSpeechAudio(result.audioData, filename);

  if (downloadResult.success) {
    pipelineState.speech.generatedAudios.push({
      index: originalIndex,
      sceneNumber: sceneNumber,
      filename: filename
    });
    console.log(`VidFlow BG: Audio ${index + 1}/${total} generado y descargado`);
  } else {
    console.error(`VidFlow BG: Error descargando audio ${index + 1}:`, downloadResult.error);
  }

  // Siguiente narración
  pipelineState.speech.currentIndex++;

  // Pequeña pausa entre generaciones para no saturar la API
  await sleep(1000);

  await processNextSpeechSceneAPI();
}

/**
 * Procesa la siguiente escena en Speech (LEGACY - usa web automation)
 */
async function processNextSpeechScene(tabId) {
  // Permitir tanto modo 'speech' como 'parallel'
  const validStep = pipelineState.currentStep === 'speech' || pipelineState.currentStep === 'parallel';
  if (!pipelineState.isRunning || !validStep) {
    console.log(`VidFlow BG: processNextSpeechScene ignorado (step=${pipelineState.currentStep})`);
    return;
  }

  const scenesWithNarration = pipelineState.scenes.filter(s => s.narration);
  const index = pipelineState.speech.currentIndex;
  const total = scenesWithNarration.length;

  if (index >= total) {
    await completeSpeechStep();
    return;
  }

  const scene = scenesWithNarration[index];
  const originalIndex = pipelineState.scenes.indexOf(scene);

  notifyPipelineProgress('speech', 'processing', `Generando audio ${index + 1}/${total}...`);

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'generateSpeechAudio',
      data: {
        index: originalIndex,
        sceneNumber: scene.sceneNumber ?? (originalIndex + 1),
        narration: scene.narration,
        styleInstructions: scene.style || pipelineState.config?.speechStyle || '',
        projectFolder: `${pipelineState.projectFolder}/narracion`,
        totalScenes: total,
        startAutomation: index === 0
      }
    });
  } catch (error) {
    console.error(`VidFlow BG: Error enviando narración ${index + 1} a Speech:`, error);
  }
}

/**
 * Handler: Descarga audio de Speech con ruta específica
 */
async function handleDownloadSpeechAudio(data) {
  console.log('VidFlow BG: handleDownloadSpeechAudio llamado con:', {
    filename: data.filename,
    index: data.index,
    hasDataUrl: !!data.dataUrl,
    dataUrlLength: data.dataUrl?.length || 0
  });

  if (!data.dataUrl || !data.filename) {
    console.error('VidFlow BG: Faltan datos para descarga', { hasDataUrl: !!data.dataUrl, hasFilename: !!data.filename });
    return { success: false, error: 'Faltan datos para descarga' };
  }

  // Asegurar que el filename tenga la estructura VidFlow/Proyecto_xxx/narracion/...
  let fullFilename = data.filename;
  if (!fullFilename.startsWith('VidFlow/')) {
    fullFilename = `VidFlow/${fullFilename}`;
  }

  console.log('VidFlow BG: Ruta completa de descarga:', fullFilename);

  // IMPORTANTE: Para data URLs, Chrome ignora el filename parameter
  // Guardamos el filename pendiente para que el listener onDeterminingFilename lo use
  setPendingSpeechDownload(fullFilename);

  try {
    // Usar chrome.downloads.download para especificar la ruta
    const downloadId = await chrome.downloads.download({
      url: data.dataUrl,
      filename: fullFilename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    // Registrar esta descarga como iniciada por VidFlow
    registerVidFlowDownload(downloadId);

    console.log(`VidFlow BG: Audio Speech iniciado - ID: ${downloadId}, archivo: ${fullFilename}`);

    // Verificar el estado de la descarga
    return new Promise((resolve) => {
      const checkDownload = () => {
        chrome.downloads.search({ id: downloadId }, (downloads) => {
          if (downloads && downloads[0]) {
            const download = downloads[0];
            console.log('VidFlow BG: Estado descarga Speech:', {
              id: downloadId,
              state: download.state,
              filename: download.filename,
              error: download.error
            });

            if (download.state === 'complete') {
              resolve({
                success: true,
                downloadId: downloadId,
                filename: download.filename
              });
            } else if (download.state === 'interrupted') {
              resolve({
                success: false,
                error: download.error || 'Descarga interrumpida'
              });
            } else {
              // Aún en progreso, verificar de nuevo
              setTimeout(checkDownload, 500);
            }
          } else {
            resolve({
              success: true,
              downloadId: downloadId,
              filename: fullFilename
            });
          }
        });
      };

      // Iniciar verificación después de un momento
      setTimeout(checkDownload, 1000);
    });
  } catch (error) {
    console.error('VidFlow BG: Error descargando audio Speech:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handler: Audio de Speech completado
 */
async function handleSpeechSceneComplete(data) {
  // Soportar tanto modo lineal como paralelo
  if (!pipelineState.isRunning) {
    return { success: false };
  }

  // En modo paralelo, currentStep puede ser 'parallel'
  if (pipelineState.currentStep !== 'speech' && pipelineState.currentStep !== 'parallel') {
    return { success: false };
  }

  console.log(`VidFlow BG: Speech audio ${data.index + 1} completado`);

  pipelineState.speech.generatedAudios.push({
    index: data.index,
    filename: data.filename,
    audioData: data.audioData,
    duration: data.duration
  });

  pipelineState.speech.currentIndex++;
  await savePipelineState();

  // Verificar si completamos todas las narraciones
  const scenesWithNarration = pipelineState.scenes.filter(s => s.narration);
  if (pipelineState.speech.currentIndex >= scenesWithNarration.length) {
    // Speech completado
    if (pipelineState.parallelMode) {
      await completeSpeechStepParallel();
    } else {
      await completeSpeechStep();
    }
    return { success: true };
  }

  // Continuar con siguiente narración
  // Speech usa delay más corto que Flow (5s por defecto)
  const speechDelay = (pipelineState.config.speechDelay || 5) * 1000;
  console.log(`VidFlow BG: Esperando ${speechDelay/1000}s antes del siguiente audio...`);

  const tabId = pipelineState.speech.tabId;
  if (tabId) {
    await sleep(speechDelay);
    console.log(`VidFlow BG: Procesando siguiente audio en tab ${tabId}...`);
    if (pipelineState.parallelMode) {
      await processNextSpeechSceneParallel(tabId);
    } else {
      await processNextSpeechScene(tabId);
    }
  } else {
    // Fallback: buscar pestaña
    console.log('VidFlow BG: tabId no disponible, buscando pestaña Speech...');
    const tabs = await chrome.tabs.query({ url: '*://aistudio.google.com/*speech*' });
    const speechTab = tabs[0];

    if (speechTab) {
      console.log(`VidFlow BG: Encontrada pestaña Speech: ${speechTab.id}`);
      pipelineState.speech.tabId = speechTab.id; // Guardar para futuro uso
      await sleep(speechDelay);
      if (pipelineState.parallelMode) {
        await processNextSpeechSceneParallel(speechTab.id);
      } else {
        await processNextSpeechScene(speechTab.id);
      }
    } else {
      console.error('VidFlow BG: No se encontró pestaña de Speech!');
    }
  }

  return { success: true };
}

/**
 * Speech completado
 */
async function completeSpeechStep() {
  console.log('VidFlow BG: Speech completado!');
  pipelineState.speech.isComplete = true;

  notifyPipelineProgress('speech', 'complete',
    `Speech completado: ${pipelineState.speech.generatedAudios.length} audios`);

  await completePipeline();
}

/**
 * Pipeline completado
 */
async function completePipeline() {
  console.log('VidFlow BG: ========== PIPELINE COMPLETADO ==========');
  pipelineState.isRunning = false;
  pipelineState.currentStep = null;
  flowStepStarting = false; // Reset flag para próxima ejecución

  // Desregistrar listener de descargas para no interferir con otras extensiones
  unregisterDownloadListener();

  const summary = {
    projectFolder: pipelineState.projectFolder,
    flow: pipelineState.flow.generatedVideos.length,
    speech: pipelineState.speech.generatedAudios.length
  };

  console.log('VidFlow BG: Resumen:', summary);

  notifyPipelineProgress('pipeline', 'complete',
    `Pipeline completado! ${summary.flow} videos, ${summary.speech} audios`);

  // Notificar al sidepanel
  chrome.runtime.sendMessage({
    action: 'pipelineComplete',
    summary: summary
  }).catch(() => {});
}

/**
 * Notifica progreso del pipeline al sidepanel
 */
function notifyPipelineProgress(step, status, message) {
  chrome.runtime.sendMessage({
    action: 'pipelineProgress',
    step: step,
    status: status,
    message: message,
    state: {
      currentStep: pipelineState.currentStep,
      flow: pipelineState.flow,
      speech: pipelineState.speech
    }
  }).catch(() => {}); // Ignorar si el sidepanel está cerrado
}

/**
 * Guarda el estado del pipeline
 */
async function savePipelineState() {
  try {
    // No guardar imageData para evitar exceder quota
    const stateToSave = {
      isRunning: pipelineState.isRunning,
      currentStep: pipelineState.currentStep,
      projectFolder: pipelineState.projectFolder,
      runFlow: pipelineState.runFlow,
      runSpeech: pipelineState.runSpeech,
      flow: {
        isComplete: pipelineState.flow.isComplete,
        currentIndex: pipelineState.flow.currentIndex,
        totalItems: pipelineState.flow.totalItems,
        generatedCount: pipelineState.flow.generatedVideos.length
      },
      speech: {
        isComplete: pipelineState.speech.isComplete,
        currentIndex: pipelineState.speech.currentIndex,
        totalItems: pipelineState.speech.totalItems,
        generatedCount: pipelineState.speech.generatedAudios.length
      },
      config: pipelineState.config
    };
    await chrome.storage.local.set({ pipelineState: stateToSave });
  } catch (error) {
    console.log('VidFlow BG: Error guardando estado del pipeline:', error.message);
  }
}
