/**
 * VidFlow - Generation Type Selection
 * Functions for detecting and selecting the generation type (text-to-video, image-to-video, etc.)
 */

// ========== GENERATION TYPE ==========

/**
 * Detecta el tipo de generación actualmente seleccionado
 * @returns {Promise<string>}
 */
async function getCurrentGenerationType() {
  // Nuevo Flow: buscar botones de tipo (ya no hay comboboxes)
  const allElements = document.querySelectorAll('button, [role="button"], [role="combobox"]');
  for (const el of allElements) {
    const text = el.textContent?.toLowerCase() || '';
    if (text.includes('imágenes a vídeo') || text.includes('imagen a video') || text.includes('imágenes') && text.includes('vídeo')) {
      return 'image-to-video';
    }
    if (text.includes('texto a vídeo') || text.includes('texto a video')) {
      return 'text-to-video';
    }
    if (text.includes('ingredientes')) {
      return 'ingredients-to-video';
    }
  }

  // Nuevo Flow: si hay botón "Video x1" estamos en modo video por defecto
  for (const el of allElements) {
    const text = el.textContent?.toLowerCase() || '';
    if (text.includes('vídeo') && text.includes('x') && text.length < 30) {
      return 'text-to-video';
    }
  }

  return 'unknown';
}

/**
 * Selecciona el tipo de generación
 * @param {string} genType - text-to-video, image-to-video, ingredients-to-video
 */
async function selectGenerationType(genType) {
  vfLog('Tipo de generación: ' + genType, 'info');

  const targetTexts = GENERATION_TYPE_TEXTS[genType] || GENERATION_TYPE_TEXTS['text-to-video'];

  // Buscar el botón de tipo (nuevo Flow: botones normales, ya no comboboxes)
  let typeBtn = null;

  // Primero buscar comboboxes (compatibilidad)
  const comboboxes = document.querySelectorAll('[role="combobox"]');
  for (const cb of comboboxes) {
    const text = cb.textContent?.toLowerCase() || '';
    if (text.includes('texto') || text.includes('imágenes') || text.includes('imagen') ||
        text.includes('ingredientes') || text.includes('video')) {
      typeBtn = cb;
      vfLog('Combobox encontrado por role: ' + text.substring(0, 30), 'info');
      break;
    }
  }

  // Nuevo Flow: buscar botón de tipo de generación (ej: "Video x1")
  if (!typeBtn) {
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      const text = btn.textContent?.toLowerCase() || '';
      if ((text.includes('vídeo') || text.includes('video')) && text.includes('x') && text.length < 30) {
        typeBtn = btn;
        vfLog('Botón de tipo encontrado (nuevo Flow): ' + text.substring(0, 30), 'info');
        break;
      }
    }
  }

  if (!typeBtn) {
    typeBtn = findElement([
      'Texto a vídeo', 'Texto a video',
      'Imágenes a vídeo', 'Imágenes a video',
      'Ingredientes a vídeo', 'Ingredientes a video'
    ], 'button');
  }

  if (!typeBtn) {
    vfLog('Dropdown de tipo no encontrado, continuando...', 'warn');
    return;
  }

  // Verificar si ya está seleccionado
  const currentText = typeBtn.textContent?.toLowerCase() || '';
  const alreadySelected = targetTexts.some(t => currentText.includes(t.toLowerCase()));

  if (alreadySelected) {
    vfLog('Tipo ya seleccionado: ' + genType, 'success');
    return;
  }

  // Abrir dropdown
  vfLog('Abriendo dropdown de tipo...', 'info');
  typeBtn.click();
  await sleep(800);

  // Buscar opción
  let option = null;
  const listbox = document.querySelector('[role="listbox"]');
  if (listbox) {
    const options = listbox.querySelectorAll('[role="option"]');
    for (const opt of options) {
      const optText = opt.textContent?.toLowerCase() || '';
      for (const target of targetTexts) {
        if (optText.includes(target.toLowerCase())) {
          option = opt;
          vfLog('Opción encontrada en listbox: ' + optText.substring(0, 30), 'info');
          break;
        }
      }
      if (option) break;
    }
  }

  if (!option) {
    option = findElement(targetTexts);
  }

  if (option) {
    option.click();
    vfLog('Tipo seleccionado: ' + genType, 'success');
    await sleep(500);
  } else {
    vfLog('Opción no encontrada, cerrando dropdown', 'warn');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(300);
  }
}

console.log('VidFlow: generation-type.js cargado');
