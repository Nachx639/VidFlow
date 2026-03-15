/**
 * VidFlow - Download Monitor
 * Monitors video generation progress, downloads completed videos, retries failed ones.
 */

async function startDownloadMonitor(data) {
  // ========== PREVENIR MÚLTIPLES INSTANCIAS ==========
  if (window.isMonitorRunning) {
    vfLog('[MONITOR] Ya hay un monitor activo, ignorando llamada duplicada', 'warn');
    return { success: true, skipped: true, reason: 'already_running' };
  }

  window.isMonitorRunning = true;

  vfLog('═══════════════════════════════════════', 'step');
  vfLog('[MONITOR] Iniciando monitoreo de generación', 'step');
  vfLog('[MONITOR] Detección de fallos y retry automático: ACTIVADO', 'info');
  vfLog('═══════════════════════════════════════', 'step');

  const MAX_SIMULTANEOUS = 4;
  const MAX_RETRIES = 3; // Máximo de reintentos por video fallido
  const startTime = Date.now();

  // Timeout dinámico basado en número de videos
  // Consultar al background cuántos videos hay en total
  let totalVideos = 60; // Default si no hay respuesta
  try {
    const stateResponse = await chrome.runtime.sendMessage({ action: 'getWorkflowState' });
    if (stateResponse?.state?.totalItems) {
      totalVideos = stateResponse.state.totalItems;
    }
  } catch (e) {
    console.log('VidFlow: No se pudo obtener totalItems del background');
  }

  // 5 minutos base + 10 minutos por video (con mínimo de 45 minutos)
  // Margen amplio para reintentos, colas llenas, black screen retries
  // 30 videos = 5 + (30 * 10) = 305 minutos (~5h)
  // 11 videos = 5 + (11 * 10) = 115 minutos (~2h)
  const baseTimeMinutes = 5;
  const minutesPerVideo = 10;
  const calculatedMinutes = baseTimeMinutes + (totalVideos * minutesPerVideo);
  const maxWaitTime = Math.max(45, calculatedMinutes) * 60 * 1000;

  vfLog(`[MONITOR] Timeout configurado: ${Math.round(maxWaitTime / 60000)} minutos para ${totalVideos} videos`, 'info');
  let totalDownloaded = 0;
  let totalRetried = 0;
  let lastStatusLog = 0;

  // Tracking de reintentos por prompt
  const retryCount = new Map(); // promptText -> número de reintentos
  const retryLastTime = new Map(); // promptText -> timestamp del último reintento
  const RETRY_COOLDOWN_MS = 90000; // 90s entre reintentos del mismo prompt

  // Tracking de videos ya descargados (para no descargar el mismo dos veces)
  const downloadedVideoUrls = new Set();        // por videoUrl (clave única)
  const downloadedPromptTexts = new Set();      // por promptText (evita duplicados de reintentos)

  // Tracking de tarjetas fallidas ya manejadas (evita re-detectar la misma tarjeta original)
  // Usamos el elemento DOM del botón de prompt como clave, no el texto
  const retriedCardElements = new Set();

  // Tracking de prompts permanentemente fallidos (agotaron todos los reintentos)
  const permanentlyFailed = new Set();

  // Tracking de ciclos sin actividad para detectar deadlock
  let noActivityCycles = 0;
  const MAX_NO_ACTIVITY_CYCLES = 40; // ~2 minutos sin actividad (at 3s check interval)
  let consecutiveDeadlocks = 0; // Deadlocks sin progreso entre ellos
  let downloadsAtLastDeadlock = 0;
  const MAX_CONSECUTIVE_DEADLOCKS = 3; // Tras 3 deadlocks sin progreso (~6 min), forzar fin

  // Keepalive: ping background every 20s to prevent service worker termination
  let lastKeepalivePing = 0;

  try {
    while (isAutomating && Date.now() - startTime < maxWaitTime) {
      await sleep(3000); // Revisar cada 3 segundos (optimizado de 5s)

      // Keepalive ping to background service worker
      if (Date.now() - lastKeepalivePing > 20000) {
        lastKeepalivePing = Date.now();
        chrome.runtime.sendMessage({ action: 'keepalive' }).catch(() => {});
      }

      // ========== REFRESCAR WORKFLOW MAP (para API-based matching) ==========
      try { await getWorkflowMediaMap(true); } catch (e) { /* ignore */ }

      // ========== CONTAR VIDEOS EN GENERACIÓN (MEJORADO) ==========
      // Buscar tarjetas de video individuales, no todos los elementos con %
      const videoCards = findActiveVideoCards();
      const generatingVideos = videoCards.filter(card => card.status === 'generating');

      // ========== BUSCAR TARJETAS DE VIDEO COMPLETADAS ==========
      // Usa findCompletedVideoCards() que evita duplicados y ordena correctamente
      const completedCards = findCompletedVideoCards();

      // ========== DETECTAR VIDEOS FALLIDOS PARA EL LOG ==========
      const failedForLog = findFailedVideoCards();

      // ========== LOG DE ESTADO CADA 15 SEGUNDOS ==========
      // Calcular pendientes para el log (completados - ya descargados)
      // Usamos videoUrl como clave única
      const pendingForLog = completedCards.filter(c => {
        return !downloadedVideoUrls.has(c.videoUrl);
      });

      if (Date.now() - lastStatusLog > 15000) {
        lastStatusLog = Date.now();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const remaining = Math.round((maxWaitTime - (Date.now() - startTime)) / 60000);
        const genCount = generatingVideos.length;
        const compCount = completedCards.length;
        const pendCount = pendingForLog.length;
        const failCount = failedForLog.length;
        const domInfo = (genCount > 0 || compCount > 0 || failCount > 0) ? ` | DOM: ${genCount}gen ${compCount}comp ${failCount}fail` : '';
        vfLog(`[MONITOR] ${mins}m${secs}s — Descargados: ${totalDownloaded}${pendCount > 0 ? ` | Pendientes: ${pendCount}` : ''}${totalRetried > 0 ? ` | Reintentos: ${totalRetried}` : ''}${domInfo}${remaining <= 5 && remaining > 0 ? ` | ⚠️ TIMEOUT EN ${remaining}m` : ''}`, 'info');
      }

      // ========== DETECTAR Y REINTENTAR VIDEOS FALLIDOS ==========
      // Skip retries if we already downloaded all expected videos
      const failedCards = (totalDownloaded >= totalVideos) ? [] : findFailedVideoCards();

      // Filtrar tarjetas ya manejadas, permanentemente fallidas, ya descargadas, o en cooldown
      const now = Date.now();
      const unhandledFailedCards = failedCards.filter(f => {
        if (permanentlyFailed.has(f.promptText)) return false;
        if (retriedCardElements.has(f.promptButton)) return false;
        // Si ya descargamos un video con este prompt, no reintentar
        const normPrompt = f.promptText?.toLowerCase().trim();
        if (normPrompt && downloadedPromptTexts.has(normPrompt)) return false;
        // Cooldown: no reintentar si el último reintento fue hace menos de 90s
        const lastRetry = retryLastTime.get(f.promptText);
        if (lastRetry && (now - lastRetry) < RETRY_COOLDOWN_MS) return false;
        return true;
      });

      if (unhandledFailedCards.length > 0) {
        vfLog(`[MONITOR] ⚠️ Detectados ${unhandledFailedCards.length} videos FALLIDOS`, 'warn');

        for (const failed of unhandledFailedCards) {
          const promptKey = failed.promptText;
          const currentRetries = retryCount.get(promptKey) || 0;
          const shortPrompt = failed.promptText.substring(0, 50);

          if (currentRetries >= MAX_RETRIES) {
            // Marcar como permanentemente fallido y notificar al background
            if (!permanentlyFailed.has(promptKey)) {
              permanentlyFailed.add(promptKey);
              retriedCardElements.add(failed.promptButton);

              vfLog(`[MONITOR] Video "${shortPrompt}..." agotó reintentos (${MAX_RETRIES}), marcando como fallido permanente`, 'error');

              // Notificar al background para que el workflow pueda completar
              await chrome.runtime.sendMessage({
                action: 'flowVideoPermanentlyFailed',
                data: { promptText: failed.promptText }
              });
            }
            continue;
          }

          // Incrementar contador de reintentos y registrar timestamp
          retryCount.set(promptKey, currentRetries + 1);
          retryLastTime.set(promptKey, Date.now());
          totalRetried++;

          vfLog(`[MONITOR] 🔄 Reintentando video fallido (intento ${currentRetries + 1}/${MAX_RETRIES}): "${shortPrompt}..."`, 'warn');

          const retrySuccess = await retryFailedVideo(failed);

          if (retrySuccess) {
            vfLog(`[MONITOR] ✓ Video reenviado a la cola`, 'success');

            // Marcar la tarjeta original como reintentada para no volver a detectarla
            retriedCardElements.add(failed.promptButton);

            // Notificar al background que reintentamos un video
            await chrome.runtime.sendMessage({
              action: 'flowVideoRetried',
              data: {
                promptText: failed.promptText,
                retryNumber: currentRetries + 1
              }
            });

            // Solo reintentar uno por ciclo para no saturar
            await sleep(3000);
            break;
          } else {
            vfLog(`[MONITOR] ✗ No se pudo reintentar el video`, 'error');
          }
        }
      }

      // ========== DESCARGAR SI HAY DISPONIBLES ==========
      // Filtrar videos ya descargados (por URL) y duplicados de reintentos (por prompt)
      const pendingCards = completedCards.filter(c => {
        if (downloadedVideoUrls.has(c.videoUrl)) return false;
        const normPrompt = c.promptText?.toLowerCase().trim();
        if (normPrompt && downloadedPromptTexts.has(normPrompt)) {
          // Reintento duplicado — ya descargamos un video con este prompt
          if (!downloadedVideoUrls.has(c.videoUrl)) {
            downloadedVideoUrls.add(c.videoUrl); // Marcar URL para no re-evaluar
            vfLog(`[MONITOR] Ignorando duplicado de reintento: "${c.promptText?.substring(0, 50)}..."`, 'warn');
          }
          return false;
        }
        return true;
      });

      if (pendingCards.length > 0) {
        // IMPORTANTE: Procesar solo UN video a la vez para evitar confusiones
        // cuando hay múltiples videos completados simultáneamente
        if (pendingCards.length > 1) {
          vfLog(`[MONITOR] ${pendingCards.length} videos listos, descargando UNO a la vez para evitar errores`, 'info');
          // Mostrar todos los videos pendientes para debug
          pendingCards.forEach((c, i) => {
            const preview = c.promptText ? c.promptText.substring(0, 40) : '(sin prompt)';
            vfLog(`[MONITOR]   ${i + 1}. "${preview}..." (pos: ${Math.round(c.position)})`, 'info');
          });
        }

        // Tomar el primer video completado NO descargado (ordenado: más abajo = enviado primero)
        const card = pendingCards[0];

        // DEBUG: Mostrar info detallada del video que vamos a descargar
        const promptPreview = card.promptText ? card.promptText.substring(0, 60) : '(sin prompt detectado)';
        const btnText = card.button?.textContent?.substring(0, 30) || '(sin botón)';
        vfLog(`[MONITOR] ═══════════════════════════════════`, 'info');
        vfLog(`[MONITOR] Video a descargar:`, 'success');
        vfLog(`[MONITOR]   Prompt: "${promptPreview}..."`, 'info');
        vfLog(`[MONITOR]   VideoURL: ${card.videoUrl?.substring(0, 60) || 'N/A'}...`, 'info');
        vfLog(`[MONITOR]   Posición: ${Math.round(card.position)}`, 'info');

        try {
          // Verificar que tenemos forma de descargar (botón overlay, card, o video element)
          if (!card.button && !card.card && !card.videoElement) {
            vfLog('[MONITOR] ERROR: No se encontró botón, card ni video para descargar', 'error');
            continue;
          }

          // Check for black screen before downloading
          if (card.videoElement && await isBlackScreenVideo(card.videoElement)) {
            const promptKey = card.promptText;
            const currentRetries = retryCount.get(promptKey) || 0;
            const MAX_RETRIES_BLACK = 4;
            if (currentRetries < MAX_RETRIES_BLACK) {
              retryCount.set(promptKey, currentRetries + 1);
              retryLastTime.set(promptKey, Date.now());
              vfLog(`[MONITOR] Pantalla negra detectada para "${promptKey?.substring(0, 50)}..." - reintentando (${currentRetries + 1}/${MAX_RETRIES_BLACK})`, 'warn');
              downloadedVideoUrls.add(card.videoUrl); // Skip this black video

              // Re-submit the prompt via prompt input
              const promptInput = findPromptInput();
              if (promptInput) {
                await setPromptText(promptInput, card.promptText);
                await sleep(500);

                // Buscar botón submit real (excluye add_2Crear)
                const submitBtn = findSubmitButton();

                if (submitBtn) {
                  submitBtn.click();
                  vfLog(`[MONITOR] Prompt reenviado para regenerar pantalla negra`, 'success');
                  await chrome.runtime.sendMessage({
                    action: 'flowVideoRetried',
                    data: { promptText: card.promptText, retryNumber: currentRetries + 1 }
                  });
                  // Mark the original card element so we don't try it again
                  retriedCardElements.add(card.button);
                  noActivityCycles = 0; // Reset deadlock counter
                  await sleep(2000);
                } else {
                  vfLog(`[MONITOR] No se encontró botón de enviar para retry de pantalla negra - marcando como fallido`, 'error');
                  permanentlyFailed.add(promptKey);
                  await chrome.runtime.sendMessage({
                    action: 'flowVideoPermanentlyFailed',
                    data: { promptText: card.promptText }
                  });
                }
              } else {
                vfLog(`[MONITOR] No se encontró textarea para retry de pantalla negra - marcando como fallido`, 'error');
                permanentlyFailed.add(promptKey);
                await chrome.runtime.sendMessage({
                  action: 'flowVideoPermanentlyFailed',
                  data: { promptText: card.promptText }
                });
              }
              continue;
            } else {
              vfLog(`[MONITOR] Pantalla negra tras ${MAX_RETRIES_BLACK} reintentos - descargando de todas formas`, 'warn');
            }
          }

          // IMPORTANTE: Notificar al background ANTES de iniciar la descarga
          // Esto permite que el background prepare el sceneNumber correcto
          // para cuando Chrome llame a onDeterminingFilename
          const prepResponse = await chrome.runtime.sendMessage({
            action: 'prepareFlowDownload',
            data: {
              promptText: card.promptText,
              videoUrl: card.videoUrl
            }
          });

          // Si el background dice skip, es un duplicado de reintento ya descargado
          if (prepResponse && prepResponse.skip) {
            vfLog(`[MONITOR] Background indicó skip (duplicado ya descargado)`, 'warn');
            downloadedVideoUrls.add(card.videoUrl);
            if (card.promptText) downloadedPromptTexts.add(card.promptText.toLowerCase().trim());
            continue;
          }

          if (prepResponse && prepResponse.sceneNumber) {
            vfLog(`[MONITOR] Preparado para descargar escena #${prepResponse.sceneNumber}`, 'info');
          }

          vfLog(`[MONITOR] Iniciando descarga...`, 'info');

          // Construir filename con sceneNumber si disponible
          const dlFilename = prepResponse?.sceneNumber
            ? `${String(prepResponse.sceneNumber).padStart(3, '0')}_flow_video.mp4`
            : 'flow_video.mp4';

          let found720 = false;

          // === MÉTODO 1: Descarga directa via API URL (720p por defecto) ===
          if (card.card || card.videoElement) {
            found720 = await downloadViaMoreVertMenu(card.card || card.videoElement?.parentElement, card.videoElement, dlFilename);
          }

          // === MÉTODO 2: Botón de descarga overlay (diseño anterior) ===
          if (!found720 && card.button) {
            card.button.click();
            await sleep(1500);

            const menuOptions = document.querySelectorAll('[role="menuitem"], [role="option"], [role="listbox"] > *, div[class*="menu"] > *');

            for (const opt of menuOptions) {
              const optText = opt.textContent?.toLowerCase() || '';
              if (optText.includes('720') || optText.includes('original')) {
                vfLog('[MONITOR] Seleccionando 720p...', 'info');
                opt.click();
                found720 = true;
                await sleep(2000);
                break;
              }
            }

            if (!found720) {
              for (const opt of menuOptions) {
                const optText = opt.textContent?.toLowerCase() || '';
                if (!optText.includes('gif') && (optText.includes('720') || optText.includes('1080') || optText.includes('tamaño'))) {
                  vfLog(`[MONITOR] Seleccionando: ${opt.textContent?.trim()}`, 'info');
                  opt.click();
                  found720 = true;
                  await sleep(2000);
                  break;
                }
              }
            }
          }

          // === MÉTODO 3: Descarga directa por mediaKey (nuevo Flow) ===
          if (!found720 && card.mediaKey) {
            found720 = await downloadByMediaKey(card.mediaKey, dlFilename);
          }

          if (!found720) {
            vfLog('[MONITOR] WARN: No se encontró opción de descarga, reintentando en próximo ciclo', 'warn');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(500);
            continue;
          }

          // Marcar como descargado (por URL y por prompt para evitar duplicados de reintentos)
          downloadedVideoUrls.add(card.videoUrl);
          if (card.promptText) downloadedPromptTexts.add(card.promptText.toLowerCase().trim());

          totalDownloaded++;
          vfLog(`[MONITOR] Video descargado (Total: ${totalDownloaded})`, 'success');

          // Notificar al background que la descarga se completó
          const response = await chrome.runtime.sendMessage({
            action: 'flowVideoDownloaded',
            data: {
              downloadedCount: totalDownloaded,
              promptText: card.promptText,
              videoUrl: card.videoUrl
            }
          });

          if (response && response.filename) {
            vfLog(`[MONITOR] Guardado como: ${response.filename}`, 'success');
          }

          await sleep(1500); // PERF: Reduced from 3s. UI updates within ~1s. Saves ~87s over 58 videos.

        } catch (err) {
          vfLog(`[MONITOR] Error descargando: ${err.message}`, 'error');
        }
      }

      // ========== NOTIFICAR SI HAY ESPACIO PARA MÁS ==========
      // Notificar al background siempre que no haya pendientes de descargar
      if (pendingCards.length === 0) {
        await chrome.runtime.sendMessage({
          action: 'monitorStatus',
          data: {
            generating: generatingVideos.length,
            readyToDownload: pendingCards.length,
            totalDownloaded: totalDownloaded
          }
        });
      }

      // Si no hay completados pendientes de descargar, verificar si terminamos
      // (no confiamos en generatingVideos.length porque la detección DOM es poco fiable)
      if (pendingCards.length === 0) {
        noActivityCycles++;

        // Preguntar al background si hay más
        const response = await chrome.runtime.sendMessage({
          action: 'checkWorkflowComplete'
        });

        if (response && response.complete) {
          vfLog('[MONITOR] Workflow completado!', 'success');
          break;
        }

        // Si hay muchos ciclos sin actividad pero el workflow no está completo,
        // es posible un deadlock (background cree que hay videos activos pero no los vemos)
        if (noActivityCycles >= MAX_NO_ACTIVITY_CYCLES) {
          vfLog('[MONITOR] ⚠️ POSIBLE DEADLOCK: Sin actividad pero workflow no completo', 'warn');
          vfLog('[MONITOR] Verificando UI de Google Flow...', 'info');

          // Scroll para forzar carga de elementos virtualizados
          window.scrollTo(0, 0);
          await sleep(1000);
          window.scrollTo(0, document.body.scrollHeight);
          await sleep(1000);
          window.scrollTo(0, 0);
          await sleep(1000);

          // Re-verificar después del scroll (forzar refresh de API)
          try { await getWorkflowMediaMap(true); } catch (e) { /* ignore */ }
          const videoCardsAfterScroll = findActiveVideoCards();
          const generatingAfterScroll = videoCardsAfterScroll.filter(c => c.status === 'generating');
          const completedAfterScroll = findCompletedVideoCards();

          if (generatingAfterScroll.length > 0 || completedAfterScroll.length > downloadedVideoUrls.size) {
            vfLog(`[MONITOR] Después de scroll: ${generatingAfterScroll.length} generando, ${completedAfterScroll.length} completados`, 'info');
            noActivityCycles = 0; // Reset si encontramos algo
          } else {
            // Track consecutive deadlocks without progress
            if (totalDownloaded === downloadsAtLastDeadlock) {
              consecutiveDeadlocks++;
            } else {
              consecutiveDeadlocks = 1;
              downloadsAtLastDeadlock = totalDownloaded;
            }

            if (consecutiveDeadlocks >= MAX_CONSECUTIVE_DEADLOCKS) {
              vfLog(`[MONITOR] ${consecutiveDeadlocks} deadlocks consecutivos sin progreso. Finalizando con ${totalDownloaded} videos descargados.`, 'error');
              await chrome.runtime.sendMessage({
                action: 'monitorDeadlock',
                data: {
                  noActivityCycles: noActivityCycles,
                  totalDownloaded: totalDownloaded,
                  forceComplete: true,
                  message: `${consecutiveDeadlocks} deadlocks sin progreso — videos restantes probablemente fallidos`
                }
              });
              break;
            }

            // Notificar al background del posible deadlock
            vfLog(`[MONITOR] Notificando posible deadlock al background... (${consecutiveDeadlocks}/${MAX_CONSECUTIVE_DEADLOCKS})`, 'warn');
            await chrome.runtime.sendMessage({
              action: 'monitorDeadlock',
              data: {
                noActivityCycles: noActivityCycles,
                totalDownloaded: totalDownloaded,
                message: 'Monitor no detecta videos pero workflow no está completo'
              }
            });
            noActivityCycles = 0; // Reset para dar otra oportunidad
          }
        }

        await sleep(3000); // Reducido para reaccionar más rápido al deadlock
      } else {
        // Hay actividad, resetear contador
        noActivityCycles = 0;
      }
    }

    // Detectar razón de salida del loop
    const elapsedMs = Date.now() - startTime;
    const timedOut = elapsedMs >= maxWaitTime;
    const stoppedByUser = !isAutomating;

    if (timedOut) {
      vfLog('═══════════════════════════════════════', 'warn');
      vfLog(`[MONITOR] ⚠️ TIMEOUT ALCANZADO (${Math.round(elapsedMs / 60000)} minutos)`, 'warn');
      vfLog('[MONITOR] Algunos videos pueden no haberse procesado', 'warn');
      vfLog('[MONITOR] Reinicia el pipeline para continuar con los faltantes', 'info');
      vfLog('═══════════════════════════════════════', 'warn');
    } else if (stoppedByUser) {
      vfLog('[MONITOR] Detenido por el usuario', 'warn');
    }

  } finally {
    // Siempre liberar el flag al terminar
    window.isMonitorRunning = false;
  }

  vfLog('═══════════════════════════════════════', 'step');
  vfLog(`[MONITOR] Finalizado`, 'success');
  vfLog(`[MONITOR] Videos descargados: ${totalDownloaded}`, 'success');
  if (totalRetried > 0) {
    vfLog(`[MONITOR] Videos reintentados: ${totalRetried}`, 'info');
  }
  vfLog('═══════════════════════════════════════', 'step');

  return { success: true, downloaded: totalDownloaded, retried: totalRetried };
}

console.log('VidFlow: monitor.js cargado');
