/**
 * VidFlow - Flow Content Script (Entry Point)
 * Automates interactions with Google Flow (VEO)
 * URL: https://labs.google/fx/es/tools/flow
 * Detection functions in detect.js, download monitor in monitor.js.
 */

(function() {
  'use strict';

  // Evitar múltiples inyecciones
  if (window.vidflowLoaded) {
    console.log('VidFlow: Script ya cargado, ignorando reinyección');
    return;
  }
  window.vidflowLoaded = true;

  console.log('VidFlow Flow content script loaded - URL:', window.location.href);

  // ========== STATE ==========
  window.isAutomating = false;
  window.currentConfig = {};
  window.sessionId = null; // ID único de la sesión actual para evitar race conditions
  window.sessionStartTime = 0; // Timestamp de inicio de la sesión para proteger contra race conditions
  window.isMonitorRunning = false; // Flag para evitar múltiples instancias del monitor

  // ========== MESSAGE LISTENER ==========
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('VidFlow Flow received:', message.action);

    (async () => {
      try {
        let result;

        switch (message.action) {
          case 'setupFlow':
            result = await setupFlow(message.data);
            break;

          case 'generateFlowVideo':
            result = await generateVideo(message.data);
            break;

          case 'generateFlowVideoParallel':
            // Modo paralelo: enviar a cola sin esperar
            result = await generateVideoParallel(message.data);
            break;

          case 'startDownloadMonitor':
            // Iniciar monitor de descargas para modo paralelo
            result = await startDownloadMonitor(message.data);
            break;

          case 'createProjectAndSetImageMode':
            initLogPanel();
            vfLog('Creando nuevo proyecto...', 'step');
            await goToHomeAndCreateProject();
            await sleep(2000);
            await switchToImageMode();
            result = { success: true };
            break;

          case 'generateFlowImage':
            initLogPanel();
            result = await generateFlowImage(message.data.prompt, message.data.index);
            break;

          case 'generateImageThenVideo':
            initLogPanel();
            if (message.data.config) currentConfig = message.data.config;
            result = await generateImageThenVideo(
              message.data.imagePrompt,
              message.data.videoPrompt,
              message.data.index,
              message.data.config || {},
              message.data.sceneNumber || null
            );
            break;

          case 'animateLastImage':
            result = await animateLastImage();
            break;

          case 'waitAndDownloadVideos':
            initLogPanel();
            result = await waitAndDownloadAllVideos(
              message.data.expectedCount,
              message.data.sceneNumbers || message.data.sceneIndices || [],
              message.data.videoPrompts || [],
              message.data.folderPrefix || '',
              message.data.maxWaitMs || 600000
            );
            break;

          case 'switchToVideoMode':
            await switchToVideoMode();
            result = { success: true };
            break;

          case 'switchToImageMode':
            await switchToImageMode();
            result = { success: true };
            break;

          case 'runFlowPipeline':
            isAutomating = true;
            initLogPanel();
            currentConfig = message.data.config || {};
            // NO await — responder inmediatamente y correr el pipeline en background.
            // Si hacemos await, Chrome cierra el canal de mensajes antes de que
            // termine el pipeline y eso mata todo.
            runPipelineMode(message.data.prompts, message.data.config)
              .then(r => console.log('VidFlow Pipeline terminado:', r))
              .catch(e => console.error('VidFlow Pipeline error:', e));
            result = { success: true, message: 'Pipeline iniciado' };
            break;

          case 'stopAutomation':
            stopAutomation(message.data || {});
            result = { success: true };
            break;

          case 'getProjectState':
            // Detectar videos existentes en el proyecto actual
            result = await getExistingProjectState();
            break;

          default:
            result = { success: false, error: 'Unknown action' };
        }

        sendResponse(result);
      } catch (error) {
        console.error('VidFlow Flow error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep channel open for async
  });

  // Notificar que estamos listos
  console.log('VidFlow: Listener registrado, notificando al background...');
  chrome.runtime.sendMessage({ action: 'contentScriptReady', page: 'flow' })
    .then(() => console.log('VidFlow: Background notificado OK'))
    .catch((e) => console.log('VidFlow: Background no disponible:', e.message));

  // ========== SETUP ==========

  async function setupFlow(data) {
    try {
      await clearLogs();
      initLogPanel();

      // Generar nuevo ID de sesión y guardar timestamp para evitar race conditions
      window.sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      window.sessionStartTime = Date.now();
      window.isMonitorRunning = false; // Resetear flag del monitor para nueva sesión
      console.log('VidFlow: Nueva sesión iniciada:', window.sessionId, 'at', window.sessionStartTime);

      isAutomating = true;
      currentConfig = data.config || {};

      // Anti-throttle: AudioContext silencioso para que Chrome no pause la tab en segundo plano
      if (window._vfAntiThrottle) { try { window._vfAntiThrottle(); } catch(_){} }
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        window._vfAntiThrottle = () => { try { osc.stop(); ctx.close(); } catch(_){} };
      } catch(_) {}

      // Resetear el tracking de video para nueva sesión
      window.lastDownloadedVideoSrc = null;

      vfLog('═══════════════════════════════════════', 'step');
      vfLog('VidFlow iniciado', 'step');
      vfLog('═══════════════════════════════════════', 'step');

      if (currentConfig.useBatch) {
        vfLog('MODO BATCH ACTIVADO', 'success');
        vfLog('Cada prompt usará su imagen correspondiente por orden', 'info');
      } else {
        vfLog('Modo: Categorías de referencia', 'info');
      }
      vfLog('Modelo: ' + (currentConfig.veoModel || 'default'), 'info');
      vfLog('Orientación: ' + (currentConfig.aspectRatio || '16:9'), 'info');

      await waitForPageReady();
      vfLog('Página lista', 'success');

      return { success: true };
    } catch (error) {
      vfLog('Error en setup: ' + error.message, 'error');
      return { success: false, error: error.message };
    }
  }

  // ========== PROJECT STATE DETECTION ==========

  /**
   * Detecta el estado del proyecto actual usando la API interna de Google Flow.
   * Esto evita problemas de virtualización del DOM.
   * - Cuenta videos existentes via API
   * - Devuelve info para poder reanudar
   */
  async function getExistingProjectState() {
    try {
      const url = window.location.href;
      const isInProject = url.includes('/project/');

      if (!isInProject) {
        return {
          success: true,
          inProject: false,
          videoCount: 0,
          prompts: [],
          message: 'No estamos en un proyecto, se creará uno nuevo'
        };
      }

      // Extraer ID del proyecto
      const projectId = url.split('/project/')[1]?.split(/[?#]/)[0] || 'unknown';

      console.log('VidFlow: Detectando estado del proyecto via API:', projectId);

      // Usar la API interna de Google Flow para obtener todos los workflows
      const input = {
        json: {
          pageSize: 100, // Pedir muchos para obtener todos
          projectId: projectId,
          toolName: "PINHOLE",
          fetchBookmarked: false,
          rawQuery: "",
          mediaType: "MEDIA_TYPE_VIDEO"
        }
      };

      const apiUrl = `/fx/api/trpc/project.searchProjectWorkflows?input=${encodeURIComponent(JSON.stringify(input))}`;

      try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        // La estructura es: result.data.json.result.workflows
        const allWorkflows = data?.result?.data?.json?.result?.workflows || [];

        // Filtrar solo videos originales (excluir upsampled/escalados)
        // Los upsampled tienen mediaKey con "_upsampled" o genMode "VIDEO_TO_VIDEO"
        const originalWorkflows = allWorkflows.filter(w => {
          const step = w.workflowSteps?.[0];
          const mediaKey = step?.mediaGenerations?.[0]?.mediaGenerationId?.mediaKey || '';
          const genMode = step?.workflowStepLog?.requestData?.videoGenerationRequestData?.videoModelControlInput?.videoGenerationMode || '';

          const isUpsampled = mediaKey.includes('upsampled') || genMode.includes('VIDEO_TO_VIDEO');
          return !isUpsampled;
        });

        const videoCount = originalWorkflows.length;

        console.log('VidFlow: API detectó', videoCount, 'videos originales (', allWorkflows.length, 'total incluyendo upsampled)');

        // Extraer prompts de cada workflow original
        // Los prompts están en varias ubicaciones posibles
        const extractedPrompts = [];
        originalWorkflows.forEach(w => {
          const step = w.workflowSteps?.[0];

          // Intentar extraer prompt de varias ubicaciones (en orden de preferencia)
          const prompt =
            step?.mediaGenerations?.[0]?.mediaData?.videoData?.generatedVideo?.prompt ||
            step?.mediaGenerations?.[0]?.mediaExtraData?.mediaTitle ||
            step?.workflowStepLog?.requestData?.promptInputs?.[0]?.textInput ||
            '';

          if (prompt) {
            extractedPrompts.push({
              workflowId: w.workflowId,
              prompt: prompt,
              createTime: w.createTime
            });
          }
        });

        // NO ordenar - la API ya devuelve en orden de UI (más reciente primero)
        // El orden de la API coincide con lo que ve el usuario en la interfaz

        // Extraer solo los prompts como strings
        const prompts = extractedPrompts.map(p => p.prompt);
        const workflowIds = extractedPrompts.map(p => p.workflowId);

        console.log('VidFlow: Extraídos', prompts.length, 'prompts de videos existentes');

        return {
          success: true,
          inProject: true,
          projectId: projectId,
          videoCount: videoCount,
          workflowIds: workflowIds,
          prompts: prompts, // Prompts completos extraídos de la API
          message: `Proyecto existente con ${videoCount} videos detectados (via API)`
        };

      } catch (apiError) {
        console.warn('VidFlow: Error en API, usando fallback DOM:', apiError.message);

        // Fallback: contar elementos visibles en el DOM
        const veoLabels = Array.from(document.querySelectorAll('*'))
          .filter(el => el.textContent === 'Veo 3.1 - Fast' && el.children.length === 0);

        return {
          success: true,
          inProject: true,
          projectId: projectId,
          videoCount: veoLabels.length,
          prompts: [],
          message: `Proyecto existente con ${veoLabels.length} videos detectados (fallback DOM)`
        };
      }

    } catch (error) {
      console.error('VidFlow: Error detectando estado:', error);
      return {
        success: false,
        error: error.message,
        inProject: false,
        videoCount: 0,
        prompts: []
      };
    }
  }

  // ========== PARALLEL MODE STATE ==========
  window.parallelQueue = {
    active: [],      // Videos actualmente generándose [{index, prompt, videoSrc}]
    pending: [],     // Videos pendientes de enviar
    completed: [],   // Videos completados
    maxParallel: 5,  // Máximo en paralelo
    isMonitoring: false
  };

  // ========== SEND TO QUEUE (NO WAIT) ==========

  /**
   * Envía un video a la cola de generación SIN esperar a que termine
   */
  async function sendToQueue(data) {
    vfLog(`[COLA] Enviando video ${data.index + 1} a la cola...`, 'info');

    const config = data.config || currentConfig || {};
    const genType = config.generationType || 'text-to-video';
    const isFirstInQueue = parallelQueue.active.length === 0 && parallelQueue.completed.length === 0;

    // Si es el primero, crear proyecto y configurar
    if (isFirstInQueue) {
      vfLog('[COLA] Primer video - creando proyecto...', 'step');
      await goToHomeAndCreateProject();
      await sleep(2000);
      await selectGenerationType(genType);
      await sleep(1500);
      await configureSettings(config);
      await sleep(500);
    } else {
      // Para videos posteriores, preparar la UI
      vfLog('[COLA] Preparando UI para siguiente video...', 'info');

      // Esperar a que la UI se estabilice
      await sleep(1500); // Optimizado de 2s

      // Scroll hacia el prompt input
      const promptEl = findPromptInput();
      if (promptEl) {
        promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);
      }

      // Limpiar prompt anterior
      await clearPromptArea();
      await sleep(500);
    }

    // Subir imagen si es necesario
    const isBatchMode = data.referenceNeeded === 'batch';
    if (data.imageData && data.referenceNeeded) {
      const imageLabel = isBatchMode ? 'batch #' + (data.index + 1) : data.referenceNeeded;
      vfLog(`[COLA] Subiendo imagen: ${imageLabel}`, 'info');

      // Eliminar imagen anterior si hay
      if (!isFirstInQueue) {
        await removeCurrentImage();
        await sleep(2000); // Más tiempo para que la UI se actualice
      }

      // Esperar a que el área esté lista
      const areaReady = await waitForImageUploadArea();
      if (!areaReady) {
        vfLog('[COLA] WARN: Área no lista, esperando más...', 'warn');
        await sleep(2000);
      }

      await uploadImage(data.imageData, !isFirstInQueue && isBatchMode);
      await sleep(1500);
    }

    // Escribir prompt
    await enterPrompt(data.prompt);
    await sleep(500);

    // Enviar a generar (sin esperar)
    await clickGenerate(currentConfig);
    vfLog(`[COLA] Video ${data.index + 1} enviado a generar`, 'success');

    // Añadir a la lista de activos
    parallelQueue.active.push({
      index: data.index,
      prompt: data.prompt.substring(0, 50),
      startTime: Date.now(),
      videoSrc: null
    });

    await sleep(1500); // Optimizado de 2s - pausa antes del siguiente
  }

  /**
   * Monitorea los videos en la cola y descarga cuando terminan
   */
  async function monitorQueue() {
    if (parallelQueue.isMonitoring) return;
    parallelQueue.isMonitoring = true;

    vfLog('[MONITOR] Iniciando monitoreo de cola...', 'step');

    while (isAutomating && (parallelQueue.active.length > 0 || parallelQueue.pending.length > 0)) {
      await sleep(5000); // Revisar cada 5 segundos

      // Buscar videos completados
      const downloadBtns = document.querySelectorAll('button');
      let completedCount = 0;

      for (const btn of downloadBtns) {
        const btnText = btn.textContent?.toLowerCase() || '';
        if (btnText.includes('descargar') || btnText.includes('download')) {
          completedCount++;
        }
      }

      vfLog(`[MONITOR] Activos: ${parallelQueue.active.length}, Completados detectados: ${completedCount}`, 'info');

      // Si hay videos completados, descargarlos
      if (completedCount > 0 && parallelQueue.active.length > 0) {
        // Descargar el más antiguo
        const oldest = parallelQueue.active[0];
        vfLog(`[MONITOR] Descargando video ${oldest.index + 1}...`, 'success');

        try {
          const filename = await downloadVideo(oldest.index);
          vfLog(`[MONITOR] Video ${oldest.index + 1} descargado: ${filename}`, 'success');

          parallelQueue.completed.push(oldest);
          parallelQueue.active.shift();

          // Notificar
          await chrome.runtime.sendMessage({
            action: 'flowVideoGenerated',
            data: {
              index: oldest.index,
              filename: filename,
              path: `VidFlow Downloads/${filename}`
            }
          });

          // Si hay pendientes, enviar el siguiente
          if (parallelQueue.pending.length > 0) {
            const next = parallelQueue.pending.shift();
            await sendToQueue(next);
          }
        } catch (err) {
          vfLog(`[MONITOR] Error descargando: ${err.message}`, 'error');
        }
      }

      // Verificar timeout (5 minutos por video)
      for (const active of parallelQueue.active) {
        if (Date.now() - active.startTime > 300000) {
          vfLog(`[MONITOR] Timeout en video ${active.index + 1}`, 'warn');
        }
      }
    }

    parallelQueue.isMonitoring = false;
    vfLog('[MONITOR] Monitoreo finalizado', 'step');
  }

  // NOTE: startDownloadMonitor() moved to monitor.js
  // NOTE: findActiveVideoCards(), findCompletedVideoCards(), findDownloadButtons(),
  //        findFailedVideoCards(), retryFailedVideo() moved to detect.js


  /**
   * Genera video en modo paralelo
   * Envía a la cola si hay espacio, o encola para después
   */
  async function generateVideoParallel(data) {
    if (!isAutomating) {
      vfLog('Automatización no activa', 'error');
      return { success: false, error: 'Automation not active' };
    }

    try {
      vfLog('', 'info');
      vfLog('═══════════════════════════════════════', 'step');
      vfLog(`[PARALELO] VIDEO ${data.index + 1}`, 'step');
      vfLog('═══════════════════════════════════════', 'step');

      // Si hay espacio en la cola, enviar directamente
      if (parallelQueue.active.length < parallelQueue.maxParallel) {
        await sendToQueue(data);

        // Iniciar monitor si no está corriendo
        if (!parallelQueue.isMonitoring) {
          // No await - el monitor corre en background
          monitorQueue();
        }
      } else {
        // Encolar para después
        vfLog(`[PARALELO] Cola llena (${parallelQueue.active.length}/${parallelQueue.maxParallel}), encolando video ${data.index + 1}`, 'warn');
        parallelQueue.pending.push(data);
      }

      return { success: true, queued: true };

    } catch (error) {
      vfLog('═══════════════════════════════════════', 'error');
      vfLog('ERROR: ' + error.message, 'error');
      vfLog('═══════════════════════════════════════', 'error');
      return { success: false, error: error.message };
    }
  }

  // ========== MAIN VIDEO GENERATION ==========

  async function generateVideo(data) {
    if (!isAutomating) {
      vfLog('Automatización no activa', 'error');
      return { success: false, error: 'Automation not active' };
    }

    try {
      vfLog('', 'info');
      vfLog('═══════════════════════════════════════', 'step');
      vfLog(`GENERANDO VIDEO ${data.index + 1}`, 'step');
      vfLog('═══════════════════════════════════════', 'step');

      const isBatchMode = data.referenceNeeded === 'batch';
      vfLog('Modo: ' + (isBatchMode ? 'BATCH (imagen #' + (data.index + 1) + ')' : 'Categorías'), 'info');
      vfLog('Prompt: ' + (data.prompt ? data.prompt.substring(0, 80) + '...' : 'UNDEFINED!'), 'info');
      if (isBatchMode) {
        vfLog('Usando imagen batch #' + (data.index + 1), 'success');
        // DEBUG: Mostrar fingerprint de la imagen recibida para verificar que es diferente
        if (data.imageData) {
          const imgFingerprint = data.imageData.substring(50, 100); // Parte del base64 que varía
          vfLog('DEBUG ImageData fingerprint: ' + imgFingerprint, 'warn');
        }
      } else {
        vfLog('ImageData: ' + (data.imageData ? 'Sí (' + data.referenceNeeded + ')' : 'No (texto puro)'), 'info');
      }

      if (!data.prompt || typeof data.prompt !== 'string' || data.prompt.trim().length === 0) {
        vfLog('ERROR: Prompt inválido o undefined!', 'error');
        vfLog('data.prompt = ' + JSON.stringify(data.prompt), 'error');
        throw new Error('No se recibió un prompt válido');
      }

      const config = data.config || currentConfig || {};
      const genType = config.generationType || 'text-to-video';
      const isFirstVideo = data.index === 0;
      const isResumingSession = data.isFirstOfSession && data.index > 0; // Reanudando desde un índice > 0

      // PASO 1: Solo crear proyecto para primer video REAL (no al reanudar)
      if (isFirstVideo && !isResumingSession) {
        vfLog('[1/7] Navegando al home y creando nuevo proyecto...', 'step');
        await goToHomeAndCreateProject();
        await sleep(2000);

        vfLog('[2/7] Configurando tipo de generación...', 'step');
        await selectGenerationType(genType);
        await sleep(1500);

        // Verificar que el tipo realmente cambió (Flow a veces ignora la selección)
        const actualType = await getCurrentGenerationType();
        if (actualType !== genType && actualType !== 'unknown') {
          vfLog('Tipo no cambió (actual: ' + actualType + '), reintentando...', 'warn');
          await selectGenerationType(genType);
          await sleep(1500);
          const retryType = await getCurrentGenerationType();
          if (retryType !== genType && retryType !== 'unknown') {
            vfLog('Tipo sigue incorrecto tras reintento: ' + retryType, 'error');
          }
        }
        vfLog('Tipo de generación configurado: ' + genType, 'success');
      } else if (isResumingSession) {
        // Reanudando: no crear proyecto, solo configurar para el siguiente video
        vfLog('[1/7] REANUDANDO en proyecto existente (video ' + (data.index + 1) + ')...', 'step');
        vfLog('[2/7] Preparando para continuar...', 'step');

        // Limpiar área de prompt por si hay algo
        await clearPromptArea();
        await sleep(500);

        // Verificar tipo de generación
        const needsImage = data.imageData && data.referenceNeeded;
        const currentGenType = await getCurrentGenerationType();

        if (needsImage && currentGenType === 'text-to-video') {
          vfLog('Cambiando a "Imágenes a vídeo"...', 'info');
          await selectGenerationType('image-to-video');
          await sleep(1000);
        }
        vfLog('Configuración de reanudación lista', 'success');
      } else {
        vfLog('[1/7] Preparando siguiente video (mismo proyecto)...', 'step');
        await clearPromptArea();
        await sleep(500);

        const needsImage = data.imageData && data.referenceNeeded;
        const currentGenType = await getCurrentGenerationType();

        vfLog('[2/7] Verificando tipo de generación...', 'step');
        vfLog('Prompt necesita imagen: ' + (needsImage ? 'Sí' : 'No') + ', Tipo actual: ' + currentGenType, 'info');

        if (needsImage && currentGenType === 'text-to-video') {
          vfLog('Cambiando a "Imágenes a vídeo"...', 'info');
          await selectGenerationType('image-to-video');
          await sleep(1000);
        } else if (!needsImage && currentGenType === 'image-to-video') {
          vfLog('Cambiando a "Texto a vídeo"...', 'info');
          await selectGenerationType('text-to-video');
          await sleep(1000);
        } else {
          vfLog('Tipo de generación correcto', 'info');
        }
      }

      // PASO 3: Subir imagen si necesario
      vfLog('[3/7] Imagen de referencia...', 'step');

      const promptNeedsImage = data.imageData && data.referenceNeeded;
      const referenceChanged = isBatchMode || (data.referenceNeeded !== currentConfig.lastReference);

      if (promptNeedsImage) {
        if (isFirstVideo || referenceChanged) {
          const imageLabel = isBatchMode ? 'batch #' + (data.index + 1) : data.referenceNeeded;
          vfLog('Subiendo imagen: ' + imageLabel + (referenceChanged && !isFirstVideo ? ' (cambio de imagen)' : ''), 'info');

          // Si no es el primer video, preparar la UI para nueva imagen
          if (!isFirstVideo) {
            // Esperar a que la UI se estabilice después de acciones anteriores
            vfLog('Esperando que la UI se estabilice para siguiente video...', 'info');
            await sleep(3000);

            // Scroll hacia el prompt input para asegurar visibilidad
            const promptEl2 = findPromptInput();
            if (promptEl2) {
              promptEl2.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(500);
            }

            // Eliminar imagen anterior si la hay
            if (isBatchMode || (referenceChanged && currentConfig.lastReference)) {
              const removed = await removeCurrentImage();
              if (removed) {
                vfLog('Esperando que el área de subida se reinicie...', 'info');
                await sleep(3000); // Más tiempo para que la UI se actualice
              } else {
                // Si no había imagen que eliminar, esperar de todos modos
                await sleep(2000);
              }
            }
          }

          // Esperar a que el área de subida esté lista
          const areaReady = await waitForImageUploadArea();
          if (!areaReady) {
            vfLog('WARN: Área de subida no encontrada, intentando de todos modos...', 'warn');
            // Intentar un refresh del área
            await sleep(2000);
          }

          // Subir imagen con verificación de cambio para videos después del primero
          const mustVerifyChange = !isFirstVideo && isBatchMode;
          await uploadImage(data.imageData, mustVerifyChange);
          await sleep(1500);
          vfLog('Imagen subida', 'success');

          currentConfig.lastReference = isBatchMode ? 'batch_' + data.index : data.referenceNeeded;
        } else {
          vfLog('Misma imagen de referencia (' + data.referenceNeeded + '), reutilizando', 'info');
        }
      } else {
        vfLog('Sin imagen de referencia (modo texto)', 'info');

        if (!isFirstVideo && currentConfig.lastReference) {
          vfLog('Eliminando imagen del prompt anterior...', 'info');
          await removeCurrentImage();
          await sleep(500);
          currentConfig.lastReference = null;
        }
      }

      // PASO 4: Configurar ajustes (solo primer video)
      if (isFirstVideo) {
        vfLog('[4/7] Configurando ajustes...', 'step');
        await configureSettings(config);
        await sleep(500);
      } else {
        vfLog('[4/7] Ajustes ya configurados', 'info');
      }

      // PASO 5: Escribir prompt
      vfLog('[5/7] Escribiendo prompt...', 'step');
      await enterPrompt(data.prompt);
      await sleep(1000);
      vfLog('Prompt escrito', 'success');

      // PASO 6: Generar
      vfLog('[6/7] Iniciando generación...', 'step');

      if (!isFirstVideo) {
        await dismissPreviousResult();
      }

      await clickGenerate(currentConfig);
      vfLog('Generación iniciada', 'success');

      // Esperar un poco para detectar posibles errores de rate limit
      await sleep(3000);

      // Verificar si hay error de rate limit en la UI
      const rateLimitError = checkForRateLimitError();
      if (rateLimitError) {
        vfLog('ERROR: Rate limit detectado - ' + rateLimitError, 'error');
        // Notificar al background que hubo error para que reintente después
        await chrome.runtime.sendMessage({
          action: 'flowVideoError',
          data: {
            index: data.index,
            error: 'rate_limit',
            message: rateLimitError
          }
        });
        return { success: false, error: 'rate_limit', message: rateLimitError };
      }

      // Verificar si debemos esperar o continuar
      const noWait = data.noWait || config.parallelMode;

      if (noWait) {
        // MODO PARALELO: No esperar, retornar inmediatamente
        vfLog('[PARALELO] Video enviado a cola, continuando sin esperar...', 'success');

        // Notificar que el video fue encolado (no completado)
        await chrome.runtime.sendMessage({
          action: 'flowVideoQueued',
          data: {
            index: data.index,
            prompt: data.prompt?.substring(0, 50)
          }
        });

        return { success: true, queued: true, index: data.index };
      }

      // MODO SECUENCIAL: Esperar y descargar
      vfLog('[7/7] Esperando generación...', 'step');
      await waitForVideoGeneration();
      vfLog('Video generado!', 'success');

      // Descargar
      vfLog('Descargando video...', 'info');
      const filename = await downloadVideo(data.index);
      vfLog('Video descargado: ' + filename, 'success');

      // Notificar
      await chrome.runtime.sendMessage({
        action: 'flowVideoGenerated',
        data: {
          index: data.index,
          filename: filename,
          path: `VidFlow Downloads/${filename}`
        }
      });

      vfLog('═══════════════════════════════════════', 'step');
      vfLog('VIDEO ' + (data.index + 1) + ' COMPLETADO', 'success');
      vfLog('═══════════════════════════════════════', 'step');

      // Delay
      const delaySeconds = config.delay || 60;
      vfLog('Siguiente video en ' + delaySeconds + 's...', 'info');

      for (let i = delaySeconds; i > 0; i--) {
        if (!isAutomating) break;
        if (i % 10 === 0 || i <= 5) {
          vfLog('Siguiente en ' + i + 's...', 'info');
        }
        await sleep(1000);
      }

      return { success: true, filename };

    } catch (error) {
      vfLog('═══════════════════════════════════════', 'error');
      vfLog('ERROR: ' + error.message, 'error');
      vfLog('Stack: ' + error.stack, 'error');
      vfLog('═══════════════════════════════════════', 'error');
      return { success: false, error: error.message };
    }
  }

  // ========== STOP ==========

  function stopAutomation(data = {}) {
    // Si el mensaje de stop viene con un sessionId diferente, ignorarlo
    if (data.sessionId && window.sessionId && data.sessionId !== window.sessionId) {
      console.log('VidFlow: Ignorando stop de sesión anterior:', data.sessionId, '!= actual:', window.sessionId);
      return;
    }

    // Protección adicional: si la sesión acaba de iniciar (últimos 5 segundos), ignorar stops
    // Esto evita race conditions donde el stop del workflow anterior llega después de iniciar uno nuevo
    const timeSinceStart = Date.now() - (window.sessionStartTime || 0);
    if (timeSinceStart < 5000 && timeSinceStart > 0) {
      console.log('VidFlow: Ignorando stop - sesión iniciada hace solo', timeSinceStart, 'ms');
      return;
    }

    isAutomating = false;
    vfLog('═══════════════════════════════════════', 'warn');
    vfLog('Automatización detenida', 'warn');
    vfLog('═══════════════════════════════════════', 'warn');
    vfLog('Panel de logs permanece abierto para revisión', 'info');
  }

})();

console.log('VidFlow: main.js cargado - Entry point inicializado');
