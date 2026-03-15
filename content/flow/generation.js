/**
 * VidFlow - Generación de Videos
 * Prompt input, botón generar, image/video mode switching, gallery helpers, and video download.
 * Type selection is in generation-type.js, image upload in generation-image.js.
 */

// ========== PROMPT INPUT ==========

/**
 * Escribe el prompt en el campo de texto
 * @param {string} promptText - El prompt a escribir
 */
async function enterPrompt(promptText) {
  vfLog('Escribiendo prompt: ' + promptText?.substring(0, 50) + '...', 'info');

  if (!promptText || typeof promptText !== 'string') {
    vfLog('ERROR: Prompt inválido: ' + typeof promptText, 'error');
    throw new Error('Prompt text is invalid or empty');
  }

  let promptInput = findPromptInput();

  if (!promptInput) {
    vfLog('Prompt input no encontrado, esperando...', 'warn');
    await sleep(2000);
    promptInput = findPromptInput();
    if (!promptInput) {
      vfLog('Prompt input no encontrado después de esperar', 'error');
      throw new Error('Prompt input not found after retry');
    }
  }

  vfLog('Prompt input encontrado: ' + promptInput.tagName + (promptInput.getAttribute('role') ? ' role=' + promptInput.getAttribute('role') : ''), 'info');

  promptInput.focus();
  await sleep(200);

  // Limpiar y establecer texto via setPromptText (usa Slate bridge para editores Slate)
  await setPromptText(promptInput, '');
  await sleep(100);
  await setPromptText(promptInput, promptText);
  await sleep(500);

  const currentValue = getPromptText(promptInput);
  vfLog('Valor actual del prompt: ' + currentValue?.substring(0, 30) + '...', 'info');

  if (!currentValue || currentValue.length < 5) {
    vfLog('Prompt no se escribió bien, reintentando con Slate bridge...', 'warn');
    await setPromptText(promptInput, promptText);
    await sleep(500);
  }

  vfLog('Prompt escrito correctamente', 'success');
}

// ========== VERIFY & GENERATE ==========

/**
 * Verifica que hay imagen cargada antes de enviar
 */
async function verifyImageBeforeSend() {
  vfLog('Verificando imagen antes de enviar...', 'info');

  // Buscar botón "Primera imagen"
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const btnText = btn.textContent?.toLowerCase() || '';
    if (btnText.includes('primera imagen') || btnText.includes('first image') ||
        btnText.includes('segunda imagen') || btnText.includes('second image')) {
      vfLog('Imagen confirmada: botón "' + btnText.substring(0, 30) + '"', 'success');
      return true;
    }
  }

  // Buscar botón close cerca del prompt input
  const promptEl = findPromptInput();
  if (promptEl) {
    let inputArea = promptEl.parentElement;
    for (let i = 0; i < 5 && inputArea; i++) inputArea = inputArea.parentElement;
    if (inputArea) {
      const btnsInArea = inputArea.querySelectorAll('button');
      for (const btn of btnsInArea) {
        const hasCloseIcon = btn.textContent?.includes('close');
        const rect = btn.getBoundingClientRect();
        if (hasCloseIcon && rect.width < 80 && rect.width > 20) {
          vfLog('Imagen confirmada: botón close encontrado en área de input', 'success');
          return true;
        }
      }
    }
  }

  // Buscar imágenes visibles
  const images = document.querySelectorAll('img');
  for (const img of images) {
    const src = img.src || '';
    if (src.includes('blob:') || src.includes('data:') || src.includes('googleusercontent')) {
      const rect = img.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        vfLog('Imagen confirmada: ' + src.substring(0, 50), 'success');
        return true;
      }
    }
  }

  // Buscar "recurso multimedia"
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    const text = el.textContent?.toLowerCase() || '';
    if (text.includes('recurso multimedia') || text.includes('multimedia resource')) {
      vfLog('Imagen confirmada: recurso multimedia encontrado', 'success');
      return true;
    }
  }

  vfLog('No se detectó imagen cargada', 'warn');
  return false;
}

/**
 * Hace clic en el botón de generar
 * @param {Object} currentConfig - Configuración actual
 */
async function clickGenerate(currentConfig = {}) {
  vfLog('Buscando botón de generar...', 'info');

  // Verificar imagen si es modo imagen
  const genType = currentConfig.generationType || 'text-to-video';
  if (genType === 'image-to-video') {
    const hasImage = await verifyImageBeforeSend();
    if (!hasImage) {
      vfLog('ERROR: No hay imagen cargada, esperando más tiempo...', 'warn');
      await sleep(3000);
      const hasImageRetry = await verifyImageBeforeSend();
      if (!hasImageRetry) {
        throw new Error('No se pudo confirmar imagen antes de enviar. Verifica que la imagen se subió correctamente.');
      }
    }
  }

  // Método 1: Buscar por aria-label
  const ariaButtons = document.querySelectorAll('button[aria-label]');
  for (const btn of ariaButtons) {
    const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
    if (label.includes('enviar') || label.includes('send') || label.includes('generar') || label.includes('generate')) {
      if (!btn.disabled) {
        vfLog('Botón encontrado por aria-label: ' + label, 'success');
        btn.click();
        await sleep(2000);
        return;
      }
    }
  }

  // Método 2: Buscar por icono
  vfLog('Buscando botón con icono de enviar...', 'info');
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    if (btn.disabled) continue;

    const btnText = btn.textContent?.trim().toLowerCase() || '';
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

    // Skip container buttons with too much text (real submit buttons have short content like "arrow_forwardcrear")
    if (btnText.length > 60) continue;

    if (btnText.includes('arrow_upward') || btnText.includes('send') ||
        btnText.includes('arrow_forward') || btnText.includes('play_arrow') ||
        btnText === '→' || btnText === '▶') {

      if (ariaLabel.includes('ajust') || ariaLabel.includes('config') ||
          ariaLabel.includes('tune') || ariaLabel.includes('settings')) {
        continue;
      }

      vfLog('Botón encontrado por icono de material: ' + btnText.substring(0, 40), 'success');
      btn.click();
      await sleep(2000);
      return;
    }
  }

  // Método 3: Buscar botón con SVG cerca del prompt input
  vfLog('Buscando botón con SVG cerca del prompt input...', 'info');
  const buttonsWithSvg = document.querySelectorAll('button');
  for (const btn of buttonsWithSvg) {
    const svg = btn.querySelector('svg');
    if (svg && !btn.disabled) {
      const btnText = btn.textContent?.toLowerCase() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

      if (btnText.includes('veo') || btnText.includes('horizontal') ||
          btnText.includes('vertical') || btnText.includes('modelo') ||
          ariaLabel.includes('ajust') || ariaLabel.includes('config') ||
          ariaLabel.includes('tune')) {
        continue;
      }

      const promptEl = findPromptInput();
      if (promptEl) {
        const promptRect = promptEl.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();

        if (btnRect.left > promptRect.right - 100 || btnRect.top > promptRect.bottom - 50) {
          vfLog('Botón enviar encontrado cerca del prompt input', 'success');
          btn.click();
          await sleep(2000);
          return;
        }
      }
    }
  }

  // Método 4: Buscar por texto
  vfLog('Buscando por texto...', 'info');
  const generateBtn = findElement(['Generar', 'Generate', 'Enviar', 'Send'], 'button');

  if (generateBtn && !generateBtn.disabled) {
    vfLog('Botón encontrado por texto', 'success');
    generateBtn.click();
    await sleep(2000);
    return;
  }

  // Método 5: Simular Enter
  const promptInput = findPromptInput();
  if (promptInput) {
    vfLog('Intentando tecla Enter en prompt input...', 'info');
    promptInput.focus();

    promptInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      ctrlKey: true,
      bubbles: true
    }));
    await sleep(1000);

    promptInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true
    }));
    await sleep(2000);
    vfLog('Enter enviado', 'info');
    return;
  }

  vfLog('No se encontró botón de generar', 'error');
  throw new Error('Generate button not found');
}

// ========== IMAGE GENERATION MODE ==========

/**
 * Encuentra el botón selector de tipo (muestra "Video x1" o "Nano Banana Pro x1" etc)
 * Es el botón en la parte inferior derecha del prompt area
 */
function findTypeSelector() {
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    const text = btn.textContent?.trim().toLowerCase() || '';
    // Match: "Video x1", "Nano Banana Pro x1", "Image x2", etc
    if (text.match(/x[1-4]/) && text.length < 40) {
      return btn;
    }
  }
  return null;
}

/**
 * Abre el popup de tipo (Image/Video/Horizontal/Vertical/x1-x4/modelo)
 * Usa focus + Enter ya que React requiere trusted events para click
 * @returns {boolean} true si se abrió correctamente
 */
async function openTypePopup() {
  const typeBtn = findTypeSelector();
  if (!typeBtn) {
    vfLog('No se encontro el selector de tipo', 'error');
    throw new Error('Type selector button not found');
  }

  // Verificar si ya está abierto
  if (typeBtn.getAttribute('data-state') === 'open') {
    return true;
  }

  // Focus + Enter (funciona con React a diferencia de synthetic click)
  typeBtn.focus();
  await sleep(200);
  typeBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  typeBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  await sleep(600);

  if (typeBtn.getAttribute('data-state') === 'open') {
    return true;
  }

  // Fallback: Space key
  typeBtn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
  typeBtn.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
  await sleep(600);

  return typeBtn.getAttribute('data-state') === 'open';
}

/**
 * Cierra el popup de tipo si está abierto
 */
async function closeTypePopup() {
  const typeBtn = findTypeSelector();
  if (typeBtn && typeBtn.getAttribute('data-state') === 'open') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(300);
  }
}

/**
 * Selecciona un tab dentro del popup de tipo usando focus + Enter
 * (React requiere trusted events, .click() no funciona)
 * @param {string} tabText - Texto del tab (ej: 'Image', 'Video')
 * @returns {Promise<boolean>} true si se seleccionó
 */
async function clickPopupTab(tabText) {
  const tabs = document.querySelectorAll('[role="tab"]');
  for (const tab of tabs) {
    if (!tab.offsetParent) continue;
    const text = tab.textContent?.trim() || '';
    if (text.endsWith(tabText) || text === tabText) {
      tab.focus();
      await sleep(200);
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      tab.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      await sleep(300);
      return true;
    }
  }
  return false;
}

/**
 * Cambia Flow al modo Image (Nano Banana Pro)
 */
async function switchToImageMode() {
  vfLog('Cambiando a modo Image...', 'info');

  const typeBtn = findTypeSelector();
  if (!typeBtn) throw new Error('Type selector button not found');

  const currentText = typeBtn.textContent?.toLowerCase() || '';
  if (currentText.includes('nano banana') || currentText.includes('imagen')) {
    vfLog('Ya en modo Image', 'success');
    return;
  }

  const opened = await openTypePopup();
  if (!opened) {
    vfLog('No se pudo abrir el popup de tipo', 'error');
    throw new Error('Could not open type popup');
  }

  if (await clickPopupTab('Image')) {
    await sleep(500);
  } else {
    vfLog('No se encontro tab Image en el popup', 'warn');
    await closeTypePopup();
    throw new Error('Image tab not found in popup');
  }

  await closeTypePopup();

  // Verificar que realmente cambió
  const newText = findTypeSelector()?.textContent?.toLowerCase() || '';
  if (newText.includes('nano banana') || newText.includes('imagen')) {
    vfLog('Modo Image confirmado', 'success');
  } else {
    vfLog('WARN: Tipo actual tras cambio: ' + newText, 'warn');
  }
}

/**
 * Cambia Flow al modo Video
 */
async function switchToVideoMode() {
  vfLog('Cambiando a modo Video...', 'info');

  const typeBtn = findTypeSelector();
  if (!typeBtn) throw new Error('Type selector button not found');

  const currentText = typeBtn.textContent?.toLowerCase() || '';
  if (currentText.includes('veo') || currentText.includes('video') || currentText.includes('vídeo')) {
    vfLog('Ya en modo Video', 'success');
    return;
  }

  const opened = await openTypePopup();
  if (!opened) {
    vfLog('No se pudo abrir el popup de tipo', 'error');
    throw new Error('Could not open type popup');
  }

  if (await clickPopupTab('Video')) {
    await sleep(500);
  } else {
    vfLog('No se encontro tab Video en el popup', 'warn');
    await closeTypePopup();
    throw new Error('Video tab not found in popup');
  }

  await closeTypePopup();

  // Verificar que realmente cambió
  const newText = findTypeSelector()?.textContent?.toLowerCase() || '';
  if (newText.includes('veo') || newText.includes('video') || newText.includes('vídeo')) {
    vfLog('Modo Video confirmado', 'success');
  } else {
    vfLog('WARN: Tipo actual tras cambio: ' + newText, 'warn');
  }
}

/**
 * Cuenta las imagenes/tiles actuales en la galeria
 */
function countGalleryItems() {
  return document.querySelectorAll('[data-tile-id]').length;
}

/**
 * Espera a que se complete la generación de una imagen
 * Estrategia dual:
 *   1. Detecta progreso de imagen (no video) aparece → desaparece
 *   2. Detecta nuevo tile-id que no existía antes
 * @param {number} maxWaitMs - Tiempo maximo de espera
 * @returns {Element|null} - El tile de la nueva imagen
 */
async function waitForGeneratedImage(_, maxWaitMs = 120000) {
  vfLog('Esperando imagen generada...', 'info');
  const startTime = Date.now();
  let lastLogTime = 0;
  let sawProgress = false;
  let sawNewTile = false;

  // Guardar tile-ids existentes para detectar nuevos
  const existingIds = new Set();
  document.querySelectorAll('[data-tile-id]').forEach(t => {
    existingIds.add(t.getAttribute('data-tile-id'));
  });
  const initialCount = existingIds.size;

  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const currentTiles = document.querySelectorAll('[data-tile-id]');
    const currentCount = currentTiles.length;

    // Buscar nuevos tiles
    let newTileWithImg = null;
    let newTileAny = null;
    let newTileGenerating = false;

    for (const tile of currentTiles) {
      const id = tile.getAttribute('data-tile-id');
      if (existingIds.has(id)) continue;

      // Es un tile nuevo
      if (!sawNewTile) {
        sawNewTile = true;
        vfLog(`Nuevo tile detectado (total: ${currentCount}, antes: ${initialCount})`, 'info');
      }

      const tileText = tile.textContent || '';
      const hasVideo = !!tile.querySelector('video');
      const hasImg = !!tile.querySelector('img');
      const hasProgress = !!tileText.match(/\d+%/);
      const hasVideocam = tileText.includes('videocam');

      // Tile de video → ignorar
      if (hasVideo || hasVideocam) continue;

      if (hasProgress) {
        newTileGenerating = true;
        // Detectar progreso solo en tiles nuevos no-video
        if (elapsed - lastLogTime >= 10) {
          const match = tileText.match(/(\d+%)/);
          vfLog(`Generando imagen... ${match ? match[1] : '?%'} (${elapsed}s)`, 'info');
          lastLogTime = elapsed;
        }
        sawProgress = true;
        continue;
      }

      // Tile nuevo, sin video, sin progreso → imagen completada
      if (!newTileAny) newTileAny = tile;
      if (hasImg && !newTileWithImg) newTileWithImg = tile;
    }

    // Prioridad 1: Nuevo tile con <img> (imagen completada y renderizada)
    if (newTileWithImg) {
      vfLog(`Imagen generada! (${elapsed}s)`, 'success');
      return newTileWithImg;
    }

    // Prioridad 2: Nuevo tile sin progreso ni video (imagen completada pero sin <img> por tab en background)
    if (newTileAny && !newTileGenerating) {
      vfLog(`Imagen generada (tile sin <img>, tab en background)! (${elapsed}s)`, 'success');
      await sleep(500);
      // Re-check por si se cargó el img
      const recheck = newTileAny.querySelector('img');
      return recheck ? newTileAny : newTileAny;
    }

    // Prioridad 3: El progreso desapareció (sawProgress era true, ahora no hay generating)
    if (sawProgress && !newTileGenerating) {
      vfLog(`Imagen generada (progreso desapareció)! (${elapsed}s)`, 'success');
      await sleep(500);
      // Buscar tile nuevo completado
      for (const tile of document.querySelectorAll('[data-tile-id]')) {
        const id = tile.getAttribute('data-tile-id');
        if (!existingIds.has(id) && !tile.querySelector('video')) return tile;
      }
      // Fallback
      for (const tile of document.querySelectorAll('[data-tile-id]')) {
        if (tile.querySelector('img') && !tile.querySelector('video')) return tile;
      }
      return document.querySelector('[data-tile-id]');
    }

    // Fallback: si hay más tiles que antes y llevamos suficiente tiempo sin progreso
    if (!sawProgress && currentCount > initialCount && elapsed > 15) {
      // Hay nuevos tiles pero nunca se vio progreso (tab en background, rendering limitado)
      vfLog(`Imagen detectada por conteo (${initialCount}→${currentCount}) (${elapsed}s)`, 'success');
      await sleep(500);
      for (const tile of document.querySelectorAll('[data-tile-id]')) {
        const id = tile.getAttribute('data-tile-id');
        if (!existingIds.has(id) && !tile.querySelector('video')) return tile;
      }
      return document.querySelector('[data-tile-id]');
    }

    if (!sawProgress && !sawNewTile && elapsed - lastLogTime >= 10 && elapsed > 0) {
      vfLog(`Esperando progreso... ${elapsed}s (tiles: ${currentCount}/${initialCount})`, 'info');
      lastLogTime = elapsed;
    }

    await sleep(1500);
  }

  vfLog('Timeout esperando imagen generada', 'error');
  return null;
}

/**
 * Genera una imagen con un prompt en modo Image de Flow
 * @param {string} promptText - Prompt para la imagen
 * @param {number} sceneIndex - Indice de la escena (0-based)
 * @returns {object} - {success, error}
 */
async function generateFlowImage(promptText, sceneIndex) {
  vfLog(`═══ Generando imagen ${sceneIndex + 1} ═══`, 'step');
  vfLog('Prompt: ' + promptText.substring(0, 80) + '...', 'info');

  try {
    // 1. Asegurarnos de estar en modo Image
    await switchToImageMode();
    await sleep(500);

    // 2. Contar items actuales para detectar nuevos
    const prevCount = countGalleryItems();
    vfLog(`Items en galeria antes: ${prevCount}`, 'info');

    // 3. Escribir prompt
    await enterPrompt(promptText);
    await sleep(300);

    // 4. Generar (click en boton enviar)
    await clickGenerate({});
    await sleep(2000);

    // 5. Esperar a que se genere la imagen
    const newImage = await waitForGeneratedImage(prevCount, 120000);

    if (!newImage) {
      return { success: false, error: 'Timeout esperando imagen' };
    }

    const tileId = newImage.getAttribute?.('data-tile-id') || null;
    vfLog(`Imagen ${sceneIndex + 1} generada! (tile: ${tileId})`, 'success');
    return { success: true, tileId };
  } catch (error) {
    vfLog(`Error generando imagen ${sceneIndex + 1}: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

/**
 * Hace click derecho en la ultima imagen generada y selecciona "Animar"
 * Esto cambia Flow a modo Video con la imagen como referencia
 * @returns {object} - {success, error}
 */
async function animateLastImage(tileId = null) {
  if (tileId) {
    vfLog(`Animando imagen por tileId: ${tileId}...`, 'step');
    return await _animateImageTile(null, tileId);
  }
  vfLog('Animando ultima imagen generada...', 'step');
  return await _animateImageTile(null, null);
}

/**
 * Anima la imagen en la posición N (orden cronológico, 0-based).
 * Posición 0 = primera imagen generada (más antigua en DOM).
 * @param {number} position - Posición cronológica de la imagen
 * @returns {object} - {success, error}
 */
async function animateImageAtPosition(position) {
  vfLog(`Animando imagen en posición ${position + 1}...`, 'step');
  return await _animateImageTile(position, null);
}

/**
 * Implementación interna: click derecho → "Animar" sobre un tile de imagen.
 * @param {number|null} position - Posición cronológica (0-based), null = más reciente
 * @param {string|null} targetTileId - Si se proporciona, anima este tile específico
 */
async function _animateImageTile(position, targetTileId) {
  try {
    let imgTile = null;

    // Si tenemos un tileId específico, buscar directamente
    if (targetTileId) {
      const tiles = document.querySelectorAll('[data-tile-id]');
      for (const tile of tiles) {
        if (tile.getAttribute('data-tile-id') === targetTileId) {
          imgTile = tile;
          break;
        }
      }
      if (!imgTile) {
        vfLog(`Tile ${targetTileId} no encontrado, buscando por posición...`, 'warn');
      }
    }

    // Fallback: buscar por posición
    if (!imgTile) {
      const tiles = document.querySelectorAll('[data-tile-id]');
      const seenIds = new Set();
      const imageTiles = [];

      for (const tile of tiles) {
        const id = tile.getAttribute('data-tile-id');
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const hasVideo = tile.querySelector('video');
        const hasImg = tile.querySelector('img');
        const text = tile.textContent || '';
        const hasProgress = !!text.match(/\d+%/);
        const hasError = text.includes('infringir') || text.includes('políticas');
        const hasVideocam = text.includes('videocam');

        if ((hasImg || !hasVideo) && !hasProgress && !hasError && !hasVideocam && !hasVideo) {
          imageTiles.push(tile);
        }
      }

      if (imageTiles.length === 0) {
        throw new Error('No se encontraron tiles de imagen en la galeria');
      }

      if (position === null) {
        imgTile = imageTiles[0];
      } else {
        const chronological = [...imageTiles].reverse();
        if (position >= chronological.length) {
          throw new Error(`Posición ${position} fuera de rango (hay ${chronological.length} imágenes)`);
        }
        imgTile = chronological[position];
      }
    }

    // 2. Click derecho sobre el elemento IMG dentro del tile
    // Scroll into view primero para forzar lazy loading
    imgTile.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);

    // Esperar a que el <img> aparezca (lazy loading puede tardar)
    let imgEl = imgTile.querySelector('img');
    if (!imgEl) {
      for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
        await sleep(500);
        imgEl = imgTile.querySelector('img');
        if (imgEl) break;
      }
    }
    if (!imgEl) {
      throw new Error('No se encontro elemento img en el tile');
    }

    const rect = imgEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Scroll into view si no es visible
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      imgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      const newRect = imgEl.getBoundingClientRect();
      imgEl.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: newRect.left + newRect.width / 2, clientY: newRect.top + newRect.height / 2, button: 2
      }));
    } else {
      imgEl.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: cx, clientY: cy, button: 2
      }));
    }
    await sleep(800);

    // 3. Buscar y clickear "Animar" en el menu contextual
    const menuItems = document.querySelectorAll('[role="menuitem"]');
    let found = false;
    for (const item of menuItems) {
      if (item.textContent?.includes('Animar')) {
        item.click();
        found = true;
        vfLog('Click en "Animar"', 'success');
        break;
      }
    }

    if (!found) {
      // Cerrar menu si no se encontro
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      throw new Error('No se encontro opcion "Animar" en el menu contextual');
    }

    // 4. Esperar a que cambie a modo video con imagen como referencia
    await sleep(2000);

    // Verificar que estamos en modo video con imagen
    const typeBtn = findTypeSelector();
    const typeBtnText = typeBtn?.textContent?.toLowerCase() || '';
    if (typeBtnText.includes('veo') || typeBtnText.includes('video') || typeBtnText.includes('vídeo')) {
      vfLog('Modo Video con imagen de referencia listo', 'success');
    } else {
      vfLog('Tipo actual: ' + typeBtnText + ' (esperaba Video)', 'warn');
    }

    return { success: true };
  } catch (error) {
    vfLog('Error animando imagen: ' + error.message, 'error');
    return { success: false, error: error.message };
  }
}

/**
 * Flujo completo: genera imagen + animar + escribir prompt video + enviar
 * @param {string} imagePrompt - Prompt para generar la imagen
 * @param {string} videoPrompt - Prompt para el video
 * @param {number} sceneIndex - Indice de la escena (0-based)
 * @param {object} config - Configuracion (aspectRatio, veoModel, etc)
 * @returns {object} - {success, error}
 */
async function generateImageThenVideo(imagePrompt, videoPrompt, sceneIndex, config = {}, sceneNumber = null) {
  const MAX_RETRIES = 2;
  let imageGenerated = false;
  let imageTileId = null;
  // Usar sceneNumber real si viene, si no fallback a index+1
  const sceneLabel = sceneNumber || (sceneIndex + 1);

  // Prefijo con número de escena para identificar en Flow
  const prefixedImagePrompt = `[${sceneLabel}] ${imagePrompt}`;
  const prefixedVideoPrompt = `[${sceneLabel}] ${videoPrompt}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      vfLog(``, 'warn');
      vfLog(`REINTENTO ${attempt}/${MAX_RETRIES} para escena #${sceneLabel}`, 'warn');
      await sleep(3000);
    }

    vfLog(``, 'info');
    vfLog(`═══════════════════════════════════════`, 'step');
    vfLog(`ESCENA #${sceneLabel}: IMAGEN → VIDEO${attempt > 0 ? ` (intento ${attempt + 1})` : ''}`, 'step');
    vfLog(`═══════════════════════════════════════`, 'step');
    vfLog(`Imagen: ${imagePrompt.substring(0, 60)}...`, 'info');
    vfLog(`Video: ${videoPrompt.substring(0, 60)}...`, 'info');

    try {
      // PASO 1: Generar imagen (solo si no se generó ya)
      if (!imageGenerated) {
        const imgResult = await generateFlowImage(prefixedImagePrompt, sceneIndex);
        if (!imgResult.success) {
          vfLog(`Fallo generando imagen (intento ${attempt + 1}): ${imgResult.error}`, 'error');
          if (attempt < MAX_RETRIES) continue;
          return { success: false, error: 'Fallo generando imagen tras reintentos: ' + imgResult.error };
        }
        imageGenerated = true;
        imageTileId = imgResult.tileId || null;
      } else {
        vfLog(`Imagen ya generada (tile: ${imageTileId}), reutilizando...`, 'info');
      }

      // PASO 2: Animar la imagen exacta (por tileId, no la "última")
      const animResult = await animateLastImage(imageTileId);
      if (!animResult.success) {
        vfLog(`Fallo animando imagen (intento ${attempt + 1}): ${animResult.error}`, 'error');
        if (attempt < MAX_RETRIES) continue;
        return { success: false, error: 'Fallo animando imagen tras reintentos: ' + animResult.error };
      }

      // PASO 3: Configurar ajustes de video si es la primera escena
      if (sceneIndex === 0 && attempt === 0) {
        vfLog('Configurando ajustes de video...', 'info');
        await configureSettings(config);
        await sleep(500);
      }

      // PASO 4: Escribir prompt de video (con prefijo de escena)
      vfLog('Escribiendo prompt de video...', 'step');
      await enterPrompt(prefixedVideoPrompt);
      await sleep(300);

      // PASO 5: Enviar a generar video
      vfLog('Enviando video a generar...', 'step');
      await clickGenerate(config);
      await sleep(2000);

      vfLog(`Escena #${sceneLabel} enviada a cola!`, 'success');

      // Notificar al background
      chrome.runtime.sendMessage({
        action: 'flowImageGenerated',
        data: { index: sceneIndex, success: true }
      }).catch(() => {});

      return { success: true };
    } catch (err) {
      vfLog(`Error inesperado en escena ${sceneIndex + 1} (intento ${attempt + 1}): ${err.message}`, 'error');
      if (attempt < MAX_RETRIES) continue;
      return { success: false, error: 'Error tras reintentos: ' + err.message };
    }
  }

  return { success: false, error: 'Agotados todos los reintentos' };
}

/**
 * Espera a que todos los videos terminen de generarse, reintenta los fallidos, y descarga con numeración correcta.
 * @param {number} expectedCount - Número de videos esperados (solo exitosos)
 * @param {number[]} sceneNumbers - Números reales de las escenas (ej: [8, 9, 10, 11])
 * @param {string[]} videoPrompts - Prompts de video para cada escena (para reintentos)
 * @param {string} folderPrefix - No se usa, la carpeta viene del background
 * @param {number} maxWaitMs - Tiempo máximo de espera
 * @returns {object} - {success, downloaded, errors}
 */
async function waitAndDownloadAllVideos(expectedCount, sceneNumbers = [], videoPrompts = [], folderPrefix = '', maxWaitMs = 600000) {
  vfLog('═══════════════════════════════════════', 'step');
  vfLog(`Esperando ${expectedCount} videos y descargando progresivamente...`, 'step');
  vfLog(`Escenas a descargar: #${sceneNumbers.join(', #')}`, 'info');
  vfLog('═══════════════════════════════════════', 'step');

  const MAX_RETRY_ROUNDS = 2;
  const retriedPositions = new Set();
  let originalTileCount = expectedCount;

  // Estado de descargas progresivas
  let downloaded = 0;
  const downloadErrors = [];
  const skippedScenes = [];
  const downloadedPositions = new Set(); // posiciones ya descargadas

  // Helper: descargar un video individual por mediaKey y sceneNumber
  async function downloadSingleVideo(mediaKey, realSceneNumber) {
    const sceneNum = String(realSceneNumber).padStart(3, '0');
    vfLog(`Descargando escena ${realSceneNumber} (${sceneNum})...`, 'info');

    try {
      const apiUrl = `/fx/api/trpc/media.getMediaUrlRedirect?name=${mediaKey}`;
      const resp = await fetch(apiUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const blob = await resp.blob();
      if (blob.size < 10000) throw new Error(`Blob muy pequeño: ${blob.size} bytes`);
      const sizeMB = (blob.size / 1024 / 1024).toFixed(1);

      vfLog(`Escena ${realSceneNumber}: ${sizeMB}MB descargado, convirtiendo...`, 'info');

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Error leyendo blob'));
        reader.readAsDataURL(blob);
      });

      const result = await chrome.runtime.sendMessage({
        action: 'downloadFlowVideo',
        data: { dataUrl, sceneNumber: realSceneNumber }
      });

      if (result && result.success) {
        downloaded++;
        vfLog(`Escena ${realSceneNumber} guardada: ${result.filename} (${sizeMB}MB) [${downloaded}/${sceneNumbers.length}]`, 'success');
        return true;
      } else {
        downloadErrors.push(realSceneNumber);
        vfLog(`Error guardando escena ${realSceneNumber}: ${result?.error || 'unknown'}`, 'error');
        return false;
      }
    } catch (e) {
      downloadErrors.push(realSceneNumber);
      vfLog(`Error descargando escena ${realSceneNumber}: ${e.message}`, 'error');
      return false;
    }
  }

  // Helper: escanear tiles y descargar los que estén recién completados
  async function downloadNewlyCompleted() {
    const allTiles = collectAllVideoTiles();
    allTiles.reverse(); // cronológico: pos 0 = más antiguo = escena 1
    const originals = allTiles.slice(0, originalTileCount);

    for (let pos = 0; pos < Math.min(originals.length, sceneNumbers.length); pos++) {
      if (downloadedPositions.has(pos)) continue;
      if (window.isAutomating === false) break;

      const tile = originals[pos];
      if (tile.status === 'completed' && tile.mediaKey) {
        downloadedPositions.add(pos);
        await downloadSingleVideo(tile.mediaKey, sceneNumbers[pos]);
        await sleep(1000);
      }
    }
  }

  for (let retryRound = 0; retryRound <= MAX_RETRY_ROUNDS; retryRound++) {
    const startTime = Date.now();
    let lastLogTime = 0;
    let lastCompletedCount = 0;
    let stableSince = 0;

    const roundLabel = retryRound > 0 ? ` (reintento ${retryRound})` : '';

    // ===== FASE 1: Esperar videos y descargar conforme se completan =====
    while (Date.now() - startTime < maxWaitMs && window.isAutomating !== false) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const counts = countVideoTiles();

      // Descargar videos recién completados
      await downloadNewlyCompleted();

      if (elapsed - lastLogTime >= 10) {
        const errorStr = counts.errors > 0 ? ` | Errores: ${counts.errors}` : '';
        const dlStr = downloaded > 0 ? ` | Descargados: ${downloaded}` : '';
        vfLog(`[ESPERA${roundLabel}] ${Math.floor(elapsed/60)}m${elapsed%60}s — Generando: ${counts.generating} | Completados: ${counts.completed}/${expectedCount}${errorStr}${dlStr}`, 'info');
        lastLogTime = elapsed;
      }

      if (counts.completed >= expectedCount) {
        vfLog(`Todos los ${counts.completed} videos completados!`, 'success');
        // Descarga final por si quedó alguno
        await downloadNewlyCompleted();
        break;
      }

      if (counts.generating > 0) {
        if (counts.completed !== lastCompletedCount) {
          lastCompletedCount = counts.completed;
          stableSince = Date.now();
        }
        await sleep(3000);
        continue;
      }

      const accounted = counts.completed + counts.errors;
      if (accounted >= expectedCount) {
        vfLog(`${counts.completed} videos completados, ${counts.errors} con error en galería`, 'warn');
        await downloadNewlyCompleted();
        break;
      }

      if (counts.completed !== lastCompletedCount) {
        lastCompletedCount = counts.completed;
        stableSince = Date.now();
      } else if (stableSince > 0 && Date.now() - stableSince > 120000) {
        vfLog(`Sin cambios en 2 min (generando: 0). ${counts.completed}/${expectedCount} completados, procediendo`, 'warn');
        await downloadNewlyCompleted();
        break;
      }

      await sleep(3000);
    }

    if (window.isAutomating === false) {
      vfLog(`Automatización detenida (${downloaded} descargados hasta ahora)`, 'warn');
      return { success: downloaded > 0, downloaded, errors: downloadErrors, skipped: skippedScenes };
    }

    // ===== FASE 2: Detectar errores en tiles originales y reintentar =====
    const allTilesNow = collectAllVideoTiles();
    allTilesNow.reverse();
    const originalTilesSlice = allTilesNow.slice(0, originalTileCount);

    const errorPositions = [];
    for (let i = 0; i < Math.min(originalTilesSlice.length, sceneNumbers.length); i++) {
      if (originalTilesSlice[i].status === 'error' && !retriedPositions.has(i)) {
        if (videoPrompts[i] && videoPrompts[i].trim()) {
          errorPositions.push(i);
        }
      }
    }

    if (errorPositions.length === 0 || retryRound >= MAX_RETRY_ROUNDS) {
      if (errorPositions.length > 0) {
        vfLog(`${errorPositions.length} videos con error tras ${MAX_RETRY_ROUNDS} rondas de reintentos`, 'warn');
      }
      break;
    }

    // Reintentar videos fallidos
    vfLog('═══════════════════════════════════════', 'step');
    vfLog(`REINTENTO RONDA ${retryRound + 1}: ${errorPositions.length} videos fallidos`, 'step');
    vfLog(`Escenas a reintentar: ${errorPositions.map(p => '#' + sceneNumbers[p]).join(', ')}`, 'info');
    vfLog('═══════════════════════════════════════', 'step');

    for (const pos of errorPositions) {
      if (window.isAutomating === false) break;

      const sceneIdx = sceneNumbers[pos];
      const videoPrompt = videoPrompts[pos];
      vfLog(`Reintentando escena ${sceneIdx}: animando imagen ${pos + 1}...`, 'step');

      try {
        const animResult = await animateImageAtPosition(pos);
        if (!animResult.success) {
          vfLog(`No se pudo animar imagen para escena ${sceneIdx}: ${animResult.error}`, 'error');
          continue;
        }

        vfLog(`Escribiendo prompt de video para reintento escena ${sceneIdx}...`, 'info');
        await enterPrompt(`[${sceneIdx}] ${videoPrompt}`);
        await sleep(300);

        vfLog(`Enviando video a generar (reintento escena ${sceneIdx})...`, 'step');
        await clickGenerate({});
        await sleep(2000);

        vfLog(`Escena ${sceneIdx} reenviada a cola!`, 'success');
        retriedPositions.add(pos);
        expectedCount++;

      } catch (e) {
        vfLog(`Error reintentando escena ${sceneIdx}: ${e.message}`, 'error');
      }

      if (errorPositions.indexOf(pos) < errorPositions.length - 1) {
        await sleep(3000);
      }
    }

    vfLog('Esperando videos reintentados...', 'info');
  }

  if (window.isAutomating === false) {
    return { success: downloaded > 0, downloaded, errors: downloadErrors, skipped: skippedScenes };
  }

  // ===== FASE 3: Descargar videos de reintentos (tiles extra) =====
  if (retriedPositions.size > 0) {
    const finalTiles = collectAllVideoTiles();
    finalTiles.reverse();
    const retryTiles = finalTiles.slice(originalTileCount);

    let retryIdx = 0;
    for (const pos of [...retriedPositions].sort((a, b) => a - b)) {
      if (window.isAutomating === false) break;
      if (downloadedPositions.has(pos)) { retryIdx++; continue; } // ya descargado del original

      if (retryIdx < retryTiles.length && retryTiles[retryIdx].status === 'completed' && retryTiles[retryIdx].mediaKey) {
        downloadedPositions.add(pos);
        await downloadSingleVideo(retryTiles[retryIdx].mediaKey, sceneNumbers[pos]);
        await sleep(1000);
      }
      retryIdx++;
    }
  }

  // ===== FASE 4: Resumen final =====
  // Marcar escenas no descargadas como skipped
  for (let i = 0; i < sceneNumbers.length; i++) {
    if (!downloadedPositions.has(i)) {
      skippedScenes.push(sceneNumbers[i]);
    }
  }

  vfLog('═══════════════════════════════════════', 'step');
  let summary = `Descargas: ${downloaded}/${sceneNumbers.length}`;
  if (skippedScenes.length > 0) summary += ` | Fallidos en Flow: ${skippedScenes.map(n => String(n).padStart(3,'0')).join(',')}`;
  if (downloadErrors.length > 0) summary += ` | Error descarga: ${downloadErrors.join(',')}`;
  vfLog(summary, downloaded > 0 ? 'success' : 'warn');
  vfLog('═══════════════════════════════════════', 'step');

  return { success: downloaded > 0, downloaded, errors: downloadErrors, skipped: skippedScenes };
}

/**
 * Cuenta tiles de video en la galería: generando, completados, errores
 */
function countVideoTiles() {
  let generating = 0;
  let completed = 0;
  let errors = 0;
  let images = 0;
  const tiles = document.querySelectorAll('[data-tile-id]');
  const seenIds = new Set();

  for (const tile of tiles) {
    const id = tile.getAttribute('data-tile-id');
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const text = tile.textContent || '';
    const hasVideo = !!tile.querySelector('video');
    const hasProgress = text.match(/\d+%/);

    // Un tile con porcentaje está generando (puede o no tener <video> aún)
    if (hasProgress) {
      generating++;
      continue;
    }

    // Error real: tile sin video, sin porcentaje, CON texto de error específico
    // Solo contar como error si NO tiene video (un video completado puede tener texto "Error" cerca)
    if (!hasVideo && (text.includes('infringir') || text.includes('políticas'))) {
      errors++;
      continue;
    }

    // Video completado
    if (hasVideo) {
      completed++;
      continue;
    }

    // Tile de imagen (sin video, sin porcentaje, sin error) — no contar
    images++;
  }

  return { generating, completed, errors, images };
}

/**
 * Recopila TODOS los tiles relacionados con video (completados, errores, generando).
 * Cada escena produce exactamente 1 tile de video, así que la posición = escena.
 * Un tile es "de video" si tiene: <video>, porcentaje, texto "videocam", o error de política.
 */
function collectAllVideoTiles() {
  const videoTiles = [];
  const seenIds = new Set();
  const allTiles = document.querySelectorAll('[data-tile-id]');

  for (const tile of allTiles) {
    const id = tile.getAttribute('data-tile-id');
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const text = tile.textContent || '';
    const hasVideo = !!tile.querySelector('video');
    const hasProgress = !!text.match(/\d+%/);
    const hasVideocam = text.includes('videocam');
    const hasError = text.includes('infringir') || text.includes('políticas');

    // ¿Es un tile relacionado con video? (no una simple imagen)
    const isVideoRelated = hasVideo || hasProgress || hasVideocam || hasError;
    if (!isVideoRelated) continue;

    let status = 'unknown';
    let mediaKey = null;

    if (hasError && !hasVideo) {
      status = 'error';
    } else if (hasProgress) {
      status = 'generating';
    } else if (hasVideo) {
      status = 'completed';
      const videoEl = tile.querySelector('video[src]');
      if (videoEl) {
        const src = videoEl.src || videoEl.currentSrc;
        try {
          const url = new URL(src);
          mediaKey = url.searchParams.get('name') || url.pathname.split('/').pop();
        } catch(e) {}
      }
    }

    videoTiles.push({ tileId: id, status, mediaKey });
  }

  return videoTiles;
}

console.log('VidFlow: generation.js cargado');
