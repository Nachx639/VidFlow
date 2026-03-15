/**
 * VidFlow - Flow Workflow
 * startFlowWorkflow, processNextFlowVideo, handleFlowVideoQueued,
 * handleFlowVideoError, handleDownloadVideoUrl, handlePrepareFlowDownload,
 * handleFlowVideoDownloaded, handleFlowVideoGenerated, handleMonitorStatus,
 * handleMonitorDeadlock, handleFlowVideoPermanentlyFailed,
 * checkWorkflowComplete, completeFlowWorkflow, startFlowPipeline.
 */

// ========== FLOW WORKFLOW ==========

async function startFlowWorkflow(data) {
  // Si hay un workflow "colgado" (más de 30 segundos sin actividad), resetearlo
  if (workflowState.isRunning) {
    const lastActivity = workflowState.lastActivityTime || 0;
    const timeSinceActivity = Date.now() - lastActivity;
    const thirtySeconds = 30 * 1000;

    if (timeSinceActivity > thirtySeconds) {
      console.log('VidFlow BG: Workflow anterior colgado (>30s), reseteando...');
      workflowState.isRunning = false;
    } else {
      return { success: false, error: 'Workflow already running. Espera 30 segundos o haz clic en STOP primero.' };
    }
  }

  // Resetear contador de descargas y maps al iniciar nuevo workflow
  downloadCounter = 0;
  downloadSceneMap.clear();
  pendingPromptSceneMap.clear();
  pendingVideoUrlMap.clear();
  preparedDownloadMap.clear();

  // Use existing prompts if available, otherwise use provided data
  workflowState.isRunning = true;
  workflowState.currentStep = 'flow';
  workflowState.currentIndex = 0;
  workflowState.lastActivityTime = Date.now();
  startKeepalive(); // Keep service worker alive during workflow

  // Registrar listener de descargas (para no interferir con otras extensiones cuando no está activo)
  registerDownloadListener();
  workflowState.resumedFrom = 0; // Track desde dónde reanudamos
  workflowState.activeVideos = []; // IMPORTANTE: Limpiar videos activos del workflow anterior
  workflowState.generatedVideos = []; // Limpiar lista de generados
  workflowState.failedVideos = []; // Limpiar lista de fallidos
  workflowState.permanentlyFailedCount = 0; // Resetear contador de fallidos permanentes
  workflowState.rateLimitedVideos = []; // Limpiar cola de rate limit

  if (data.prompts) {
    workflowState.prompts = data.prompts;
    workflowState.totalItems = data.prompts.length;
  }

  // IMPORTANTE: Guardar las referencias de imágenes
  if (data.references) {
    workflowState.references = data.references;
    console.log('VidFlow BG: Referencias guardadas:', Object.keys(data.references).filter(k => data.references[k]));
  }

  // Guardar imágenes batch si están disponibles
  if (data.batchImages && data.batchImages.length > 0) {
    workflowState.batchImages = data.batchImages;
    console.log('VidFlow BG: Batch images guardadas:', workflowState.batchImages.length);
    // DEBUG: Mostrar fingerprints de todas las imágenes para verificar que son diferentes
    workflowState.batchImages.forEach((img, i) => {
      const fp = img.data ? img.data.substring(50, 100) : 'NO DATA';
      console.log(`VidFlow BG: DEBUG Imagen ${i + 1} (${img.name}): fingerprint = ${fp}`);
    });
  } else {
    workflowState.batchImages = [];
  }

  if (data.config) {
    workflowState.config = { ...workflowState.config, ...data.config };
  }

  // Guardar nombre de carpeta
  if (data.folderName) {
    workflowState.folderName = data.folderName;
  } else if (data.config?.folderName) {
    workflowState.folderName = data.config.folderName;
  }

  console.log('VidFlow BG: Carpeta de descarga:', workflowState.folderName);
  console.log('VidFlow BG: Estado inicial:', {
    prompts: workflowState.prompts?.length,
    references: Object.keys(workflowState.references || {}).filter(k => workflowState.references[k]),
    config: workflowState.config
  });

  await saveState();

  // Find or open Flow tab
  // If called from bridge, reuse the SAME tab (already on Flow) instead of navigating
  let flowTab;
  if (data.__bridgeTabId) {
    console.log('VidFlow BG: Bridge call detected, reusing current tab (already on Flow)');
    flowTab = await chrome.tabs.get(data.__bridgeTabId);
  } else {
    flowTab = await findOrOpenTab('flow', 'https://labs.google/fx/es/tools/flow');
  }

  // Save the tab ID so handleFlowVideoQueued can reuse it (avoid URL search race conditions)
  if (flowTab) {
    workflowState.flowTabId = flowTab.id;
  }

  if (!flowTab) {
    unregisterDownloadListener();
    return { success: false, error: 'Could not open Flow tab' };
  }

  // Esperar a que la página esté completamente cargada
  notifyProgress(0, workflowState.totalItems, 'Esperando que Flow cargue...');

  // Verificar estado de carga del tab
  let tabReady = false;
  for (let i = 0; i < 10; i++) {
    const tab = await chrome.tabs.get(flowTab.id);
    if (tab.status === 'complete') {
      tabReady = true;
      break;
    }
    await sleep(1000);
  }

  if (!tabReady) {
    console.log('VidFlow BG: Tab no terminó de cargar, continuando de todos modos...');
  }

  await sleep(2000); // Espera adicional para JavaScript de la página

  // Notificar que estamos conectando
  notifyProgress(0, workflowState.totalItems, 'Conectando con Flow...');

  // Intentar conectar con el content script con reintentos
  const connected = await connectToContentScript(flowTab.id, workflowState.config);

  if (!connected) {
    workflowState.isRunning = false;
    unregisterDownloadListener();
    notifyProgress(0, workflowState.totalItems, 'Error: No se pudo conectar');
    return { success: false, error: 'No se pudo conectar con Flow. Recarga la página de Flow e intenta de nuevo.' };
  }

  notifyProgress(0, workflowState.totalItems, 'Conectado! Analizando proyecto...');
  console.log('VidFlow BG: Conectado correctamente, analizando proyecto...');

  // ========== DETECTAR ESTADO Y REANUDAR ==========
  // Verificar si hay videos existentes en el proyecto
  // Inicializar lista de índices pendientes (por defecto, todos)
  workflowState.pendingIndexes = null; // null = procesar todos en orden

  // Skip resume detection if config says so (e.g. from OpenClaw bridge)
  if (data.config?.skipResume) {
    console.log('VidFlow BG: skipResume=true, saltando detección de existentes');
  } else try {
    const projectState = await chrome.tabs.sendMessage(flowTab.id, { action: 'getProjectState' });

    if (projectState.success && projectState.inProject && projectState.videoCount > 0) {
      console.log('VidFlow BG: Proyecto existente detectado:', projectState);

      const existingPrompts = projectState.prompts || [];

      if (existingPrompts.length > 0 && workflowState.prompts.length > 0) {
        // OPCIÓN B: Comparar prompts para encontrar EXACTAMENTE cuáles faltan
        const missingIndexes = [];
        let foundCount = 0;

        for (let i = 0; i < workflowState.prompts.length; i++) {
          const batchPrompt = workflowState.prompts[i].prompt || workflowState.prompts[i];
          const batchPromptNormalized = (typeof batchPrompt === 'string' ? batchPrompt : '').trim();

          // Buscar si este prompt ya existe (comparar prompt COMPLETO)
          const alreadyExists = existingPrompts.some(existing => {
            const existingNormalized = (existing || '').trim();
            // Comparar prompt completo para evitar falsos positivos
            // (muchos prompts empiezan igual pero son diferentes)
            return existingNormalized === batchPromptNormalized;
          });

          if (alreadyExists) {
            foundCount++;
            console.log(`VidFlow BG: Prompt ${i + 1} ya existe`);
          } else {
            missingIndexes.push(i);
            console.log(`VidFlow BG: Prompt ${i + 1} FALTA - se generará`);
          }
        }

        if (missingIndexes.length === 0) {
          // Todos los videos ya existen
          console.log('VidFlow BG: Todos los prompts ya tienen videos generados');
          notifyProgress(workflowState.totalItems, workflowState.totalItems,
            `¡Todos los ${foundCount} videos ya están generados!`);
          workflowState.isRunning = false;
          return { success: true, message: 'Todos los videos ya existen' };
        }

        // Guardar índices pendientes para procesar solo esos
        workflowState.pendingIndexes = missingIndexes;
        workflowState.currentIndex = 0; // Índice dentro de pendingIndexes
        workflowState.resumedFrom = foundCount;
        downloadCounter = foundCount;

        console.log(`VidFlow BG: ${foundCount} videos ya existen, faltan ${missingIndexes.length}: [${missingIndexes.map(i => i + 1).join(', ')}]`);
        notifyProgress(foundCount, workflowState.totalItems,
          `Reanudando: ${foundCount}/${workflowState.totalItems} existen. Faltan videos: ${missingIndexes.map(i => i + 1).join(', ')}`);

        await sleep(3000); // Dar tiempo para leer el mensaje

      } else {
        // OPCIÓN A (fallback): No hay prompts para comparar, usar conteo simple
        const existingCount = projectState.videoCount;

        if (existingCount >= workflowState.totalItems) {
          console.log(`VidFlow BG: ${existingCount} videos existentes >= ${workflowState.totalItems} prompts. Todos generados.`);
          notifyProgress(workflowState.totalItems, workflowState.totalItems,
            `Todos los videos ya están generados (${existingCount} existentes, ${workflowState.totalItems} en batch)`);
          workflowState.isRunning = false;
          return { success: true, message: 'Todos los videos ya existen en el proyecto' };
        } else if (existingCount > 0) {
          // Asumir que los primeros N ya están hechos (menos preciso pero funciona si se generó en orden)
          console.log(`VidFlow BG: Fallback - ${existingCount} videos detectados, reanudando desde ${existingCount + 1}`);
          workflowState.currentIndex = existingCount;
          workflowState.resumedFrom = existingCount;
          downloadCounter = existingCount;

          notifyProgress(existingCount, workflowState.totalItems,
            `Reanudando (por conteo): ${existingCount} videos detectados, continuando desde video ${existingCount + 1}`);

          await sleep(2000);
        }
      }
    } else {
      console.log('VidFlow BG: No hay proyecto existente o está vacío, empezando desde cero');
    }
  } catch (stateError) {
    console.log('VidFlow BG: No se pudo detectar estado del proyecto:', stateError.message);
    // Continuar normalmente desde el inicio
  }

  console.log('VidFlow BG: Preparando para iniciar generación...');
  console.log(`VidFlow BG: currentIndex=${workflowState.currentIndex}, totalItems=${workflowState.totalItems}, pendingIndexes=${JSON.stringify(workflowState.pendingIndexes)}`);

  notifyProgress(workflowState.currentIndex, workflowState.totalItems, 'Iniciando generación...');

  // Start processing
  console.log('VidFlow BG: Llamando a processNextFlowVideo...');
  await processNextFlowVideo(flowTab.id);

  console.log('VidFlow BG: processNextFlowVideo completado');
  return { success: true };
}

// Modo paralelo: máximo videos en cola simultáneamente
// Flow tiene límite de rate, usamos 4 para ser seguros
const MAX_PARALLEL_VIDEOS = 2;

async function processNextFlowVideo(tabId) {
  if (!workflowState.isRunning || workflowState.currentStep !== 'flow') {
    console.log(`VidFlow BG: processNextFlowVideo ABORTADO - isRunning=${workflowState.isRunning}, currentStep=${workflowState.currentStep}`);
    return;
  }

  // Inicializar contador de videos activos si no existe
  if (!workflowState.activeVideos) {
    workflowState.activeVideos = [];
  }

  // Determinar cuántos items quedan por procesar
  // Si pendingIndexes está definido, usamos esos índices específicos
  // Si no, procesamos secuencialmente desde currentIndex
  const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
  const totalToProcess = usePendingIndexes
    ? workflowState.pendingIndexes.length
    : workflowState.totalItems;

  // Verificar si terminamos
  // No contar stale videos — ya no bloquean el pipeline
  const nonStaleActive = workflowState.activeVideos.filter(v => !v.stale);
  if (workflowState.currentIndex >= totalToProcess) {
    if (nonStaleActive.length > 0) {
      console.log('VidFlow BG: Todos enviados, esperando', nonStaleActive.length, 'videos en cola...');
      return; // El content script monitoreará y notificará cuando terminen
    }
    await completeFlowWorkflow();
    return;
  }

  // Modo paralelo: calcular cuántos podemos enviar (stale no cuentan)
  const canSend = MAX_PARALLEL_VIDEOS - nonStaleActive.length;
  const remaining = totalToProcess - workflowState.currentIndex;
  const toSend = Math.min(canSend, remaining);

  // Log de estado detallado
  const staleCount = workflowState.activeVideos.length - nonStaleActive.length;
  console.log('╔════════════════════════════════════════════════════════════');
  console.log('║ ESTADO DE VIDEOS');
  console.log('╠════════════════════════════════════════════════════════════');
  console.log(`║ Total a procesar: ${totalToProcess} | Ya procesados: ${workflowState.currentIndex}`);
  console.log(`║ Max simultáneos: ${MAX_PARALLEL_VIDEOS} | Activos ahora: ${nonStaleActive.length}${staleCount ? ` (+${staleCount} stale)` : ''}`);
  console.log(`║ Puede enviar: ${canSend} | Enviará: ${toSend}`);
  if (workflowState.activeVideos.length > 0) {
    console.log('║ Videos en cola:');
    workflowState.activeVideos.forEach(v => {
      console.log(`║   - Video #${v.index + 1}: "${v.prompt}..."`);
    });
  }
  if (workflowState.generatedVideos && workflowState.generatedVideos.length > 0) {
    console.log(`║ Completados: ${workflowState.generatedVideos.length}`);
  }
  if (workflowState.failedVideos && workflowState.failedVideos.length > 0) {
    console.log(`║ Fallidos: ${workflowState.failedVideos.length}`);
    workflowState.failedVideos.forEach(v => {
      console.log(`║   - Video #${v.index + 1}: ${v.error}`);
    });
  }
  console.log('╚════════════════════════════════════════════════════════════');

  if (toSend === 0) {
    console.log('VidFlow BG: Cola llena, esperando que termine algún video...');
    return;
  }

  // Enviar múltiples videos a la cola
  for (let i = 0; i < toSend; i++) {
    // Si usamos pendingIndexes, el índice real del prompt es pendingIndexes[currentIndex]
    // Si no, el índice real es currentIndex directamente
    const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
    const realPromptIdx = usePendingIndexes
      ? workflowState.pendingIndexes[workflowState.currentIndex]
      : workflowState.currentIndex;

    const promptData = workflowState.prompts[realPromptIdx];
    console.log(`VidFlow BG: Procesando índice ${workflowState.currentIndex} -> prompt real #${realPromptIdx + 1}`);

    console.log('VidFlow BG: Prompt data:', JSON.stringify(promptData, null, 2));
    console.log('VidFlow BG: Prompt text:', promptData?.prompt);

    if (!promptData || !promptData.prompt) {
      console.error('VidFlow BG: ERROR - promptData o promptData.prompt es undefined!');
      console.error('VidFlow BG: workflowState.prompts:', workflowState.prompts);
      workflowState.currentIndex++;
      continue;
    }

    notifyProgress(realPromptIdx + 1, workflowState.totalItems, `Enviando video ${realPromptIdx + 1} a cola...`);

    // Determinar qué imagen usar
    // IMPORTANTE: En modo batch, la imagen corresponde al índice REAL del prompt
    let imageData = null;
    let referenceNeeded = promptData.referenceNeeded;

    if (workflowState.config.useBatch && workflowState.batchImages.length > 0) {
      const batchImage = workflowState.batchImages[realPromptIdx];
      if (batchImage) {
        imageData = batchImage.data;
        referenceNeeded = 'batch';
        console.log(`VidFlow BG: Usando imagen batch #${realPromptIdx + 1}: ${batchImage.name}`);
        // DEBUG: Mostrar fingerprint para verificar que es diferente
        const fingerprint = imageData.substring(50, 100);
        console.log(`VidFlow BG: DEBUG ImageData fingerprint: ${fingerprint}`);
        // PERF: Release image from memory after extracting data.
        // Each base64 image is ~500KB-2MB; for 58 images this frees ~40MB progressively.
        workflowState.batchImages[realPromptIdx] = null;
      }
    } else if (promptData.referenceNeeded && workflowState.references[promptData.referenceNeeded]) {
      imageData = workflowState.references[promptData.referenceNeeded];
      console.log(`VidFlow BG: Usando referencia de categoría: ${promptData.referenceNeeded}`);
    }

    // Detectar si es el primer video de esta sesión (para saber si crear proyecto o reanudar)
    const isFirstOfThisSession = workflowState.activeVideos.length === 0 &&
                                  workflowState.generatedVideos.length === 0;

    const messageData = {
      index: realPromptIdx, // Usar el índice real del prompt
      prompt: promptData.prompt,
      category: promptData.category,
      referenceNeeded: referenceNeeded,
      imageData: imageData,
      config: workflowState.config,
      isFirstOfSession: isFirstOfThisSession // Flag para indicar si es el primer video de la sesión
    };

    console.log('VidFlow BG: Enviando a content script:', messageData.prompt?.substring(0, 50), '- Tiene imagen:', !!imageData);

    // Añadir a activos ANTES de enviar
    // IMPORTANTE: Guardar prompt completo para matching preciso
    workflowState.activeVideos.push({
      index: realPromptIdx,
      prompt: promptData.prompt, // Prompt completo, no truncado
      sceneNumber: promptData.sceneNumber ?? (realPromptIdx + 1),
      startTime: Date.now()
    });

    // Incrementar índice ANTES de enviar (para el siguiente del loop)
    workflowState.currentIndex++;

    try {
      // MODO PARALELO: Enviar con noWait=true para no esperar generación
      // La UI de Flow necesita secuencialidad para subir imágenes,
      // pero podemos enviar el siguiente mientras el anterior genera
      messageData.noWait = true;

      await chrome.tabs.sendMessage(tabId, {
        action: 'generateFlowVideo',
        data: messageData
      });

      // El content script notificará con flowVideoQueued cuando envíe,
      // y desde ahí enviaremos el siguiente

    } catch (error) {
      console.error('VidFlow BG: Error enviando mensaje:', error.message);

      // Si el content script se desconectó, intentar reconectar
      if (error.message.includes('Could not establish connection') ||
          error.message.includes('Receiving end does not exist')) {
        console.log('VidFlow BG: Content script desconectado, intentando reconectar...');

        // Remover de activos porque no se envió
        workflowState.activeVideos = workflowState.activeVideos.filter(v => v.index !== realPromptIdx);
        // Decrementar currentIndex para reintentar este prompt
        workflowState.currentIndex--;

        // Intentar reinyectar el content script
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: [
              'content/flow/utils.js',
              'content/flow/log.js',
              'content/flow/selectors.js',
              'content/flow/settings.js',
              'content/flow/generation-type.js',
              'content/flow/generation-image.js',
              'content/flow/generation.js',
              'content/flow/video.js',
              'content/flow/pipeline.js',
              'content/flow/detect.js',
              'content/flow/monitor.js',
              'content/flow/main.js'
            ]
          });
          console.log('VidFlow BG: Content script reinyectado, esperando...');
          await sleep(3000);

          // Reconectar
          const connected = await connectToContentScript(tabId, workflowState.config);
          if (connected) {
            console.log('VidFlow BG: Reconexión exitosa');

            // IMPORTANTE: Reiniciar el monitor primero
            // El monitor murió con el content script anterior
            console.log('VidFlow BG: Reiniciando monitor de descargas...');
            try {
              await chrome.tabs.sendMessage(tabId, {
                action: 'startDownloadMonitor',
                data: { restart: true }
              });
              console.log('VidFlow BG: Monitor reiniciado');
            } catch (monitorError) {
              console.error('VidFlow BG: Error reiniciando monitor:', monitorError.message);
            }

            // Esperar un poco para que el monitor se estabilice
            await sleep(2000);

            // Reintentar enviando el siguiente video
            console.log('VidFlow BG: Reintentando envío de video...');
            await processNextFlowVideo(tabId);
          } else {
            console.error('VidFlow BG: No se pudo reconectar con content script');
          }
        } catch (injectError) {
          console.error('VidFlow BG: Error reinyectando script:', injectError.message);
        }
      } else {
        // Otro tipo de error, solo remover de activos
        workflowState.activeVideos = workflowState.activeVideos.filter(v => v.index !== realPromptIdx);
      }
    }

    // Solo enviar uno a la vez (el content script encadenará el siguiente)
    break;
  }
}

async function handleFlowVideoQueued(data) {
  console.log(`VidFlow BG: Video ${data.index + 1} encolado en Google Flow`);

  // Actualizar tiempo de actividad
  workflowState.lastActivityTime = Date.now();

  // Calcular total a procesar considerando pendingIndexes
  const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
  const totalToProcess = usePendingIndexes
    ? workflowState.pendingIndexes.length
    : workflowState.totalItems;

  // DEBUG: Estado actual
  console.log(`VidFlow BG: DEBUG handleFlowVideoQueued - currentIndex=${workflowState.currentIndex}, totalToProcess=${totalToProcess}, totalItems=${workflowState.totalItems}`);

  // El video está en la cola de Google, enviar el siguiente si hay espacio
  // Usar el tabId guardado en lugar de buscar por URL (evita confusión con múltiples tabs)
  let flowTabId = workflowState.flowTabId || pipelineState?.flow?.tabId;

  // Fallback: buscar por URL si no hay tabId guardado
  if (!flowTabId) {
    const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
    const flowTab = tabs.find(t => t.url.includes('video-fx'));
    flowTabId = flowTab?.id;
  }

  console.log(`VidFlow BG: DEBUG - flowTabId: ${flowTabId}, condición para siguiente: ${workflowState.currentIndex} < ${totalToProcess} = ${workflowState.currentIndex < totalToProcess}`);

  // Verificar si podemos enviar más videos (stale no cuentan para el límite)
  const nonStaleActiveHere = workflowState.activeVideos.filter(v => !v.stale);
  const canSendMore = nonStaleActiveHere.length < MAX_PARALLEL_VIDEOS;
  const hasMoreToSend = workflowState.currentIndex < totalToProcess;

  console.log(`VidFlow BG: canSendMore=${canSendMore}, hasMoreToSend=${hasMoreToSend}, activeVideos=${nonStaleActiveHere.length}`);

  if (flowTabId && canSendMore && hasMoreToSend) {
    console.log(`VidFlow BG: Enviando siguiente video (currentIndex=${workflowState.currentIndex})...`);
    await new Promise(r => setTimeout(r, 500));
    await processNextFlowVideo(flowTabId);
  } else if (flowTabId && nonStaleActiveHere.length > 0) {
    // Cola llena o ya enviamos todos los pendientes, pero hay videos generándose
    // Iniciar/continuar monitor de descargas
    console.log(`VidFlow BG: Cola llena o todos enviados. Iniciando monitor (${nonStaleActiveHere.length} activos)...`);
    notifyProgress(workflowState.currentIndex, workflowState.totalItems,
      `Monitoreando ${nonStaleActiveHere.length} videos en generación...`);

    // Pasar información de qué videos monitorear
    await chrome.tabs.sendMessage(flowTabId, {
      action: 'startDownloadMonitor',
      data: {
        totalVideos: nonStaleActiveHere.length,
        activeVideos: nonStaleActiveHere.map(v => ({
          index: v.index,
          prompt: v.prompt
        })),
        hasMoreToSend: hasMoreToSend
      }
    });
  } else if (workflowState.currentIndex >= totalToProcess && nonStaleActiveHere.length === 0) {
    // Ya terminamos todo
    console.log(`VidFlow BG: Todos los videos completados!`);
    await completeFlowWorkflow();
  } else if (!flowTabId) {
    console.error('VidFlow BG: ERROR - No se encontró tabId de Flow para continuar');
  }

  return { success: true };
}

async function handleFlowVideoError(data) {
  console.log('╔════════════════════════════════════════════════════════════');
  console.log(`║ ERROR EN VIDEO #${data.index + 1}`);
  console.log(`║ Tipo: ${data.error}`);
  console.log(`║ Mensaje: ${data.message}`);
  console.log('╚════════════════════════════════════════════════════════════');

  // Remover de videos activos ya que falló
  if (workflowState.activeVideos) {
    workflowState.activeVideos = workflowState.activeVideos.filter(v => v.index !== data.index);
  }

  // Inicializar lista de fallidos si no existe
  if (!workflowState.failedVideos) {
    workflowState.failedVideos = [];
  }

  // Añadir a lista de fallidos para tracking
  workflowState.failedVideos.push({
    index: data.index,
    error: data.error,
    message: data.message,
    timestamp: Date.now()
  });

  // Si es rate limit, añadir a lista de pendientes para reintentar
  if (data.error === 'rate_limit') {
    if (!workflowState.rateLimitedVideos) {
      workflowState.rateLimitedVideos = [];
    }
    workflowState.rateLimitedVideos.push({
      index: data.index,
      message: data.message,
      timestamp: Date.now()
    });

    console.log(`VidFlow BG: Video ${data.index + 1} añadido a cola de rate limit (${workflowState.rateLimitedVideos.length} en espera)`);

    // Notificar al usuario
    notifyProgress(data.index + 1, workflowState.totalItems,
      `Rate limit - esperando para reintentar video ${data.index + 1}...`);

    // Esperar 60 segundos antes de reintentar
    setTimeout(async () => {
      if (!workflowState.isRunning) return;

      console.log('VidFlow BG: Reintentando videos con rate limit...');

      // Encontrar el tab de Flow
      const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
      const flowTab = tabs.find(t => t.url.includes('video-fx') || t.url.includes('flow'));

      if (flowTab && workflowState.rateLimitedVideos && workflowState.rateLimitedVideos.length > 0) {
        // Volver a intentar el primer video con rate limit
        const videoToRetry = workflowState.rateLimitedVideos.shift();
        console.log(`VidFlow BG: Reintentando video ${videoToRetry.index + 1}...`);

        // Decrementar currentIndex para que este video se reenvíe
        // Pero solo si no estamos usando pendingIndexes
        if (!Array.isArray(workflowState.pendingIndexes)) {
          workflowState.currentIndex--;
        }

        await processNextFlowVideo(flowTab.id);
      }
    }, 60000);
  }

  // Continuar con el siguiente video inmediatamente (el que falló ya no está en activos)
  const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
  const flowTab = tabs.find(t => t.url.includes('video-fx') || t.url.includes('flow'));

  const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
  const totalToProcess = usePendingIndexes
    ? workflowState.pendingIndexes.length
    : workflowState.totalItems;

  if (flowTab && workflowState.currentIndex < totalToProcess) {
    console.log('VidFlow BG: Continuando con siguiente video después de error...');
    await processNextFlowVideo(flowTab.id);
  }

  return { success: true };
}

/**
 * Descarga un video directamente usando su URL via chrome.downloads API
 * Esto evita que Google Flow abra el video en nueva pestaña
 */
async function handleDownloadVideoUrl(data) {
  const { url, promptText } = data;

  if (!url) {
    console.error('VidFlow BG: downloadVideoUrl sin URL!');
    return { success: false, error: 'No URL provided' };
  }

  console.log(`VidFlow BG: Descargando video via URL directa`);
  console.log(`VidFlow BG: Prompt: "${promptText?.substring(0, 50)}..."`);

  // Intentar identificar el video para generar el nombre correcto
  let filename = 'flow_video.mp4';
  let matchedVideo = null;

  if (workflowState.activeVideos && workflowState.activeVideos.length > 0) {
    // Intentar match por prompt
    if (promptText && promptText.length > 5) {
      const promptToMatch = promptText.toLowerCase().trim().replace(/\s+/g, ' ');

      for (let i = 0; i < workflowState.activeVideos.length; i++) {
        const activeVideo = workflowState.activeVideos[i];
        const activePrompt = (activeVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');

        if (activePrompt === promptToMatch || activePrompt.includes(promptToMatch) || promptToMatch.includes(activePrompt)) {
          console.log(`VidFlow BG: Match encontrado - Video #${activeVideo.index + 1}`);
          matchedVideo = workflowState.activeVideos.splice(i, 1)[0];
          break;
        }
      }
    }

    // Fallback a FIFO
    if (!matchedVideo && workflowState.activeVideos.length > 0) {
      console.log('VidFlow BG: Sin match por prompt, usando FIFO');
      matchedVideo = workflowState.activeVideos.shift();
    }

    if (matchedVideo) {
      const videoIndex = matchedVideo.index;
      filename = `${String(videoIndex + 1).padStart(3, '0')}_flow_video.mp4`;

      // Añadir a generados
      workflowState.generatedVideos.push({
        index: videoIndex,
        prompt: matchedVideo.prompt,
        filename: filename,
        timestamp: Date.now()
      });
    }
  }

  const sceneNumber = matchedVideo ? (matchedVideo.sceneNumber ?? (matchedVideo.index + 1)) : null;

  try {
    // Usar chrome.downloads.download() para forzar descarga
    const downloadId = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    });

    // Registrar esta descarga como iniciada por VidFlow con sceneNumber
    registerVidFlowDownload(downloadId, sceneNumber);

    console.log(`VidFlow BG: Descarga iniciada con ID: ${downloadId}, archivo: ${filename}`);

    return {
      success: true,
      downloadId: downloadId,
      filename: filename
    };
  } catch (error) {
    console.error('VidFlow BG: Error en chrome.downloads.download:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Prepara la descarga de un video ANTES de que se inicie.
 * Hace match por prompt y añade el sceneNumber a la cola para que
 * onDeterminingFilename lo use cuando Chrome llame.
 */
async function handlePrepareFlowDownload(data) {
  // Si viene con sceneNumber explícito (desde pipeline mode), usarlo directamente
  if (data.sceneNumber != null) {
    const sceneNumber = data.sceneNumber;
    const promptKey = (data.promptText || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (promptKey) {
      pendingPromptSceneMap.set(promptKey, sceneNumber);
      setTimeout(() => pendingPromptSceneMap.delete(promptKey), 120000);
    }
    console.log(`VidFlow BG: prepareFlowDownload directo - escena #${sceneNumber}`);
    return { success: true, sceneNumber };
  }

  if (!workflowState.activeVideos || workflowState.activeVideos.length === 0) {
    console.log('VidFlow BG: prepareFlowDownload pero no hay videos activos');
    return { success: false, sceneNumber: null };
  }

  const promptText = data.promptText || '';
  console.log(`VidFlow BG: Preparando descarga para prompt: "${promptText.substring(0, 60)}..."`);

  // Guard: si este prompt ya fue descargado, ignorar (duplicado de reintento)
  const normalizedPrompt = promptText.toLowerCase().trim().replace(/\s+/g, ' ');
  if (workflowState.generatedVideos) {
    const alreadyDownloaded = workflowState.generatedVideos.some(v => {
      const vPrompt = (v.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');
      return vPrompt === normalizedPrompt;
    });
    if (alreadyDownloaded) {
      console.log(`VidFlow BG: Prompt ya descargado, ignorando duplicado de reintento`);
      return { success: false, sceneNumber: null, skip: true };
    }
  }

  // Build set of activeVideo indices already claimed by pending downloads
  // This prevents the same activeVideo from being matched to two different downloads
  const claimedIndices = new Set();
  for (const entry of preparedDownloadMap.values()) {
    claimedIndices.add(entry.matchedIndex);
  }

  // Buscar el video que coincide con este prompt usando BEST MATCH scoring
  // El DOM de Google Flow puede truncar o modificar el texto del prompt,
  // así que usamos longest common prefix como score en vez de "primer match parcial"
  const promptToMatch = promptText.toLowerCase().trim().replace(/\s+/g, ' ');
  let matchedVideo = null;
  let matchedIndex = -1;
  let bestScore = 0;
  let matchMethod = 'NONE';
  let tiedCount = 0; // Track ties for logging

  for (let i = 0; i < workflowState.activeVideos.length; i++) {
    const activeVideo = workflowState.activeVideos[i];
    const activePrompt = (activeVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');

    if (activePrompt === promptToMatch) {
      // Exact match — allowed even for awaitingRetry (this IS the retry completing)
      // Exact match IGNORES claimed status (it's unambiguous)
      if (activeVideo.awaitingRetry) {
        activeVideo.awaitingRetry = false;
        console.log(`VidFlow BG: Match exacto con video awaitingRetry #${activeVideo.index + 1} — retry completado`);
      }
      matchedVideo = activeVideo;
      matchedIndex = i;
      matchMethod = 'EXACT';
      break;
    }

    // Score by longest common prefix (más preciso que "includes")
    if (activeVideo.awaitingRetry || activeVideo.permanentlyFailed) continue;
    // Skip videos already claimed by another pending download
    if (claimedIndices.has(activeVideo.index)) continue;

    const minLen = Math.min(activePrompt.length, promptToMatch.length);
    let prefixLen = 0;
    for (let j = 0; j < minLen; j++) {
      if (activePrompt[j] === promptToMatch[j]) prefixLen++;
      else break;
    }
    if (prefixLen > bestScore && prefixLen >= 20) {
      bestScore = prefixLen;
      matchedVideo = activeVideo;
      matchedIndex = i;
      matchMethod = `PREFIX_${prefixLen}`;
      tiedCount = 1;
    } else if (prefixLen === bestScore && prefixLen >= 20) {
      tiedCount++;
    }
  }

  if (tiedCount > 1) {
    console.log(`VidFlow BG: ⚠️ ${tiedCount} prompts empatados con prefix score ${bestScore} — elegido scene #${matchedVideo?.sceneNumber ?? '?'} (claimed ${claimedIndices.size} already)`);
  }

  if (!matchedVideo) {
    // Fallback: usar el primero de la cola que NO esté awaitingRetry/stale/claimed
    const fifoIdx = workflowState.activeVideos.findIndex(v =>
      !v.awaitingRetry && !v.permanentlyFailed && !v.stale && !claimedIndices.has(v.index));
    if (fifoIdx !== -1) {
      console.log('VidFlow BG: Sin match por prompt, usando FIFO (saltando awaitingRetry/stale/claimed)');
      matchedVideo = workflowState.activeVideos[fifoIdx];
      matchedIndex = fifoIdx;
      matchMethod = 'FIFO';
    } else {
      // Incluir stale/claimed como último recurso
      const anyIdx = workflowState.activeVideos.findIndex(v => !v.permanentlyFailed);
      if (anyIdx !== -1) {
        matchedVideo = workflowState.activeVideos[anyIdx];
        matchedIndex = anyIdx;
      } else {
        matchedVideo = workflowState.activeVideos[0];
        matchedIndex = 0;
      }
      matchMethod = 'FIFO_LAST_RESORT';
      console.log('VidFlow BG: Sin match por prompt, usando FIFO_LAST_RESORT');
    }
  }

  console.log(`VidFlow BG: prepareFlowDownload match method=${matchMethod}, score=${bestScore}, scene=#${matchedVideo?.sceneNumber ?? '?'}, index=${matchedVideo?.index}`);

  const sceneNumber = matchedVideo.sceneNumber ?? (matchedVideo.index + 1);

  // Store prompt → sceneNumber mapping for browser-initiated downloads
  const promptKey = (matchedVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');
  pendingPromptSceneMap.set(promptKey, sceneNumber);
  setTimeout(() => pendingPromptSceneMap.delete(promptKey), 120000);

  // Store videoUrl → sceneNumber for URL-based matching (most reliable)
  // Use both video ID extraction AND full URL path for maximum reliability
  if (data.videoUrl) {
    // Method 1: Extract video ID from URL (e.g., /video/abcc1234... → abcc1234)
    const urlMatch = data.videoUrl.match(/\/video\/([^/?]+)/);
    if (urlMatch) {
      const videoId = urlMatch[1];
      pendingVideoUrlMap.set(videoId, sceneNumber);
      setTimeout(() => pendingVideoUrlMap.delete(videoId), 120000);
      console.log(`VidFlow BG: ✓ Preparado sceneNumber=${sceneNumber} videoId=${videoId.substring(0, 12)}...`);
    }
    // Method 2: Store full URL path (without query params) for storage.googleapis.com URLs
    try {
      const urlPath = new URL(data.videoUrl).pathname;
      pendingVideoUrlMap.set(urlPath, sceneNumber);
      setTimeout(() => pendingVideoUrlMap.delete(urlPath), 120000);
      if (!urlMatch) {
        console.log(`VidFlow BG: ✓ Preparado sceneNumber=${sceneNumber} urlPath=${urlPath.substring(0, 40)}...`);
      }
    } catch (e) {
      if (!urlMatch) {
        console.log(`VidFlow BG: ✓ Preparado sceneNumber=${sceneNumber} (sin videoId/urlPath extraíble)`);
      }
    }
  } else {
    console.log(`VidFlow BG: ✓ Preparado sceneNumber=${sceneNumber} (sin videoUrl)`);
  }

  // Store the pre-matched result so handleFlowVideoDownloaded can reuse it
  if (data.videoUrl) {
    preparedDownloadMap.set(data.videoUrl, {
      sceneNumber,
      matchedIndex: matchedVideo.index,
      prompt: matchedVideo.prompt
    });
    setTimeout(() => preparedDownloadMap.delete(data.videoUrl), 120000);
  }

  return { success: true, sceneNumber: sceneNumber };
}

/**
 * Maneja cuando el monitor reporta que descargó un video
 * Intenta identificar qué video es por el prompt, con fallback a FIFO
 */
async function handleFlowVideoDownloaded(data) {
  if (!workflowState.activeVideos || workflowState.activeVideos.length === 0) {
    console.error('VidFlow BG: flowVideoDownloaded pero no hay videos activos!');
    return { success: false, error: 'No active videos' };
  }

  let downloadedVideo = null;
  let matchMethod = 'FIFO';

  // Method 1: Use the pre-matched entry from prepareFlowDownload (most reliable)
  if (data.videoUrl && preparedDownloadMap.has(data.videoUrl)) {
    const prepared = preparedDownloadMap.get(data.videoUrl);
    preparedDownloadMap.delete(data.videoUrl);

    // Find and remove the specific activeVideo entry by index
    const idx = workflowState.activeVideos.findIndex(v => v.index === prepared.matchedIndex);
    if (idx !== -1) {
      downloadedVideo = workflowState.activeVideos.splice(idx, 1)[0];
      matchMethod = 'PREPARED_URL';
      console.log(`VidFlow BG: Match por PREPARED_URL - Video #${downloadedVideo.index + 1} (scene ${downloadedVideo.sceneNumber})`);
    }
  }

  // Method 2: Prompt matching (fallback)
  if (!downloadedVideo && data.promptText && data.promptText.length > 10) {
    console.log(`VidFlow BG: Intentando match por prompt completo (${data.promptText.length} chars): "${data.promptText.substring(0, 80)}..."`);

    const promptToMatch = data.promptText.toLowerCase().trim().replace(/\s+/g, ' ');

    let bestMatch = null;
    let bestMatchScore = 0;
    let bestMatchIndex = -1;

    for (let i = 0; i < workflowState.activeVideos.length; i++) {
      const activeVideo = workflowState.activeVideos[i];
      if (activeVideo.permanentlyFailed) continue;
      const activePrompt = (activeVideo.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');

      if (activePrompt === promptToMatch) {
        // Exact match — allowed even for awaitingRetry
        if (activeVideo.awaitingRetry) {
          console.log(`VidFlow BG: ¡Match EXACTO con awaitingRetry! Video #${activeVideo.index + 1} — retry completado`);
        } else {
          console.log(`VidFlow BG: ¡Match EXACTO! Video #${activeVideo.index + 1} (scene ${activeVideo.sceneNumber})`);
        }
        downloadedVideo = workflowState.activeVideos.splice(i, 1)[0];
        matchMethod = 'PROMPT_EXACT';
        break;
      }

      // Score by longest common prefix — skip awaitingRetry entries
      if (!activeVideo.awaitingRetry) {
        const minLen = Math.min(activePrompt.length, promptToMatch.length);
        let prefixLen = 0;
        for (let j = 0; j < minLen; j++) {
          if (activePrompt[j] === promptToMatch[j]) prefixLen++;
          else break;
        }
        if (prefixLen > bestMatchScore && prefixLen >= 20) {
          bestMatchScore = prefixLen;
          bestMatch = activeVideo;
          bestMatchIndex = i;
        }
      }
    }

    if (!downloadedVideo && bestMatch && bestMatchScore >= 20) {
      console.log(`VidFlow BG: Match parcial por prefix (score: ${bestMatchScore}): Video #${bestMatch.index + 1} (scene ${bestMatch.sceneNumber})`);
      downloadedVideo = workflowState.activeVideos.splice(bestMatchIndex, 1)[0];
      matchMethod = `PROMPT_PREFIX_${bestMatchScore}`;
    }
  }

  // Method 3: FIFO (last resort) — skip permanently failed, awaitingRetry AND stale entries
  if (!downloadedVideo) {
    const fifoIdx = workflowState.activeVideos.findIndex(v => !v.permanentlyFailed && !v.awaitingRetry && !v.stale);
    if (fifoIdx !== -1) {
      console.log('VidFlow BG: Sin match por prompt/URL, usando FIFO (saltando awaitingRetry/stale)');
      downloadedVideo = workflowState.activeVideos.splice(fifoIdx, 1)[0];
    } else {
      // Incluir stale como último recurso
      const anyIdx = workflowState.activeVideos.findIndex(v => !v.permanentlyFailed);
      if (anyIdx !== -1) {
        downloadedVideo = workflowState.activeVideos.splice(anyIdx, 1)[0];
      } else {
        downloadedVideo = workflowState.activeVideos.shift();
      }
      console.log('VidFlow BG: Sin match, usando FIFO_LAST_RESORT');
    }
  }

  const videoIndex = downloadedVideo.index;
  const sceneNumber = downloadedVideo.sceneNumber ?? (videoIndex + 1);
  const filename = `${String(sceneNumber).padStart(3, '0')}_flow_video.mp4`;

  console.log(`VidFlow BG: Video #${videoIndex + 1} (escena ${sceneNumber}) descargado como ${filename} (método: ${matchMethod})`);


  console.log(`VidFlow BG: Video #${videoIndex + 1} descargado como ${filename}`);

  // Añadir a generados
  workflowState.generatedVideos.push({
    index: videoIndex,
    filename: filename,
    path: `VidFlow Downloads/${filename}`
  });

  await saveState();

  // Calcular progreso
  const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
  const totalToGenerate = usePendingIndexes
    ? workflowState.pendingIndexes.length
    : workflowState.totalItems;

  const resumedFrom = workflowState.resumedFrom || 0;
  const totalProgress = resumedFrom + workflowState.generatedVideos.length;

  // Log de estado
  console.log('╔════════════════════════════════════════════════════════════');
  console.log(`║ VIDEO #${videoIndex + 1} DESCARGADO`);
  console.log(`║ Archivo: ${filename}`);
  console.log(`║ Progreso: ${totalProgress}/${workflowState.totalItems}`);
  console.log(`║ Videos activos restantes: ${workflowState.activeVideos.length}`);
  console.log(`║ Videos por enviar: ${totalToGenerate - workflowState.currentIndex}`);
  console.log('╚════════════════════════════════════════════════════════════');

  notifyProgress(totalProgress, workflowState.totalItems,
    `Video ${videoIndex + 1} descargado (${totalProgress}/${workflowState.totalItems})`);

  // Verificar si terminamos
  if (workflowState.generatedVideos.length >= totalToGenerate) {
    await completeFlowWorkflow();
    return { success: true, filename, complete: true };
  }

  // Si hay más videos por enviar y ahora hay espacio, enviar el siguiente
  const hasMoreToSend = workflowState.currentIndex < totalToGenerate;
  const nonStaleCount = workflowState.activeVideos.filter(v => !v.stale).length;
  const hasSpace = nonStaleCount < MAX_PARALLEL_VIDEOS;

  console.log(`VidFlow BG: Después de descarga - hasMoreToSend=${hasMoreToSend}, hasSpace=${hasSpace}`);
  console.log(`VidFlow BG: currentIndex=${workflowState.currentIndex}, totalToGenerate=${totalToGenerate}, activeVideos=${nonStaleCount}`);

  if (hasMoreToSend && hasSpace) {
    console.log('VidFlow BG: Hay espacio, enviando siguiente video...');

    // IMPORTANTE: Usar flowTabId guardado, no buscar por URL
    // Buscar por URL puede encontrar tabs incorrectas si hay múltiples
    let flowTabId = workflowState.flowTabId || pipelineState?.flow?.tabId;

    if (!flowTabId) {
      // Solo como fallback, buscar por URL
      console.log('VidFlow BG: WARN: flowTabId no guardado, buscando por URL...');
      const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
      const flowTab = tabs.find(t => t.url.includes('video-fx') || t.url.includes('flow'));
      flowTabId = flowTab?.id;
    }

    if (flowTabId) {
      await new Promise(r => setTimeout(r, 500));
      await processNextFlowVideo(flowTabId);
    } else {
      console.error('VidFlow BG: No se encontró tab de Flow para enviar siguiente video');
    }
  }

  return { success: true, filename, index: videoIndex };
}

async function handleFlowVideoGenerated(data) {
  // Esta función ahora es un fallback para compatibilidad
  // La lógica principal está en handleFlowVideoDownloaded

  // Remover de videos activos por índice específico (si se conoce)
  if (workflowState.activeVideos && data.index !== undefined) {
    workflowState.activeVideos = workflowState.activeVideos.filter(v => v.index !== data.index);
  }

  workflowState.generatedVideos.push({
    index: data.index,
    filename: data.filename,
    path: data.path
  });

  await saveState();

  const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
  const totalToGenerate = usePendingIndexes
    ? workflowState.pendingIndexes.length
    : workflowState.totalItems;

  const resumedFrom = workflowState.resumedFrom || 0;
  const totalProgress = resumedFrom + workflowState.generatedVideos.length;

  console.log(`VidFlow BG: Video ${data.index + 1} generado. Activos: ${workflowState.activeVideos?.length}, Generados: ${workflowState.generatedVideos.length}/${totalToGenerate}`);

  notifyProgress(totalProgress, workflowState.totalItems,
    `Video ${data.index + 1} descargado (${totalProgress}/${workflowState.totalItems})`);

  if (workflowState.generatedVideos.length >= totalToGenerate) {
    await completeFlowWorkflow();
    return { success: true };
  }

  const hasMoreToSend = workflowState.currentIndex < totalToGenerate;
  const hasSpace = (workflowState.activeVideos?.filter(v => !v.stale).length || 0) < MAX_PARALLEL_VIDEOS;

  if (hasMoreToSend && hasSpace) {
    const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
    const flowTab = tabs.find(t => t.url.includes('video-fx') || t.url.includes('flow'));

    if (flowTab) {
      await new Promise(r => setTimeout(r, 500));
      await processNextFlowVideo(flowTab.id);
    }
  }

  return { success: true };
}

/**
 * Maneja el estado reportado por el monitor
 * Si hay espacio para más videos, envía el siguiente
 */
async function handleMonitorStatus(data) {
  const { generating, readyToDownload, totalDownloaded } = data;

  console.log(`VidFlow BG: Monitor reporta - Generando: ${generating}, Listos: ${readyToDownload}, Descargados: ${totalDownloaded}`);

  // Actualizar tiempo de actividad
  workflowState.lastActivityTime = Date.now();

  // Calcular si podemos enviar más
  const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
  const totalToProcess = usePendingIndexes
    ? workflowState.pendingIndexes.length
    : workflowState.totalItems;

  const hasMoreToSend = workflowState.currentIndex < totalToProcess;
  const hasSpace = generating < MAX_PARALLEL_VIDEOS;

  console.log(`VidFlow BG: hasMoreToSend=${hasMoreToSend}, hasSpace=${hasSpace}`);
  console.log(`VidFlow BG: currentIndex=${workflowState.currentIndex}, totalToProcess=${totalToProcess}, totalItems=${workflowState.totalItems}`);

  if (hasMoreToSend && hasSpace) {
    console.log('VidFlow BG: Hay espacio, enviando siguiente video...');

    // Usar el tabId guardado si existe, sino buscar
    let flowTabId = workflowState.flowTabId;

    if (!flowTabId) {
      const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
      const flowTab = tabs.find(t => t.url.includes('video-fx') || t.url.includes('flow'));
      flowTabId = flowTab?.id;
    }

    if (flowTabId) {
      await new Promise(r => setTimeout(r, 500));
      await processNextFlowVideo(flowTabId);
    } else {
      console.error('VidFlow BG: No se encontró pestaña de Flow');
    }
  }

  return { success: true };
}

/**
 * Maneja un posible deadlock detectado por el monitor
 * Esto ocurre cuando el monitor no ve videos pero el background cree que hay activos
 */
async function handleMonitorDeadlock(data) {
  console.log('VidFlow BG: ⚠️ DEADLOCK detectado por monitor:', data);

  // Force complete: monitor gave up after repeated deadlocks without progress
  if (data.forceComplete) {
    console.log('VidFlow BG: Monitor solicitó finalización forzada');
    const downloaded = workflowState.generatedVideos?.length || 0;
    const total = workflowState.totalItems || 0;
    notifyProgress(total, total, `Finalizado con ${downloaded}/${total} videos (resto no disponibles)`);
    await completeFlowWorkflow();
    return { success: true, forceCompleted: true };
  }

  const activeCount = workflowState.activeVideos?.length || 0;

  console.log(`VidFlow BG: Videos activos según background: ${activeCount}`);

  if (activeCount > 0) {
    console.log('VidFlow BG: Marcando videos activos como stale (preservando scene numbers)...');

    // Marcar como stale en vez de borrar — así si completan,
    // el monitor aún puede hacer match con su sceneNumber original
    for (const video of workflowState.activeVideos) {
      video.stale = true;
      console.log(`VidFlow BG: Video #${video.index + 1} (escena ${video.sceneNumber}) marcado como stale`);
    }

    // Si hay más videos por enviar, intentar enviar
    const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
    const totalToProcess = usePendingIndexes
      ? workflowState.pendingIndexes.length
      : workflowState.totalItems;

    const hasMoreToSend = workflowState.currentIndex < totalToProcess;

    if (hasMoreToSend) {
      console.log('VidFlow BG: Hay más videos por enviar, reintentando...');

      let flowTabId = workflowState.flowTabId;
      if (!flowTabId) {
        const tabs = await chrome.tabs.query({ url: '*://labs.google/*' });
        const flowTab = tabs.find(t => t.url.includes('video-fx') || t.url.includes('flow'));
        flowTabId = flowTab?.id;
      }

      if (flowTabId) {
        await new Promise(r => setTimeout(r, 3000));
        await processNextFlowVideo(flowTabId);
      }
    } else {
      console.log('VidFlow BG: No hay más videos por enviar. Puede que el workflow esté estancado.');
    }
  }

  return { success: true, handled: true };
}

/**
 * Maneja un video que agotó todos los reintentos y se considera permanentemente fallido
 * Esto permite que el workflow complete incluso si algunos videos no se pudieron generar
 */
function handleFlowVideoPermanentlyFailed(data) {
  console.log(`VidFlow BG: Video PERMANENTEMENTE FALLIDO: "${data.promptText?.substring(0, 40)}..."`);

  if (!workflowState.permanentlyFailedCount) {
    workflowState.permanentlyFailedCount = 0;
  }
  workflowState.permanentlyFailedCount++;

  // Mark the activeVideo as permanently failed but DON'T remove it.
  // The last retry might still be generating in Flow.
  // If it succeeds → handleFlowVideoDownloaded will remove it.
  // If it truly fails → checkWorkflowComplete will count it as done.
  if (workflowState.activeVideos && workflowState.activeVideos.length > 0) {
    const promptToMatch = (data.promptText || '').toLowerCase().trim().replace(/\s+/g, ' ');

    // Use best-match scoring (longest common prefix) instead of 40-char prefix
    let bestEntry = null;
    let bestScore = 0;
    for (const v of workflowState.activeVideos) {
      const videoPrompt = (v.prompt || '').toLowerCase().trim().replace(/\s+/g, ' ');
      if (videoPrompt === promptToMatch) {
        bestEntry = v;
        break; // exact match
      }
      const minLen = Math.min(videoPrompt.length, promptToMatch.length);
      let prefixLen = 0;
      for (let j = 0; j < minLen; j++) {
        if (videoPrompt[j] === promptToMatch[j]) prefixLen++;
        else break;
      }
      if (prefixLen > bestScore && prefixLen >= 20) {
        bestScore = prefixLen;
        bestEntry = v;
      }
    }
    if (bestEntry) {
      bestEntry.permanentlyFailed = true;
      console.log(`VidFlow BG: Marcado video #${bestEntry.index + 1} como permanentlyFailed (score=${bestScore}, no removido)`);
    }
  }

  console.log(`VidFlow BG: Permanentemente fallidos: ${workflowState.permanentlyFailedCount}`);
  return { success: true };
}

/**
 * Verifica si el workflow está completo
 */
function checkWorkflowComplete() {
  const usePendingIndexes = Array.isArray(workflowState.pendingIndexes);
  const totalToProcess = usePendingIndexes
    ? workflowState.pendingIndexes.length
    : workflowState.totalItems;

  const allSent = workflowState.currentIndex >= totalToProcess;
  const permanentlyFailed = workflowState.permanentlyFailedCount || 0;
  const generatedCount = (workflowState.generatedVideos?.length || 0);
  // Contar videos permanentemente fallidos como "procesados" para permitir que el workflow complete
  const allGenerated = (generatedCount + permanentlyFailed) >= totalToProcess;
  // Count only non-permanently-failed and non-stale entries as truly active
  const realActiveCount = workflowState.activeVideos?.filter(v => !v.permanentlyFailed && !v.stale).length || 0;

  // IMPORTANTE: No completar si hay videos activos aún generándose (stale no bloquean)
  const isComplete = allSent && allGenerated && realActiveCount === 0;

  console.log(`VidFlow BG: checkWorkflowComplete - allSent=${allSent}, allGenerated=${allGenerated}, activeVideos=${workflowState.activeVideos?.length || 0} (real=${realActiveCount}), complete=${isComplete}`);
  console.log(`VidFlow BG: generados=${generatedCount}/${totalToProcess}, fallidos permanentes=${permanentlyFailed}, currentIndex=${workflowState.currentIndex}`);

  // Si está completo y el workflow sigue marcado como running, disparar la completion
  if (isComplete && workflowState.isRunning) {
    console.log('VidFlow BG: checkWorkflowComplete → disparando completeFlowWorkflow()');
    workflowState.isRunning = false; // Evitar doble-trigger
    completeFlowWorkflow();
  }

  return {
    complete: isComplete,
    sent: workflowState.currentIndex,
    generated: workflowState.generatedVideos?.length || 0,
    active: workflowState.activeVideos?.length || 0,
    total: totalToProcess
  };
}

async function startFlowPipeline(data) {
  console.log('VidFlow BG: Iniciando modo pipeline con', data.prompts?.length, 'prompts');

  // Verificar estado
  if (workflowState.isRunning) {
    const lastActivity = workflowState.lastActivityTime || 0;
    const timeSinceActivity = Date.now() - lastActivity;
    if (timeSinceActivity < 2 * 60 * 1000) {
      return { success: false, error: 'Ya hay un workflow en ejecución' };
    }
  }

  workflowState.isRunning = true;
  workflowState.currentStep = 'flow-pipeline';
  workflowState.lastActivityTime = Date.now();
  workflowState.totalItems = data.prompts?.length || 0;
  workflowState.prompts = data.prompts || [];
  workflowState.currentIndex = 0;
  workflowState.generatedVideos = [];
  workflowState.activeVideos = [];

  // Setear folderName para que el download listener renombre correctamente
  if (data.config?.folderName) {
    workflowState.folderName = data.config.folderName;
  }

  startKeepalive();

  // Registrar listener de descargas
  registerDownloadListener();

  // Usar la pestaña del bridge si fue enviado desde una, sino buscar
  let tabId = data.__bridgeTabId || null;
  if (!tabId) {
    const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/*flow*' });
    if (tabs.length === 0) {
      workflowState.isRunning = false;
      unregisterDownloadListener();
      return { success: false, error: 'No hay pestaña de Flow abierta' };
    }
    tabId = tabs[0].id;
  }
  workflowState.flowTabId = tabId; // Guardar para download listener y otros handlers
  console.log('VidFlow BG: Pipeline usando tabId:', tabId);

  // Inyectar content script si es necesario
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        'content/flow/utils.js',
        'content/flow/log.js',
        'content/flow/selectors.js',
        'content/flow/settings.js',
        'content/flow/generation-type.js',
        'content/flow/generation-image.js',
        'content/flow/generation.js',
        'content/flow/video.js',
        'content/flow/pipeline.js',
        'content/flow/detect.js',
        'content/flow/monitor.js',
        'content/flow/main.js'
      ]
    });
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    console.log('VidFlow BG: Script ya inyectado o error:', e.message);
  }

  // Preparar prompts con índice (preservar sceneNumber si viene)
  const prompts = data.prompts.map((p, i) => ({
    prompt: p.prompt || p,
    index: i,
    sceneNumber: p.sceneNumber ?? (i + 1),
    referenceImage: p.referenceImage || null
  }));

  // Enviar al content script (fire-and-forget, NO await)
  // El pipeline corre en el content script de forma independiente.
  // Si hacemos await, Chrome cierra el canal de mensajes antes de que
  // termine el pipeline y eso mata todo el workflow.
  chrome.tabs.sendMessage(tabId, {
    action: 'runFlowPipeline',
    data: {
      prompts: prompts,
      config: data.config || {}
    }
  }).then(response => {
    console.log('VidFlow BG: Pipeline content script respondió:', response);
  }).catch(error => {
    // Esto ya no es fatal — el pipeline puede seguir corriendo
    // aunque el canal de mensajes se cierre
    console.warn('VidFlow BG: Canal de mensajes cerrado (no fatal):', error.message);
  });

  console.log('VidFlow BG: Pipeline enviado al content script (fire-and-forget)');
  return { success: true };
}

async function completeFlowWorkflow() {
  workflowState.currentStep = null;
  workflowState.isRunning = false;
  stopKeepalive();

  // Si estamos en modo pipeline lineal, llamar a completeFlowStep (no desregistrar listener aún)
  if (workflowState.isPipelineMode && pipelineState.isRunning) {
    // Copiar videos generados al estado del pipeline
    pipelineState.flow.generatedVideos = workflowState.generatedVideos.map(v => ({
      index: v.index,
      filename: v.filename
    }));
    await completeFlowStep();
    return;
  }

  // Workflow terminado sin pipeline - desregistrar listener
  unregisterDownloadListener();

  chrome.runtime.sendMessage({
    action: 'workflowComplete',
    step: 'flow',
    generatedVideos: workflowState.generatedVideos
  });
}
