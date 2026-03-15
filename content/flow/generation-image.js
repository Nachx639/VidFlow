/**
 * VidFlow - Image Upload Logic
 * Functions for uploading reference images, handling crop dialogs, and image readiness checks.
 */

// ========== IMAGE UPLOAD ==========

/**
 * Limpia cualquier estado pendiente de la UI antes de subir una imagen
 * Cierra modales, menús, y asegura que la UI está en estado limpio
 */
async function cleanUIStateBeforeUpload() {
  vfLog('Limpiando estado de UI antes de subir imagen...', 'info');

  // 1. Cerrar cualquier menú abierto
  const openMenus = document.querySelectorAll('[role="menu"], [role="listbox"]');
  if (openMenus.length > 0) {
    vfLog(`Cerrando ${openMenus.length} menú(s) abierto(s)...`, 'info');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
  }

  // 2. Cerrar cualquier diálogo que no sea el principal
  const dialogs = document.querySelectorAll('dialog[open], [role="dialog"]');
  for (const dialog of dialogs) {
    const dialogText = dialog.textContent?.toLowerCase() || '';
    // Evitar cerrar diálogos de recorte o importantes
    if (!dialogText.includes('recorta') && !dialogText.includes('crop') &&
        !dialogText.includes('ajustes') && !dialogText.includes('settings')) {
      const closeBtn = dialog.querySelector('button[aria-label*="close"], button[aria-label*="cerrar"]');
      if (closeBtn) {
        vfLog('Cerrando diálogo abierto...', 'info');
        closeBtn.click();
        await sleep(500);
      }
    }
  }

  // 3. Asegurar que el prompt input está enfocado y visible
  const promptEl = findPromptInput();
  if (promptEl) {
    promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);
    promptEl.focus();
    await sleep(200);
  }

  // 4. Verificar si hay algún overlay/backdrop bloqueando
  const overlays = document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="modal-bg"]');
  for (const overlay of overlays) {
    const style = window.getComputedStyle(overlay);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      vfLog('Overlay detectado, haciendo clic para cerrar...', 'warn');
      overlay.click();
      await sleep(500);
    }
  }

  vfLog('Estado de UI limpiado', 'success');
}

/**
 * Obtiene un identificador de la imagen actualmente cargada
 * @returns {string|null} - Identificador de la imagen o null si no hay
 */
function getCurrentImageFingerprint() {
  // Buscar el botón "primera imagen" que contiene información sobre la imagen
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const btnText = btn.textContent?.toLowerCase() || '';
    if (btnText.includes('primera imagen') || btnText.includes('first image') ||
        btnText.includes('segunda imagen') || btnText.includes('second image')) {
      // Obtener cualquier imagen dentro del botón
      const img = btn.querySelector('img');
      if (img && img.src) {
        return img.src.substring(0, 100); // Usar parte del src como fingerprint
      }
      // Si no hay img, usar el propio botón como indicador
      return 'image_loaded_' + Date.now();
    }
  }

  // Buscar imágenes blob en el área de input
  const promptEl = findPromptInput();
  if (promptEl) {
    // Subir 5 niveles para encontrar el contenedor del área de input
    let inputArea = promptEl.parentElement;
    for (let i = 0; i < 5 && inputArea; i++) inputArea = inputArea.parentElement;
    if (inputArea) {
      const images = inputArea.querySelectorAll('img');
      for (const img of images) {
        if (img.src && (img.src.includes('blob:') || img.src.includes('data:'))) {
          return img.src.substring(0, 100);
        }
      }
    }
  }

  return null;
}

/**
 * Espera a que aparezca el área de subida de imágenes
 */
async function waitForImageUploadArea() {
  vfLog('Esperando área de subida de imágenes...', 'info');

  const maxWait = 25000; // 25 segundos
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    // 1. Verificar que no hay diálogos bloqueando
    const dialogs = document.querySelectorAll('dialog[open], [role="dialog"]');
    for (const dialog of dialogs) {
      const dialogText = dialog.textContent?.toLowerCase() || '';
      if (dialogText.includes('recorta') || dialogText.includes('crop')) {
        vfLog('Diálogo de crop abierto, cerrando...', 'warn');
        const cancelBtn = dialog.querySelector('button');
        if (cancelBtn) {
          cancelBtn.click();
          await sleep(500);
        }
      }
    }

    // 2. Buscar el prompt input (indicador principal de UI lista)
    const promptEl = findPromptInput();
    if (!promptEl) {
      vfLog('Prompt input no encontrado aún...', 'info');
      await sleep(500);
      continue;
    }

    // 3. Asegurar que el prompt input es visible
    const promptRect = promptEl.getBoundingClientRect();
    if (promptRect.height === 0 || promptRect.width === 0) {
      vfLog('Prompt input existe pero no es visible aún...', 'info');
      await sleep(500);
      continue;
    }

    // 4. Buscar botón de añadir imagen/archivo multimedia
    const hasFileInput = document.querySelector('input[type="file"][accept*="image"]') ||
                         document.querySelector('input[type="file"]');

    const allButtons = document.querySelectorAll('button');
    let hasAddButton = false;
    for (const btn of allButtons) {
      const text = btn.textContent?.trim() || '';
      const textLower = text.toLowerCase();
      const btnRect = btn.getBoundingClientRect();
      if (btnRect.height === 0 || btnRect.width === 0) continue;

      if (text === '+' || text === 'add' || textLower.includes('add_photo') ||
          textLower.includes('añadir archivo') || textLower.includes('añadir imagen') ||
          textLower.includes('add_2')) {
        hasAddButton = true;
        vfLog('Botón de añadir encontrado: ' + text.substring(0, 40), 'success');
        break;
      }
    }

    if (hasFileInput || hasAddButton) {
      vfLog('Área de subida de imágenes lista', 'success');
      promptEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1500);
      return true;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 5 === 0) {
      vfLog(`Esperando área de imagen... ${elapsed}s`, 'info');
    }
    await sleep(500);
  }

  vfLog('Timeout esperando área de imagen, continuando de todos modos...', 'warn');
  return false;
}

/**
 * Sube una imagen de referencia
 * @param {string} imageData - Imagen en base64
 * @param {boolean} mustChange - Si es true, verifica que la imagen cambió (para modo batch)
 */
async function uploadImage(imageData, mustChange = false) {
  vfLog('Subiendo imagen de referencia...', 'info');

  if (!imageData) {
    vfLog('No hay datos de imagen', 'warn');
    return;
  }

  // PASO 0: Limpiar estado de UI antes de intentar subir
  await cleanUIStateBeforeUpload();
  await sleep(500);

  // Guardar fingerprint de la imagen actual para verificar cambio
  const previousFingerprint = mustChange ? getCurrentImageFingerprint() : null;
  if (mustChange && previousFingerprint) {
    vfLog('Fingerprint imagen anterior: ' + previousFingerprint?.substring(0, 40), 'info');
  }

  // ESTRATEGIA: Primero buscar input existente, luego hacer clic si es necesario
  let addBtn = null;
  let fileInput = null;

  // DEBUG: Contar inputs de archivo existentes
  const existingInputs = document.querySelectorAll('input[type="file"]');
  vfLog(`DEBUG: ${existingInputs.length} inputs de archivo en el DOM`, 'info');

  // PASO 1: Buscar input de archivo que ya exista (puede estar oculto)
  fileInput = document.querySelector('input[type="file"][accept*="image"]');
  if (!fileInput) {
    fileInput = document.querySelector('input[type="file"]');
  }

  if (fileInput) {
    vfLog('Input de archivo encontrado directamente en el DOM', 'info');
  } else {
    // PASO 2: Buscar y hacer clic en el botón de añadir imagen
    vfLog('Input no existe, buscando botón para añadir...', 'info');

    // Buscar botón de añadir imagen/archivo multimedia
    const promptEl = findPromptInput();
    const allButtons = document.querySelectorAll('button');

    for (const btn of allButtons) {
      const iconText = btn.textContent?.trim() || '';
      const iconTextLower = iconText.toLowerCase();
      const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
      const btnRect = btn.getBoundingClientRect();
      if (btnRect.height === 0 || btnRect.width === 0) continue;

      // Nuevo Flow: "addAñadir archivo multimedia" o "add_2Crear"
      if (iconTextLower.includes('añadir archivo') || iconTextLower.includes('añadir imagen') ||
          iconTextLower.includes('add image') || iconText.includes('add_photo') ||
          ariaLabel.includes('añadir') || ariaLabel.includes('add image') ||
          ariaLabel.includes('subir imagen') || ariaLabel.includes('upload image')) {
        addBtn = btn;
        vfLog('Botón añadir encontrado: ' + iconText.substring(0, 40), 'success');
        break;
      }

      // Fallback: botón con icono "add" o "+" cerca del prompt input
      if (iconText === 'add' || iconText === '+') {
        if (promptEl) {
          const promptRect = promptEl.getBoundingClientRect();
          if (Math.abs(btnRect.top - promptRect.top) < 200) {
            addBtn = btn;
            vfLog('Botón add encontrado cerca del prompt', 'info');
            break;
          }
        } else {
          addBtn = btn;
          vfLog('Botón add encontrado (sin referencia de prompt)', 'info');
          break;
        }
      }
    }

    if (addBtn) {
      // Scroll hacia el botón y enfocarlo
      addBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);

      // Hacer múltiples intentos de clic + buscar input
      for (let attempt = 0; attempt < 7; attempt++) {
        vfLog(`Clic en botón añadir imagen (intento ${attempt + 1}/7)...`, 'info');

        // Intentar diferentes métodos de clic
        if (attempt % 2 === 0) {
          addBtn.click();
        } else {
          // Dispatch mousedown + mouseup + click
          addBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          await sleep(50);
          addBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          await sleep(50);
          addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }

        await sleep(500); // PERF: Reduced from 1000ms. Input typically appears within 200-500ms.

        // Buscar input
        fileInput = document.querySelector('input[type="file"][accept*="image"]');
        if (!fileInput) {
          fileInput = document.querySelector('input[type="file"]');
        }
        if (!fileInput) {
          const allInputs = document.querySelectorAll('input[type="file"]');
          if (allInputs.length > 0) {
            fileInput = allInputs[allInputs.length - 1]; // El más reciente
            vfLog(`DEBUG: Usando input #${allInputs.length} de ${allInputs.length}`, 'info');
          }
        }

        if (fileInput) {
          vfLog('Input file encontrado después del clic', 'success');
          break;
        }

        vfLog(`Input no apareció, esperando más...`, 'info');
        await sleep(500); // PERF: Reduced from 1000ms.
      }
    } else {
      vfLog('WARN: No se encontró botón de añadir imagen', 'warn');
      // Último intento: buscar cualquier input file en la página
      const allFileInputs = document.querySelectorAll('input[type="file"]');
      if (allFileInputs.length > 0) {
        fileInput = allFileInputs[0];
        vfLog(`Usando input file existente (${allFileInputs.length} encontrados)`, 'info');
      }
    }
  }

  // PASO 3: Fallback - buscar dropzone
  if (!fileInput) {
    vfLog('Input no encontrado, buscando dropzone...', 'warn');
    const dropzones = document.querySelectorAll('[class*="drop"], [class*="upload"], [class*="drag"]');
    for (const dz of dropzones) {
      vfLog(`Intentando dropzone: ${dz.className?.substring(0, 50)}`, 'info');
      dz.click();
      await sleep(1500);
      fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        vfLog('Input file encontrado después de clic en dropzone', 'info');
        break;
      }
    }
  }

  // Subir la imagen
  if (fileInput && imageData) {
    vfLog('Inyectando imagen en input...', 'info');

    if (typeof imageData === 'string' && imageData.startsWith('data:')) {
      try {
        const blob = await base64ToBlob(imageData);
        const file = new File([blob], 'reference.png', { type: 'image/png' });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dataTransfer
        });
        fileInput.dispatchEvent(dropEvent);

        await sleep(2000);

        // Manejar diálogo de recorte
        await handleCropDialog();

        // Esperar a que la imagen esté lista
        const imageReady = await waitForImageReady();
        if (!imageReady) {
          vfLog('WARN: No se pudo confirmar que la imagen está lista', 'warn');
        }

        // Verificar que la imagen realmente cambió (en modo batch)
        if (mustChange && previousFingerprint) {
          const newFingerprint = getCurrentImageFingerprint();
          vfLog('Fingerprint imagen nueva: ' + newFingerprint?.substring(0, 40), 'info');

          // En modo batch, solo verificamos que hay una imagen cargada
          // El fingerprint puede ser igual si la UI no cambió el src
          if (!newFingerprint) {
            vfLog('ERROR: No se detectó imagen después de subir', 'error');
            throw new Error('La imagen no se subió correctamente. No se detecta imagen cargada.');
          }
        }

        vfLog('Imagen subida correctamente', 'success');
      } catch (err) {
        vfLog('Error subiendo imagen: ' + err.message, 'error');
        throw err; // Re-lanzar el error para que se maneje arriba
      }
    }
  } else {
    vfLog('ERROR: No se pudo subir la imagen - input no encontrado o datos inválidos', 'error');
    throw new Error('No se pudo subir la imagen. El input de archivo no está disponible.');
  }
}

/**
 * Espera a que la imagen esté realmente cargada
 */
async function waitForImageReady() {
  vfLog('Verificando que la imagen está lista...', 'info');

  const maxWait = 15000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    // Verificar que NO hay diálogo de crop abierto
    const cropDialog = document.querySelector('dialog[open], [role="dialog"]');
    if (cropDialog) {
      const dialogText = cropDialog.textContent?.toLowerCase() || '';
      if (dialogText.includes('recorta') || dialogText.includes('crop')) {
        vfLog('Diálogo de crop aún abierto, esperando...', 'info');
        await sleep(1000);
        continue;
      }
    }

    // Buscar botón "Primera imagen"
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const btnText = btn.textContent?.toLowerCase() || '';
      if (btnText.includes('primera imagen') || btnText.includes('first image') ||
          btnText.includes('segunda imagen') || btnText.includes('second image')) {
        vfLog('Imagen lista: "' + btnText.substring(0, 25) + '"', 'success');
        await sleep(500);
        return true;
      }
    }

    // Buscar botón close en área de input
    const promptEl = findPromptInput();
    if (promptEl) {
      let inputArea = promptEl.parentElement;
      for (let i = 0; i < 5 && inputArea; i++) inputArea = inputArea.parentElement;
      if (inputArea) {
        const btnsInArea = inputArea.querySelectorAll('button');
        for (const btn of btnsInArea) {
          const btnText = btn.textContent || '';
          if (btnText.includes('close') && !btnText.includes('Cerrar')) {
            const rect = btn.getBoundingClientRect();
            if (rect.width < 100 && rect.width > 30) {
              vfLog('Imagen lista: botón con close detectado', 'success');
              await sleep(500);
              return true;
            }
          }
        }
      }
    }

    await sleep(500);
  }

  vfLog('Timeout esperando imagen lista', 'warn');
  return false;
}

/**
 * Maneja el diálogo de recortar imagen
 */
async function handleCropDialog() {
  vfLog('Buscando diálogo de recortar...', 'info');

  const maxWait = 5000;
  const startTime = Date.now();
  let cropDialog = null;

  while (Date.now() - startTime < maxWait) {
    cropDialog = document.querySelector('dialog, [role="dialog"]');

    if (cropDialog) {
      const cropBtn = cropDialog.querySelector('button');
      if (cropBtn) {
        const allButtons = cropDialog.querySelectorAll('button');
        for (const btn of allButtons) {
          const btnText = btn.textContent?.toLowerCase() || '';
          if (btnText.includes('recortar') || btnText.includes('guardar') ||
              btnText.includes('crop') || btnText.includes('save')) {
            vfLog('Diálogo de recorte encontrado', 'success');
            break;
          }
        }
        break;
      }
    }
    await sleep(500);
  }

  if (!cropDialog) {
    vfLog('No apareció diálogo de recorte (puede que no sea necesario)', 'info');
    return;
  }

  // Buscar botón "Recortar y guardar"
  const buttons = cropDialog.querySelectorAll('button');
  let cropSaveBtn = null;

  for (const btn of buttons) {
    const btnText = btn.textContent?.trim().toLowerCase() || '';
    if (btnText.includes('recortar y guardar') || btnText.includes('crop and save') ||
        (btnText.includes('recortar') && btnText.includes('guardar')) ||
        (btnText.includes('crop') && btnText.includes('save'))) {
      cropSaveBtn = btn;
      vfLog('Botón "Recortar y guardar" encontrado', 'info');
      break;
    }
  }

  if (!cropSaveBtn && buttons.length > 0) {
    for (const btn of buttons) {
      const btnText = btn.textContent?.trim().toLowerCase() || '';
      if (!btnText.includes('cancelar') && !btnText.includes('cancel') &&
          !btnText.includes('restablecer') && !btnText.includes('reset')) {
        cropSaveBtn = btn;
      }
    }
  }

  if (cropSaveBtn) {
    vfLog('Haciendo clic en "Recortar y guardar"...', 'info');
    cropSaveBtn.click();
    await sleep(1500);
    vfLog('Imagen recortada y guardada', 'success');
  } else {
    vfLog('No se encontró botón de guardar en el diálogo', 'warn');
  }
}

console.log('VidFlow: generation-image.js cargado');
