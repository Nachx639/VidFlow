/**
 * VidFlow - Manejo de Videos
 * Creación de proyecto, espera, descarga
 */

// ========== PROJECT CREATION ==========

/**
 * Navega al home y crea un nuevo proyecto
 */
async function goToHomeAndCreateProject() {
  vfLog('Navegando al home de Flow...', 'info');

  const homeUrl = 'https://labs.google/fx/tools/flow';
  const currentUrl = window.location.href;

  if (!currentUrl.endsWith('/flow') && !currentUrl.endsWith('/flow/')) {
    vfLog('Redirigiendo al home: ' + homeUrl, 'info');
    window.location.href = homeUrl;

    await new Promise(resolve => {
      const checkLoaded = setInterval(() => {
        if (document.readyState === 'complete') {
          clearInterval(checkLoaded);
          resolve();
        }
      }, 500);
    });
    await sleep(2000); // Optimizado de 3s - page already fully loaded
  }

  vfLog('Buscando botón "+ Nuevo proyecto"...', 'info');

  let attempts = 0;
  let newProjectBtn = null;

  while (attempts < 15 && !newProjectBtn) {
    const allButtons = document.querySelectorAll('button');

    for (const btn of allButtons) {
      const text = btn.textContent?.trim() || '';
      const textLower = text.toLowerCase();

      if (textLower.includes('nuevo proyecto') || textLower.includes('new project')) {
        const hasIcon = btn.querySelector('[class*="google-symbols"], [class*="icon"], i');
        const isInProjectCard = btn.closest('[class*="card"]')?.querySelector('time, [class*="date"]');

        if (hasIcon && !isInProjectCard) {
          vfLog('Botón encontrado: "' + text.substring(0, 30) + '"', 'success');
          newProjectBtn = btn;
          break;
        }
      }
    }

    if (!newProjectBtn) {
      attempts++;
      vfLog('Buscando botón... intento ' + attempts + '/15', 'info');
      await sleep(1000);
    }
  }

  if (!newProjectBtn) {
    vfLog('ERROR: No se encontró botón "+ Nuevo proyecto"', 'error');
    vfLog('Tip: Asegúrate de estar en el home de Flow', 'warn');
    throw new Error('No se encontró el botón de Nuevo proyecto');
  }

  newProjectBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(500);

  vfLog('Haciendo clic en "+ Nuevo proyecto"...', 'info');
  newProjectBtn.click();
  await sleep(2000); // Optimizado de 3s

  let editorReady = false;
  for (let i = 0; i < 15; i++) {
    if (findPromptInput()) {
      editorReady = true;
      break;
    }
    if (window.location.href.includes('/project/') || window.location.href.includes('/create')) {
      editorReady = true;
      break;
    }
    await sleep(500);
  }

  if (editorReady) {
    vfLog('Editor de proyecto abierto', 'success');

    // Esperar a que la UI cargue completamente
    vfLog('Esperando a que la UI de Flow cargue...', 'info');
    await sleep(2000);

    // Esperar a que aparezca el prompt input
    let uiReady = false;
    for (let i = 0; i < 20; i++) {
      const promptEl = findPromptInput();
      const hasButtons = document.querySelectorAll('button').length > 3;

      if (promptEl && hasButtons) {
        uiReady = true;
        vfLog('UI de Flow lista', 'success');
        break;
      }

      vfLog(`Esperando UI... ${i + 1}/20`, 'info');
      await sleep(500);
    }

    if (!uiReady) {
      vfLog('WARN: UI no completamente cargada, continuando de todos modos...', 'warn');
    }

    // Pequeña pausa adicional para estabilidad
    await sleep(2000);
  } else {
    vfLog('WARN: No se detectó el editor después de 7.5s', 'warn');
  }
}

// Alias por compatibilidad
async function createNewProject() {
  return goToHomeAndCreateProject();
}

// ========== RESULT MANAGEMENT ==========

/**
 * Cierra el resultado del video anterior
 */
async function dismissPreviousResult() {
  vfLog('Limpiando resultado anterior...', 'info');

  const allButtons = document.querySelectorAll('button');

  for (const btn of allButtons) {
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    const btnText = btn.textContent?.toLowerCase() || '';

    if (ariaLabel.includes('cerrar') || ariaLabel.includes('close') ||
        ariaLabel.includes('descartar') || ariaLabel.includes('dismiss') ||
        btnText === 'close' || btnText === '×' || btnText === 'x') {

      const isInResultArea = btn.closest('[class*="result"], [class*="video"], [class*="generated"]');
      if (isInResultArea) {
        vfLog('Cerrando resultado anterior...', 'info');
        btn.click();
        await sleep(1000);
        vfLog('Resultado anterior cerrado', 'success');
        return;
      }
    }
  }

  vfLog('No se encontró botón para cerrar resultado, esperando...', 'info');
  await sleep(500);
}

/**
 * Limpia el área de prompt
 */
async function clearPromptArea() {
  vfLog('Limpiando prompt anterior...', 'info');

  const promptEl = findPromptInput();
  if (promptEl) {
    await setPromptText(promptEl, '');
    vfLog('Prompt limpiado', 'success');
  } else {
    vfLog('No se encontró prompt input para limpiar', 'warn');
  }
}

/**
 * Elimina la imagen actual
 * @returns {Promise<boolean>} - true si se eliminó, false si no había imagen
 */
async function removeCurrentImage() {
  vfLog('Eliminando imagen actual...', 'info');

  // Esperar un momento para que la UI se estabilice
  await sleep(500);

  let removed = false;

  // MÉTODO PRINCIPAL: Buscar en el área del prompt input
  const promptEl = findPromptInput();
  if (promptEl) {
    // Scroll hacia el prompt para asegurar que el área es visible
    promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);

    // Subir varios niveles para encontrar el contenedor del input
    let inputContainer = promptEl.parentElement;
    for (let i = 0; i < 5 && inputContainer; i++) inputContainer = inputContainer.parentElement;

    if (inputContainer) {
      const btnsInArea = inputContainer.querySelectorAll('button');
      vfLog(`Buscando en área del prompt (${btnsInArea.length} botones)...`, 'info');

      // Buscar botón que contenga "close" y texto de imagen
      for (const btn of btnsInArea) {
        const btnText = btn.textContent?.toLowerCase() || '';

        // Buscar botón de imagen (Primera imagen, Segunda imagen, etc.) con close
        if (btnText.includes('close') &&
            (btnText.includes('imagen') || btnText.includes('image') ||
             btnText.includes('primera') || btnText.includes('first') ||
             btnText.includes('segunda') || btnText.includes('second'))) {

          vfLog(`Botón de imagen encontrado: "${btn.textContent?.substring(0, 50)}"`, 'info');

          // Buscar el elemento con texto exacto "close" dentro del botón
          const closeIcon = Array.from(btn.querySelectorAll('*')).find(
            el => el.textContent?.trim() === 'close'
          );

          if (closeIcon) {
            vfLog('Haciendo clic en icono close...', 'info');
            closeIcon.click();
          } else {
            vfLog('Haciendo clic en botón completo...', 'info');
            btn.click();
          }

          await sleep(1500);
          vfLog('Imagen eliminada', 'success');
          removed = true;
          break;
        }
      }
    } else {
      vfLog('No se encontró contenedor de prompt, buscando en todo el documento...', 'info');
    }
  }

  // MÉTODO FALLBACK: Buscar en todo el documento si no se encontró en presentation
  if (!removed) {
    vfLog('Buscando en todo el documento...', 'info');
    const allButtons = document.querySelectorAll('button');

    for (const btn of allButtons) {
      const btnText = btn.textContent?.toLowerCase() || '';

      // Buscar botón de imagen con close
      if (btnText.includes('close') &&
          (btnText.includes('imagen') || btnText.includes('image') ||
           btnText.includes('primera') || btnText.includes('first') ||
           btnText.includes('segunda') || btnText.includes('second'))) {

        vfLog(`Botón de imagen encontrado (fallback): "${btn.textContent?.substring(0, 50)}"`, 'info');

        const closeIcon = Array.from(btn.querySelectorAll('*')).find(
          el => el.textContent?.trim() === 'close'
        );

        if (closeIcon) {
          closeIcon.click();
        } else {
          btn.click();
        }

        await sleep(1500);
        vfLog('Imagen eliminada', 'success');
        removed = true;
        break;
      }
    }
  }

  if (!removed) {
    vfLog('No se encontró imagen para eliminar (puede que ya esté limpio)', 'info');
  }

  // Después de eliminar, asegurar que la UI está lista para nueva imagen
  // Esperar un poco más y verificar que no hay diálogos abiertos
  await sleep(500);
  const dialogs = document.querySelectorAll('dialog[open], [role="dialog"]');
  for (const dialog of dialogs) {
    const dialogText = dialog.textContent?.toLowerCase() || '';
    if (dialogText.includes('confirm') || dialogText.includes('confirmar')) {
      vfLog('Diálogo de confirmación detectado, confirmando...', 'info');
      const confirmBtn = dialog.querySelector('button:last-of-type');
      if (confirmBtn) {
        confirmBtn.click();
        await sleep(500);
      }
    }
  }

  return removed;
}

// ========== VIDEO STATE ==========

// Almacena el src del último video descargado para evitar duplicados
window.lastDownloadedVideoSrc = null;

// ========== WAIT FOR VIDEO ==========

/**
 * Espera a que se genere el video
 * @returns {Promise<string|null>} - El src del video generado o null
 */
async function waitForVideoGeneration() {
  vfLog('Esperando que inicie la generación...', 'info');

  const maxWait = 300000; // 5 minutos
  const checkInterval = 3000;
  const startTime = Date.now();
  let lastLogTime = 0;
  let generationStarted = false;

  // Detectar video/botón anterior
  const existingDownloadBtn = findElement(['Descargar', 'Download'], 'button');
  const existingVideo = document.querySelector('video[src]:not([src=""])');
  const existingVideoSrc = existingVideo ? existingVideo.src : null;

  if (existingDownloadBtn || existingVideo) {
    vfLog('Detectado video/botón anterior - esperando que desaparezca...', 'warn');
  }

  // Esperar inicio de generación
  vfLog('Buscando indicador de generación en curso...', 'info');

  for (let i = 0; i < 20; i++) {
    if (typeof isAutomating !== 'undefined' && !isAutomating) {
      throw new Error('Automation stopped');
    }

    const loadingIndicators = document.querySelectorAll(
      '[class*="loading"], [class*="progress"], [class*="spinner"], ' +
      '[class*="generating"], [aria-busy="true"], [class*="pending"]'
    );

    const generatingText = findElement([
      'Generando', 'Generating', 'En cola', 'In queue',
      'Procesando', 'Processing', '%'
    ]);

    const currentDownloadBtn = findElement(['Descargar', 'Download'], 'button');
    const oldBtnGone = existingDownloadBtn && !currentDownloadBtn;

    const currentVideo = document.querySelector('video[src]:not([src=""])');
    const videoChanged = existingVideoSrc && (!currentVideo || currentVideo.src !== existingVideoSrc);

    if (loadingIndicators.length > 0 || generatingText) {
      vfLog('Generación iniciada - detectado indicador de progreso', 'success');
      generationStarted = true;
      break;
    }

    if (oldBtnGone || videoChanged) {
      vfLog('Generación iniciada - UI anterior limpiada', 'success');
      generationStarted = true;
      break;
    }

    await sleep(2000); // Optimizado de 3s
    vfLog('Esperando inicio de generación... ' + ((i + 1) * 2) + 's', 'info');
  }

  if (!generationStarted) {
    vfLog('WARN: No se detectó inicio de generación, verificando si hay video nuevo...', 'warn');
  }

  // Esperar fin de generación
  vfLog('Esperando que termine la generación...', 'info');

  while (Date.now() - startTime < maxWait) {
    if (typeof isAutomating !== 'undefined' && !isAutomating) {
      vfLog('Automatización detenida', 'warn');
      throw new Error('Automation stopped');
    }

    const stillLoading = document.querySelector(
      '[class*="loading"], [class*="spinner"], [aria-busy="true"], ' +
      '[class*="generating"], [class*="progress"]:not([class*="complete"])'
    );

    if (stillLoading) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (Date.now() - lastLogTime > 15000) {
        vfLog('Generando... ' + elapsed + 's', 'info');
        lastLogTime = Date.now();
      }
      await sleep(checkInterval);
      continue;
    }

    const downloadBtn = findElement(['Descargar', 'Download'], 'button');
    if (downloadBtn && !downloadBtn.disabled) {
      const currentVideo = document.querySelector('video[src]:not([src=""])');
      const currentVideoSrc = currentVideo ? currentVideo.src : null;

      const isNewVideo = !existingVideoSrc ||
                        (currentVideoSrc && currentVideoSrc !== existingVideoSrc) ||
                        generationStarted;

      if (isNewVideo) {
        vfLog('Generación completada - botón de descarga disponible', 'success');
        await sleep(2000);
        return;
      } else {
        vfLog('Botón detectado pero es del video anterior, esperando...', 'warn');
      }
    }

    const videoElement = document.querySelector('video[src]:not([src=""])');
    if (videoElement && generationStarted) {
      const src = videoElement.src;
      if (src && src.length > 20 && src !== existingVideoSrc) {
        vfLog('Video detectado: ' + src.substring(0, 50) + '...', 'success');
        await sleep(2000);
        return;
      }
    }

    // Revisar errores
    const errorEl = document.querySelector('[role="alert"], [class*="error"]');
    if (errorEl) {
      const errorText = errorEl.textContent?.toLowerCase() || '';
      if (errorText.includes('error') || errorText.includes('failed') || errorText.includes('fallo')) {
        vfLog('Error en generación: ' + errorEl.textContent, 'error');
        throw new Error(`Generation failed: ${errorEl.textContent}`);
      }
    }

    // Revisar cola llena
    const queueMsg = findElement(['cola llena', 'queue full', 'try again later', 'inténtalo más tarde']);
    if (queueMsg) {
      vfLog('Cola llena, esperando 30s...', 'warn');
      await sleep(30000);
      continue;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (Date.now() - lastLogTime > 15000) {
      vfLog('Esperando resultado... ' + elapsed + 's', 'info');
      lastLogTime = Date.now();
    }

    await sleep(checkInterval);
  }

  vfLog('Timeout: 5 minutos sin respuesta', 'error');
  throw new Error('Video generation timeout (5 minutes)');
}

// ========== DOWNLOAD ==========

/**
 * Descarga el video generado
 * @param {number} index - Índice del video
 * @returns {Promise<string>} - Nombre del archivo
 */
async function downloadVideo(index) {
  const filename = `${String(index + 1).padStart(3, '0')}_flow_video.mp4`;
  vfLog('Descargando en 720p: ' + filename, 'info');

  // Obtener el src del video actual para verificación
  const currentVideoEl = document.querySelector('video[src]:not([src=""])');
  const currentVideoSrc = currentVideoEl ? currentVideoEl.src : null;

  // Verificar que no es el mismo video que el anterior (solo para index > 0)
  if (index > 0 && currentVideoSrc && window.lastDownloadedVideoSrc) {
    if (currentVideoSrc === window.lastDownloadedVideoSrc) {
      vfLog('ERROR: El video actual es el mismo que el anterior!', 'error');
      vfLog('Src actual: ' + currentVideoSrc.substring(0, 60), 'error');
      vfLog('Src anterior: ' + window.lastDownloadedVideoSrc.substring(0, 60), 'error');
      throw new Error('El video generado es idéntico al anterior. La imagen de referencia probablemente no se subió correctamente.');
    } else {
      vfLog('Verificación OK: Video diferente al anterior', 'success');
    }
  }

  // === MÉTODO 1: Nuevo Flow — ⋮ → Descargar → 720p via card container ===
  // Buscar el card container del video actual
  if (currentVideoEl) {
    let card = currentVideoEl;
    for (let i = 0; i < 12 && card; i++) {
      if (card.getAttribute?.('data-tile-id')) break;
      card = card.parentElement;
    }
    if (card && card.getAttribute?.('data-tile-id')) {
      const downloaded = await downloadViaMoreVertMenu(card, currentVideoEl, filename);
      if (downloaded) {
        if (currentVideoSrc) window.lastDownloadedVideoSrc = currentVideoSrc;
        return filename;
      }
    }
  }

  // === MÉTODO 2: Botón de descarga directo (vista edición o diseño anterior) ===
  let downloadBtn = null;
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const hasDownloadIcon = btn.querySelector('[class*="download"]');
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    const btnText = btn.textContent?.toLowerCase() || '';

    if (hasDownloadIcon || ariaLabel.includes('descargar') || ariaLabel.includes('download') ||
        btnText.includes('download') || btnText.includes('descargar')) {
      downloadBtn = btn;
      vfLog('Botón descarga directo encontrado', 'info');
      break;
    }
  }

  if (!downloadBtn) {
    downloadBtn = findElement(['Descargar', 'Download'], 'button');
  }

  if (downloadBtn) {
    downloadBtn.click();
    await sleep(800);

    const menu = document.querySelector('[role="menu"]');
    if (menu) {
      vfLog('Menú de descarga abierto', 'info');

      const menuItems = menu.querySelectorAll('[role="menuitem"]');
      let option720p = null;

      for (const item of menuItems) {
        const itemText = item.textContent?.toLowerCase() || '';
        if (itemText.includes('720p') || itemText.includes('original')) {
          option720p = item;
          vfLog('Opción 720p encontrada: ' + itemText.substring(0, 40), 'info');
          break;
        }
      }

      if (option720p) {
        option720p.click();
        await sleep(2000);
        vfLog('Descarga 720p iniciada', 'success');
        if (currentVideoSrc) window.lastDownloadedVideoSrc = currentVideoSrc;
        return filename;
      } else {
        for (const item of menuItems) {
          const itemText = item.textContent?.toLowerCase() || '';
          if (!itemText.includes('gif') && !itemText.includes('270p')) {
            item.click();
            await sleep(2000);
            vfLog('Descarga iniciada (opción alternativa)', 'success');
            if (currentVideoSrc) window.lastDownloadedVideoSrc = currentVideoSrc;
            return filename;
          }
        }
      }
    } else {
      await sleep(2000);
      vfLog('Descarga iniciada directamente', 'success');
      if (currentVideoSrc) window.lastDownloadedVideoSrc = currentVideoSrc;
      return filename;
    }
  }

  // Alternativa: descargar del elemento video
  const videoEl = document.querySelector('video[src], video source[src]');
  if (videoEl) {
    const src = videoEl.src || videoEl.querySelector('source')?.src;

    if (src) {
      const link = document.createElement('a');
      link.href = src;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      await sleep(2000);
      vfLog('Descarga iniciada via link directo', 'success');
      // Guardar el src del video descargado para verificación futura
      window.lastDownloadedVideoSrc = src;
      return filename;
    }
  }

  vfLog('No se pudo iniciar la descarga automáticamente', 'warn');
  return filename;
}

console.log('VidFlow: video.js cargado');
