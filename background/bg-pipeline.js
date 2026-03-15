/**
 * VidFlow - Pipeline Mode
 * Linear and parallel pipeline orchestration (startLinearPipeline,
 * startParallelPipeline, runFlowParallel, runSpeechParallel,
 * connectToSpeechContentScript, processNextSpeechSceneParallel,
 * completeSpeechStepParallel, stopLinearPipeline, checkParallelCompletion).
 * Image generation step (startImageGenerationStep, handleFlowImageGenerated,
 * handleDownloadFlowVideo, pendingVideoDownload).
 */

// ========== PIPELINE LINEAL (Flow → Speech) ==========

/**
 * Inicia el pipeline lineal completo
 * Cada paso se ejecuta secuencialmente: Flow → Speech
 */
async function startLinearPipeline(data) {
  if (pipelineState.isRunning) {
    return { success: false, error: 'Pipeline ya en ejecución' };
  }

  console.log('VidFlow BG: Iniciando Pipeline Lineal');
  console.log('VidFlow BG: Escenas:', data.scenes?.length);
  console.log('VidFlow BG: Pasos activos - Flow:', data.runFlow, 'Speech:', data.runSpeech);

  // Reset flags de control
  flowStepStarting = false;

  // Generar nombre de carpeta del proyecto (usando hora LOCAL, no UTC)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const timestamp = `${year}${month}${day}_${hours}${mins}`;
  const projectFolder = data.projectFolder || `Proyecto_${timestamp}`;

  // Inicializar estado del pipeline
  pipelineState = {
    isRunning: true,
    currentStep: null,
    projectFolder: projectFolder,

    runFlow: data.runFlow !== false,
    runSpeech: data.runSpeech !== false,

    flow: { isComplete: false, currentIndex: 0, totalItems: 0, generatedVideos: [] },
    speech: { isComplete: false, currentIndex: 0, totalItems: 0, generatedAudios: [] },

    scenes: data.scenes || [],
    config: data.config || {}
  };

  // Registrar listener de descargas para el pipeline
  registerDownloadListener();

  // Calcular totales
  pipelineState.flow.totalItems = pipelineState.scenes.length;
  pipelineState.speech.totalItems = pipelineState.scenes.filter(s => s.narration).length;

  await savePipelineState();

  // Notificar inicio
  notifyPipelineProgress('pipeline', 'starting', 'Iniciando pipeline...');

  // Asignar imágenes batch a cada escena (si las hay)
  if (data.batchImages && data.batchImages.length > 0) {
    data.batchImages.forEach((img, i) => {
      if (pipelineState.scenes[i]) {
        pipelineState.scenes[i].flowImage = img.data;
      }
    });
  }

  // Paso de generación de imágenes + videos integrado (si hay image prompts)
  const imagePrompts = data.config?.imagePrompts || [];
  const hasImagePrompts = imagePrompts.length > 0 && pipelineState.runFlow;

  if (hasImagePrompts) {
    // Flujo integrado: imagen → animar → video, escena por escena
    // Esto reemplaza startFlowStep para las escenas con image prompts
    await startImageGenerationStep();
  }

  // Determinar siguiente paso a ejecutar
  if (pipelineState.runFlow && !hasImagePrompts) {
    // Flow normal (sin image prompts)
    await startFlowStep();
  } else if (hasImagePrompts) {
    // Ya se procesó imagen+video integrado, continuar con Speech si hay
    if (pipelineState.runSpeech) {
      await startSpeechStep();
    }
    // Pipeline finalizado
    pipelineState.isRunning = false;
    unregisterDownloadListener();
  } else if (pipelineState.runSpeech) {
    await startSpeechStep();
  } else {
    pipelineState.isRunning = false;
    unregisterDownloadListener();
    return { success: false, error: 'No hay pasos seleccionados' };
  }

  return { success: true, projectFolder };
}

// ========== PIPELINE PARALELO (Flow || Speech) ==========

/**
 * Inicia el pipeline paralelo
 * Flow y Speech se ejecutan simultáneamente
 */
async function startParallelPipeline(data) {
  if (pipelineState.isRunning) {
    return { success: false, error: 'Pipeline ya en ejecución' };
  }

  console.log('╔════════════════════════════════════════════════════════════');
  console.log('║ INICIANDO PIPELINE PARALELO');
  console.log(`║ Escenas recibidas: ${data.scenes?.length || 0}`);
  console.log(`║ Pasos activos - Flow: ${data.runFlow}, Speech: ${data.runSpeech}`);
  console.log('╚════════════════════════════════════════════════════════════');

  // Generar nombre de carpeta del proyecto (usando hora LOCAL, no UTC)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  const timestamp = `${year}${month}${day}_${hours}${mins}`;
  const projectFolder = data.projectFolder || `Proyecto_${timestamp}`;

  // Inicializar estado del pipeline
  pipelineState = {
    isRunning: true,
    currentStep: 'parallel', // Modo paralelo
    projectFolder: projectFolder,
    parallelMode: true,

    runFlow: data.runFlow !== false,
    runSpeech: data.runSpeech !== false,

    flow: { isComplete: false, currentIndex: 0, totalItems: 0, generatedVideos: [], tabId: null },
    speech: { isComplete: false, currentIndex: 0, totalItems: 0, generatedAudios: [], tabId: null },

    scenes: data.scenes || [],
    config: data.config || {}
  };

  // Calcular totales
  pipelineState.flow.totalItems = pipelineState.scenes.length;
  pipelineState.speech.totalItems = pipelineState.scenes.filter(s => s.narration).length;

  await savePipelineState();

  // Verificar qué pasos ejecutar
  const runFlow = pipelineState.runFlow && pipelineState.flow.totalItems > 0;
  const runSpeech = pipelineState.runSpeech && pipelineState.speech.totalItems > 0;

  if (runFlow && runSpeech) {
    // Flow || Speech
    console.log('VidFlow BG: Modo paralelo: Flow || Speech');
    notifyPipelineProgress('pipeline', 'starting', 'Iniciando: Flow || Speech...');

    // Asignar imágenes batch a cada escena
    if (data.batchImages && data.batchImages.length > 0) {
      console.log(`VidFlow BG: Asignando ${data.batchImages.length} imágenes batch a escenas`);
      data.batchImages.forEach((img, i) => {
        if (pipelineState.scenes[i]) {
          pipelineState.scenes[i].flowImage = img.data;
        }
      });
    }

    Promise.all([runFlowParallel(), runSpeechParallel()])
      .then(async () => {
        console.log('VidFlow BG: ¡Flow y Speech completados!');
        await completePipeline();
      })
      .catch(error => {
        console.error('VidFlow BG: Error en pipeline paralelo:', error);
        notifyPipelineProgress('pipeline', 'error', `Error: ${error.message}`);
      });

  } else {
    // Caso de un solo paso o ninguno
    if (runFlow) {
      // Asignar imágenes batch si existen
      if (data.batchImages && data.batchImages.length > 0) {
        console.log(`VidFlow BG: Asignando ${data.batchImages.length} imágenes batch a escenas`);
        data.batchImages.forEach((img, i) => {
          if (pipelineState.scenes[i]) {
            pipelineState.scenes[i].flowImage = img.data;
          }
        });
      }
      await startFlowStep();
    } else if (runSpeech) {
      await runSpeechParallel();
      await completePipeline();
    } else {
      pipelineState.isRunning = false;
      return { success: false, error: 'No hay pasos a ejecutar' };
    }
  }

  return { success: true, projectFolder, mode: 'parallel' };
}

/**
 * Ejecuta Speech de forma independiente (para modo paralelo) - USA API
 */
async function runSpeechParallel() {
  return new Promise(async (resolve, reject) => {
    console.log('VidFlow BG: [PARALELO] Iniciando Speech via API...');
    pipelineState.speech.currentIndex = 0;

    const scenesWithNarration = pipelineState.scenes.filter(s => s.narration);
    const total = scenesWithNarration.length;

    if (total === 0) {
      console.log('VidFlow BG: [PARALELO] No hay narraciones');
      pipelineState.speech.isComplete = true;
      resolve();
      return;
    }

    notifyPipelineProgress('speech', 'starting', `Generando ${total} audios via API (paralelo)...`);

    // Obtener configuración
    const voiceName = pipelineState.config?.speechVoice || 'Sulafat';
    const model = pipelineState.config?.speechModel || 'gemini-2.5-pro-preview-tts';

    try {
      // Procesar cada narración secuencialmente
      for (let i = 0; i < total; i++) {
        if (!pipelineState.isRunning) {
          console.log('VidFlow BG: [PARALELO] Speech cancelado');
          break;
        }

        const scene = scenesWithNarration[i];
        const originalIndex = pipelineState.scenes.indexOf(scene);
        const sceneNumber = scene.sceneNumber ?? (originalIndex + 1);

        notifyPipelineProgress('speech', 'processing', `Generando audio ${i + 1}/${total} (paralelo)...`);

        // Preparar texto con estilo
        let textToSpeak = scene.narration;
        const styleInstructions = scene.style || pipelineState.config?.speechStyle || '';
        if (styleInstructions) {
          textToSpeak = `${styleInstructions} ${scene.narration}`;
        }

        console.log(`VidFlow BG: [PARALELO] Audio ${i + 1}/${total} - Voz: ${voiceName}`);

        // Generar audio via API
        const result = await generateSpeechViaAPI(textToSpeak, voiceName, model);

        if (result.success) {
          // Construir filename y descargar
          const paddedNumber = String(sceneNumber).padStart(2, '0');
          const filename = `${pipelineState.projectFolder}/narracion/${paddedNumber}_speech.wav`;

          const downloadResult = await downloadSpeechAudio(result.audioData, filename);

          if (downloadResult.success) {
            pipelineState.speech.generatedAudios.push({
              index: originalIndex,
              sceneNumber: sceneNumber,
              filename: filename
            });
            console.log(`VidFlow BG: [PARALELO] Audio ${i + 1}/${total} generado`);
          }
        } else {
          console.error(`VidFlow BG: [PARALELO] Error audio ${i + 1}:`, result.error);
          notifyPipelineProgress('speech', 'error', `Error audio ${i + 1}: ${result.error}`);
        }

        pipelineState.speech.currentIndex = i + 1;

        // Pequeña pausa entre generaciones
        if (i < total - 1) {
          await sleep(1000);
        }
      }

      // Completar
      pipelineState.speech.isComplete = true;
      notifyPipelineProgress('speech', 'complete',
        `Speech completado: ${pipelineState.speech.generatedAudios.length} audios`);

      console.log('VidFlow BG: [PARALELO] Speech completado!');
      resolve();

    } catch (error) {
      console.error('VidFlow BG: Error en Speech paralelo:', error);
      reject(error);
    }
  });
}

/**
 * Ejecuta Flow de forma independiente (para modo Flow || Speech con batch)
 */
async function runFlowParallel() {
  return new Promise(async (resolve, reject) => {
    console.log('VidFlow BG: [PARALELO] Iniciando Flow (batch)...');

    try {
      flowStepStarting = false; // Reset flag
      await startFlowStep();

      // Guardar resolver para cuando Flow complete
      pipelineState.flow.resolveParallel = resolve;

      console.log('VidFlow BG: [PARALELO] Flow iniciado, esperando completar...');

    } catch (error) {
      console.error('VidFlow BG: Error en Flow paralelo:', error);
      reject(error);
    }
  });
}

/**
 * Conecta con el content script de Speech
 */
async function connectToSpeechContentScript(tabId) {
  const maxRetries = 5;

  console.log('VidFlow BG: Inyectando Speech content script en tab', tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        'content/speech/utils.js',
        'content/speech/log.js',
        'content/speech/selectors.js',
        'content/speech/generation.js',
        'content/speech/main.js'
      ]
    });
    await sleep(2000);
  } catch (injectError) {
    console.log('VidFlow BG: Error en inyección Speech:', injectError.message);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`VidFlow BG: Intento de conexión Speech ${attempt}/${maxRetries}...`);

    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });

      if (response && response.success && response.page === 'speech') {
        console.log('VidFlow BG: Conexión Speech exitosa');
        return true;
      }
    } catch (error) {
      console.log(`VidFlow BG: Error Speech intento ${attempt}:`, error.message);

      if (error.message.includes('Receiving end does not exist')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: [
              'content/speech/utils.js',
              'content/speech/log.js',
              'content/speech/selectors.js',
              'content/speech/generation.js',
              'content/speech/main.js'
            ]
          });
          await sleep(1500);
        } catch (e) {
          // Ignorar
        }
      }
    }

    if (attempt < maxRetries) {
      await sleep(1500);
    }
  }

  console.error('VidFlow BG: No se pudo conectar con Speech después de', maxRetries, 'intentos');
  return false;
}

/**
 * Procesa la siguiente escena en Speech (modo paralelo)
 */
async function processNextSpeechSceneParallel(tabId) {
  if (!pipelineState.isRunning) {
    return;
  }

  const scenesWithNarration = pipelineState.scenes.filter(s => s.narration);
  const index = pipelineState.speech.currentIndex;
  const total = scenesWithNarration.length;

  if (index >= total) {
    await completeSpeechStepParallel();
    return;
  }

  const scene = scenesWithNarration[index];
  const originalIndex = pipelineState.scenes.indexOf(scene);

  notifyPipelineProgress('speech', 'processing', `Generando audio ${index + 1}/${total} (paralelo)...`);

  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'generateSpeechScene',
      data: {
        index: originalIndex,
        sceneNumber: scene.sceneNumber ?? (originalIndex + 1),
        narration: scene.narration,
        text: scene.narration,
        styleInstructions: scene.style || pipelineState.config?.speechStyle || '',
        projectFolder: `${pipelineState.projectFolder}/narracion`,
        totalScenes: total
      }
    });
  } catch (error) {
    console.error(`VidFlow BG: Error enviando narración ${index + 1} a Speech:`, error);
  }
}

/**
 * Speech completado (modo paralelo)
 */
async function completeSpeechStepParallel() {
  console.log('VidFlow BG: [PARALELO] Speech completado!');
  pipelineState.speech.isComplete = true;

  notifyPipelineProgress('speech', 'complete',
    `Speech completado: ${pipelineState.speech.generatedAudios.length} audios`);

  // Resolver la promesa paralela
  if (pipelineState.speech.resolveParallel) {
    pipelineState.speech.resolveParallel();
    pipelineState.speech.resolveParallel = null;
  }

  // Verificar si podemos completar el pipeline
  checkParallelCompletion();
}

/**
 * Verifica si Speech y Flow han terminado para completar el pipeline
 */
function checkParallelCompletion() {
  const speechDone = !pipelineState.runSpeech || pipelineState.speech.isComplete;
  const flowDone = !pipelineState.runFlow || pipelineState.flow.isComplete;

  console.log(`VidFlow BG: checkParallelCompletion - Speech: ${speechDone}, Flow: ${flowDone}`);

  if (speechDone && flowDone) {
    console.log('VidFlow BG: ¡Ambos pasos paralelos completados!');
    completePipeline();
  }
}

/**
 * Detiene el pipeline
 */
function stopLinearPipeline() {
  console.log('VidFlow BG: Deteniendo pipeline');
  pipelineState.isRunning = false;
  pipelineState.currentStep = null;
  flowStepStarting = false; // Reset flag

  // Limpiar maps de sceneNumbers pendientes
  downloadSceneMap.clear();
  pendingPromptSceneMap.clear();
  pendingVideoUrlMap.clear();
  preparedDownloadMap.clear();

  // Desregistrar listener de descargas
  unregisterDownloadListener();

  // Notificar a todos los content scripts
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { action: 'stopAutomation' }).catch(() => {});
    });
  });

  notifyPipelineProgress('pipeline', 'stopped', 'Pipeline detenido');
  return { success: true };
}

// ========== IMAGE GENERATION STEP ==========

/**
 * Paso integrado: genera imagen + anima + genera video para cada escena
 * Flujo: Image prompt → Nano Banana Pro → click derecho "Animar" → Video prompt → enviar
 */
async function startImageGenerationStep() {
  console.log('VidFlow BG: === PASO: IMAGENES + VIDEOS (integrado) ===');
  pipelineState.currentStep = 'images';

  // Los image prompts vienen en config.imagePrompts (del textarea de referencias)
  const imagePrompts = pipelineState.config.imagePrompts || [];
  if (imagePrompts.length === 0) {
    console.log('VidFlow BG: No hay prompts de imagen, saltando paso');
    return;
  }

  // Los video prompts vienen de las escenas
  const scenes = pipelineState.scenes || [];

  pipelineState.images = {
    isComplete: false,
    currentIndex: 0,
    totalItems: imagePrompts.length,
    generatedImages: []
  };

  notifyPipelineProgress('images', 'starting', `Generando ${imagePrompts.length} escenas (imagen→video)...`);

  // Buscar pestaña de Flow
  const flowTab = await openFreshTab('https://labs.google/fx/es/tools/flow');
  if (!flowTab) {
    notifyPipelineProgress('images', 'error', 'No se pudo abrir Flow');
    return;
  }

  // Inyectar content script y conectar
  const connected = await connectToContentScript(flowTab.id, pipelineState.config);
  if (!connected) {
    notifyPipelineProgress('images', 'error', 'No se pudo conectar con Flow');
    return;
  }

  // Crear nuevo proyecto y configurar modo Image
  try {
    await chrome.tabs.sendMessage(flowTab.id, {
      action: 'createProjectAndSetImageMode'
    });
  } catch (e) {
    console.log('VidFlow BG: Error creando proyecto:', e.message);
  }

  await sleep(1000);

  // Generar cada escena: imagen → animar → video prompt → enviar
  for (let i = 0; i < imagePrompts.length; i++) {
    if (!pipelineState.isRunning) break;

    pipelineState.images.currentIndex = i;
    const videoPrompt = scenes[i]?.prompt || '';

    if (!videoPrompt) {
      console.warn(`VidFlow BG: Escena ${i + 1} no tiene prompt de video, saltando`);
      pipelineState.images.generatedImages.push({ index: i, success: false, error: 'Sin prompt de video' });
      continue;
    }

    notifyPipelineProgress('images', 'processing', `Escena ${i + 1}/${imagePrompts.length}: generando imagen...`);

    const sceneNum = scenes[i]?.sceneNumber ?? (i + 1);

    try {
      const response = await chrome.tabs.sendMessage(flowTab.id, {
        action: 'generateImageThenVideo',
        data: {
          imagePrompt: imagePrompts[i],
          videoPrompt: videoPrompt,
          index: i,
          sceneNumber: sceneNum,
          config: pipelineState.config
        }
      });
      if (response && response.success) {
        pipelineState.images.generatedImages.push({ index: i, sceneNumber: sceneNum, success: true });
        console.log(`VidFlow BG: Escena #${sceneNum} (imagen+video) enviada OK`);
        notifyPipelineProgress('images', 'processing', `Escena #${sceneNum} (${i + 1}/${imagePrompts.length}): video enviado a cola`);
      } else {
        console.error(`VidFlow BG: Error en escena #${sceneNum}:`, response?.error);
        pipelineState.images.generatedImages.push({ index: i, sceneNumber: sceneNum, success: false, error: response?.error });
      }
    } catch (error) {
      console.error(`VidFlow BG: Error enviando mensaje para escena #${scenes[i]?.sceneNumber ?? (i + 1)}:`, error);
      const sceneNum = scenes[i]?.sceneNumber ?? (i + 1);
      pipelineState.images.generatedImages.push({ index: i, sceneNumber: sceneNum, success: false, error: error.message });
    }

    // Delay entre escenas
    if (i < imagePrompts.length - 1) {
      await sleep(3000);
    }
  }

  // Reintentar escenas fallidas (1 ronda extra)
  const failedScenes = pipelineState.images.generatedImages
    .map((g, idx) => ({ ...g, idx }))
    .filter(g => !g.success);

  if (failedScenes.length > 0 && pipelineState.isRunning) {
    console.log(`VidFlow BG: ${failedScenes.length} escenas fallidas, reintentando...`);
    notifyPipelineProgress('images', 'processing', `Reintentando ${failedScenes.length} escenas fallidas...`);
    await sleep(5000);

    for (const failed of failedScenes) {
      if (!pipelineState.isRunning) break;
      const i = failed.idx;
      const sceneNum = failed.sceneNumber || (i + 1);
      const videoPrompt = scenes[i]?.prompt || '';

      notifyPipelineProgress('images', 'processing', `Reintento escena #${sceneNum}...`);

      try {
        const response = await chrome.tabs.sendMessage(flowTab.id, {
          action: 'generateImageThenVideo',
          data: {
            imagePrompt: imagePrompts[i],
            videoPrompt: videoPrompt,
            index: i,
            config: pipelineState.config
          }
        });

        if (response && response.success) {
          const existingIdx = pipelineState.images.generatedImages.findIndex(g => g.index === i);
          if (existingIdx >= 0) {
            pipelineState.images.generatedImages[existingIdx] = { index: i, sceneNumber: sceneNum, success: true };
          } else {
            pipelineState.images.generatedImages.push({ index: i, sceneNumber: sceneNum, success: true });
          }
          console.log(`VidFlow BG: Reintento escena #${sceneNum} OK`);
        } else {
          console.error(`VidFlow BG: Reintento escena #${sceneNum} falló:`, response?.error);
        }
      } catch (error) {
        console.error(`VidFlow BG: Error reintentando escena #${sceneNum}:`, error.message);
      }

      if (failedScenes.indexOf(failed) < failedScenes.length - 1) {
        await sleep(3000);
      }
    }
  }

  pipelineState.images.isComplete = true;
  const successCount = pipelineState.images.generatedImages.filter(g => g.success).length;
  notifyPipelineProgress('images', 'processing', `Escenas enviadas: ${successCount}/${imagePrompts.length}. Esperando videos...`);

  // Recopilar las escenas exitosas con su sceneNumber real
  const successGenerations = pipelineState.images.generatedImages.filter(g => g.success);
  const successSceneNumbers = successGenerations.map(g => g.sceneNumber);
  const successVideoPrompts = successGenerations.map(g => scenes[g.index]?.prompt || '');

  // Esperar y descargar los videos generados
  if (successSceneNumbers.length > 0) {
    console.log(`VidFlow BG: Esperando y descargando ${successSceneNumbers.length} videos (escenas: #${successSceneNumbers.join(', #')})...`);
    notifyPipelineProgress('images', 'processing', `Esperando ${successSceneNumbers.length} videos y descargando...`);

    try {
      const dlResult = await chrome.tabs.sendMessage(flowTab.id, {
        action: 'waitAndDownloadVideos',
        data: {
          expectedCount: successSceneNumbers.length,
          sceneNumbers: successSceneNumbers,
          videoPrompts: successVideoPrompts,
          maxWaitMs: 600000 // 10 min max
        }
      });

      if (dlResult?.downloaded > 0) {
        notifyPipelineProgress('images', 'complete', `Videos descargados: ${dlResult.downloaded}/${successSceneNumbers.length}`);
      } else {
        notifyPipelineProgress('images', 'complete', `Escenas enviadas: ${successSceneNumbers.length} (descargas: ${dlResult?.downloaded || 0})`);
      }
    } catch (e) {
      console.error('VidFlow BG: Error en espera/descarga:', e.message);
      notifyPipelineProgress('images', 'complete', `Escenas enviadas: ${successSceneNumbers.length} (error descarga: ${e.message})`);
    }
  } else {
    notifyPipelineProgress('images', 'complete', `Escenas procesadas: 0/${imagePrompts.length}`);
  }
}

/**
 * Handler: Imagen de Flow generada
 */
async function handleFlowImageGenerated(data) {
  console.log(`VidFlow BG: Imagen ${data.index + 1} generada:`, data.success);
  return { success: true };
}

/**
 * Handler: Descargar video de Flow por mediaKey usando chrome.downloads
 * Esto permite que onDeterminingFilename asigne la carpeta VidFlow/{proyecto}/
 */
// Pending video download filename (similar a pendingSpeechDownload pero para videos)
var pendingVideoDownload = { filename: null, downloadId: null };

async function handleDownloadFlowVideo(data) {
  const { dataUrl, sceneNumber } = data;
  if (!dataUrl) return { success: false, error: 'No dataUrl' };

  const paddedNumber = String(sceneNumber).padStart(3, '0');
  const folder = pipelineState.projectFolder || 'proyecto';
  const filename = `VidFlow/${folder}/${paddedNumber}_flow_video.mp4`;

  console.log(`VidFlow BG: Descargando escena ${sceneNumber} → ${filename}`);

  // Guardar filename pendiente ANTES de iniciar la descarga
  // Chrome ignora el filename param para data URLs, así que onDeterminingFilename lo aplicará
  pendingVideoDownload.filename = filename;

  try {
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    pendingVideoDownload.downloadId = downloadId;
    registerVidFlowDownload(downloadId, sceneNumber);
    console.log(`VidFlow BG: Descarga iniciada - ${filename} (ID: ${downloadId})`);

    return { success: true, downloadId, filename };
  } catch (error) {
    pendingVideoDownload.filename = null;
    console.error(`VidFlow BG: Error descargando video ${sceneNumber}:`, error);
    return { success: false, error: error.message };
  }
}
