/**
 * VidFlow - Speech Generación
 * Funciones para generación de audio en AI Studio Speech
 * Actualizado para usar funciones de selectors.js
 */

// ========== STYLE INSTRUCTIONS ==========

/**
 * Ingresa las style instructions (tono de voz)
 * @param {string} style - Instrucciones de estilo
 * @returns {Promise<boolean>}
 */
async function enterStyleInstructions(style) {
  if (!style) return true; // Si no hay estilo, continuar sin error

  vfLog(`Configurando estilo: ${style.substring(0, 40)}...`, 'info');

  // Usar función de selectors.js
  const styleInput = getStyleInput();

  if (!styleInput) {
    vfLog('Campo de style instructions no encontrado', 'warn');
    return false;
  }

  // Limpiar y escribir
  styleInput.value = style;
  styleInput.dispatchEvent(new Event('input', { bubbles: true }));
  styleInput.dispatchEvent(new Event('change', { bubbles: true }));

  // Trigger focus
  styleInput.focus();
  await sleep(200);
  styleInput.blur();

  await sleep(300);
  vfLog('Style instructions configuradas', 'success');
  return true;
}

// ========== TEXT INPUT ==========

/**
 * Ingresa el texto de narración
 * @param {string} text - Texto a narrar
 * @returns {Promise<boolean>}
 */
async function enterNarrationText(text) {
  vfLog(`Ingresando texto: ${text.substring(0, 50)}...`, 'info');

  // Usar función de selectors.js
  const textInput = getTextInput();

  if (!textInput) {
    vfLog('Input de texto no encontrado', 'error');
    return false;
  }

  // Limpiar y escribir
  textInput.value = text;
  textInput.dispatchEvent(new Event('input', { bubbles: true }));
  textInput.dispatchEvent(new Event('change', { bubbles: true }));

  // Trigger focus
  textInput.focus();
  await sleep(200);
  textInput.blur();

  await sleep(500);
  vfLog('Texto ingresado', 'success');
  return true;
}

/**
 * Limpia el texto actual
 * @returns {Promise<boolean>}
 */
async function clearText() {
  const textInput = getTextInput();

  if (!textInput) return false;

  textInput.value = '';
  textInput.dispatchEvent(new Event('input', { bubbles: true }));

  await sleep(300);
  return true;
}

// ========== VOICE SELECTION ==========

/**
 * Selecciona una voz específica
 * @param {string} voiceName - Nombre de la voz (Zephyr, Puck, Charon, Kore, Fenrir, Aoede)
 * @returns {Promise<boolean>}
 */
async function selectVoice(voiceName) {
  vfLog(`Seleccionando voz: ${voiceName}`, 'info');

  // Usar función de selectors.js
  const voiceSelector = getVoiceSelector();

  if (!voiceSelector) {
    vfLog('Selector de voz no encontrado', 'warn');
    return false;
  }

  // Hacer clic para abrir opciones
  voiceSelector.click();
  await sleep(500);

  // Buscar la opción de voz
  const options = document.querySelectorAll(SPEECH_SELECTORS.voiceOptions);

  for (const option of options) {
    const optionText = option.textContent?.toLowerCase() || '';
    if (optionText.includes(voiceName.toLowerCase())) {
      option.click();
      await sleep(300);
      vfLog(`Voz seleccionada: ${voiceName}`, 'success');
      return true;
    }
  }

  // Si no encontramos opciones, cerrar el dropdown
  document.body.click();

  vfLog(`Voz "${voiceName}" no encontrada, usando default`, 'warn');
  return false;
}

// ========== MODE SELECTION ==========

/**
 * Asegura que estemos en modo Single-speaker
 * @returns {Promise<boolean>}
 */
async function ensureSingleSpeakerMode() {
  const isAlreadySingle = isSingleSpeakerMode();
  console.log('VidFlow Speech: isSingleSpeakerMode =', isAlreadySingle);

  if (!isAlreadySingle) {
    vfLog('Modo actual: Multi-speaker → Cambiando a Single-speaker...', 'step');
    const selected = selectSingleSpeakerMode();
    if (selected) {
      await sleep(1000); // Más tiempo para que la UI se actualice
      vfLog('✓ Modo Single-speaker activado', 'success');
      return true;
    }
    vfLog('✗ No se pudo cambiar a Single-speaker', 'error');
    return false;
  }

  vfLog('✓ Ya está en modo Single-speaker', 'success');
  return true;
}

// ========== GENERATION ==========

/**
 * Hace clic en el botón de generar/Run
 * @returns {Promise<{success: boolean, previousAudioSrc: string|null}>}
 */
async function clickGenerate() {
  vfLog('Buscando botón Run...', 'info');

  // Capturar el src del audio actual ANTES de generar (para detectar cambio)
  const currentAudio = getAudioPlayer();
  const previousAudioSrc = currentAudio?.src || null;

  if (previousAudioSrc) {
    vfLog(`Audio anterior detectado (${previousAudioSrc.substring(0, 50)}...)`, 'info');
  }

  // Usar función de selectors.js
  const generateBtn = getGenerateButton();

  if (!generateBtn) {
    vfLog('Botón Run no encontrado', 'error');
    return { success: false, previousAudioSrc: null };
  }

  generateBtn.click();
  await sleep(1000);
  vfLog('Generación de audio iniciada', 'success');
  return { success: true, previousAudioSrc };
}

/**
 * Espera a que la generación de audio termine
 * @param {number} timeout - Timeout en ms (default 60s)
 * @param {string|null} previousAudioSrc - Src del audio anterior (para detectar cambio)
 * @returns {Promise<boolean>}
 */
async function waitForGeneration(timeout = 60000, previousAudioSrc = null) {
  vfLog('Esperando generación de audio...', 'info');

  if (previousAudioSrc) {
    vfLog('Esperando que el audio cambie (hay audio anterior)', 'info');
  }

  // Esperar a que inicie el proceso
  await sleep(1000);

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Verificar error (pero ignorar el mensaje "No audio generated" que es inicial)
    const errorEl = document.querySelector(SPEECH_SELECTORS.errorMessage);
    if (errorEl) {
      const errorText = errorEl.textContent?.toLowerCase() || '';
      // Solo considerar como error si NO es el mensaje inicial
      if (errorText.includes('error') || errorText.includes('failed')) {
        vfLog(`Error en generación: ${errorEl.textContent}`, 'error');
        return false;
      }
    }

    // Verificar si hay audio
    const audio = getAudioPlayer();

    if (audio && audio.src) {
      // Si hay audio anterior, verificar que el src CAMBIÓ
      if (previousAudioSrc) {
        // El src debe ser diferente al anterior para considerarlo nuevo
        if (audio.src !== previousAudioSrc && audio.duration > 0) {
          await sleep(500);
          vfLog(`NUEVO audio generado: ${audio.duration.toFixed(2)}s`, 'success');
          return true;
        }
        // Si es data URL diferente
        if (audio.src !== previousAudioSrc && audio.src.startsWith('data:audio/')) {
          await sleep(500);
          vfLog('NUEVO audio generado (data URL diferente)', 'success');
          return true;
        }
      } else {
        // No hay audio anterior, cualquier audio válido es bueno
        if (audio.duration > 0) {
          await sleep(500);
          vfLog(`Audio generado: ${audio.duration.toFixed(2)}s`, 'success');
          return true;
        }
        if (audio.src.startsWith('data:audio/')) {
          await sleep(500);
          vfLog('Audio generado (data URL detectado)', 'success');
          return true;
        }
      }
    }

    await sleep(1000);
  }

  vfLog('Timeout esperando generación de audio', 'error');
  return false;
}

// ========== DOWNLOAD ==========

/**
 * Detecta el formato del audio desde el data URL o src
 * @param {string} src - URL o data URL del audio
 * @returns {string} - Extensión del archivo (wav, mp3, etc.)
 */
function detectAudioFormat(src) {
  if (!src) return 'wav';

  // Data URL: data:audio/wav;base64,... o data:audio/mpeg;base64,...
  if (src.startsWith('data:audio/')) {
    const match = src.match(/data:audio\/([^;,]+)/);
    if (match) {
      const mimeType = match[1].toLowerCase();
      if (mimeType === 'mpeg' || mimeType === 'mp3') return 'mp3';
      if (mimeType === 'wav' || mimeType === 'wave') return 'wav';
      if (mimeType === 'ogg') return 'ogg';
      return mimeType;
    }
  }

  // URL normal: buscar extensión
  const urlMatch = src.match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();

  return 'wav'; // Default para AI Studio
}

/**
 * Descarga el audio generado (via background script para ruta correcta)
 * @param {number} index - Índice de la escena
 * @param {string} projectFolder - Carpeta del proyecto (ej: "VidFlow/Proyecto_xxx/narracion")
 * @returns {Promise<string|null>} - Nombre del archivo descargado
 */
async function downloadGeneratedAudio(index, projectFolder) {
  console.log('=== VidFlow Speech: downloadGeneratedAudio INICIADO ===');
  console.log('Index:', index, 'ProjectFolder:', projectFolder);
  vfLog(`=== DESCARGA AUDIO ${index + 1} ===`, 'step');

  const audioElement = getAudioPlayer();
  console.log('AudioElement:', audioElement);
  console.log('AudioElement src:', audioElement?.src?.substring(0, 100));

  if (!audioElement || !audioElement.src) {
    vfLog('No hay audio para descargar', 'error');
    console.error('VidFlow Speech: No hay audioElement o src');
    return null;
  }

  // Detectar formato del audio
  const audioFormat = detectAudioFormat(audioElement.src);
  const filename = `${String(index + 1).padStart(2, '0')}_speech.${audioFormat}`;

  console.log('Formato detectado:', audioFormat);
  console.log('Filename:', filename);

  // Log detallado para debugging
  const srcPreview = audioElement.src.substring(0, 100);
  vfLog(`Audio src: ${srcPreview}...`, 'info');
  vfLog(`Duración: ${audioElement.duration}s, Formato: ${audioFormat}`, 'info');

  try {
    // Obtener el audio como data URL
    let dataUrl = audioElement.src;
    console.log('Es data URL?:', dataUrl.startsWith('data:'));

    // Si no es data URL, convertir
    if (!dataUrl.startsWith('data:')) {
      vfLog('Convirtiendo URL a dataURL...', 'info');
      console.log('Intentando fetch de:', audioElement.src);

      try {
        const response = await fetch(audioElement.src);
        console.log('Fetch response status:', response.status);

        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.status}`);
        }

        const blob = await response.blob();
        console.log('Blob size:', blob.size, 'type:', blob.type);

        dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            console.log('FileReader completado, dataUrl length:', reader.result?.length);
            resolve(reader.result);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch (fetchError) {
        console.error('Error en fetch/conversión:', fetchError);
        vfLog(`Error obteniendo audio: ${fetchError.message}`, 'error');
        return null;
      }
    }

    // Construir la ruta completa del archivo
    const fullPath = projectFolder ? `${projectFolder}/${filename}` : filename;
    console.log('Full path construido:', fullPath);
    vfLog(`Ruta de descarga: ${fullPath}`, 'info');

    // Verificar que tenemos dataUrl válido
    if (!dataUrl || dataUrl.length < 100) {
      console.error('DataUrl inválido o muy corto:', dataUrl?.length);
      vfLog('Error: dataUrl inválido', 'error');
      return null;
    }

    console.log('Enviando mensaje downloadSpeechAudio al background...');
    console.log('DataUrl length:', dataUrl.length);

    // Enviar al background para descargar con ruta correcta
    const response = await chrome.runtime.sendMessage({
      action: 'downloadSpeechAudio',
      data: {
        dataUrl: dataUrl,
        filename: fullPath,
        index: index
      }
    });

    console.log('Respuesta del background:', response);

    if (response && response.success) {
      vfLog(`Audio ${index + 1} descargado: ${response.filename || fullPath}`, 'success');
      console.log('=== DESCARGA EXITOSA ===');
      return filename;
    } else {
      vfLog(`Error en descarga: ${response?.error || 'desconocido'}`, 'error');
      console.error('Error en respuesta:', response);
      return null;
    }

  } catch (error) {
    console.error('Error general en downloadGeneratedAudio:', error);
    vfLog(`Error descargando audio: ${error.message}`, 'error');
    return null;
  }
}

/**
 * Obtiene la URL del audio generado
 * @returns {string|null}
 */
function getGeneratedAudioUrl() {
  const audioElement = getAudioPlayer();
  return audioElement?.src || null;
}

/**
 * Obtiene el audio generado como data URL
 * Si ya es un data URL, lo devuelve directamente
 * Si es una URL normal, intenta convertirlo
 * @returns {Promise<string|null>}
 */
async function getGeneratedAudioAsDataURL() {
  try {
    const audioElement = getAudioPlayer();
    if (!audioElement || !audioElement.src) return null;

    // Si ya es un data URL, devolverlo directamente
    if (audioElement.src.startsWith('data:')) {
      return audioElement.src;
    }

    // Si es una URL normal, convertir a data URL
    const response = await fetch(audioElement.src);
    const blob = await response.blob();

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('VidFlow Speech: Error obteniendo audio como dataURL:', error);
    return null;
  }
}

/**
 * Obtiene información del audio generado
 * @returns {Object|null}
 */
function getAudioInfo() {
  const audioElement = getAudioPlayer();
  if (!audioElement) return null;

  return {
    src: audioElement.src,
    duration: audioElement.duration,
    format: detectAudioFormat(audioElement.src),
    hasAudio: audioElement.src && audioElement.duration > 0
  };
}

// ========== PLAYBACK ==========

/**
 * Reproduce el audio generado
 * @returns {Promise<boolean>}
 */
async function playAudio() {
  const audioElement = getAudioPlayer();

  if (audioElement) {
    await audioElement.play();
    return true;
  }

  return false;
}

/**
 * Pausa el audio
 * @returns {Promise<boolean>}
 */
async function pauseAudio() {
  const audioElement = getAudioPlayer();

  if (audioElement) {
    audioElement.pause();
    return true;
  }

  return false;
}

/**
 * Genera audio completo para una escena
 * @param {Object} sceneData - Datos de la escena {narration, style}
 * @param {number} index - Índice de la escena
 * @returns {Promise<{success: boolean, audioUrl?: string, error?: string}>}
 */
async function generateSpeechAudio(sceneData, index) {
  try {
    vfLog(`=== Generando audio escena ${index + 1} ===`, 'info');

    // 1. Asegurar modo Single-speaker
    await ensureSingleSpeakerMode();

    // 2. Configurar style instructions si hay
    if (sceneData.style) {
      if (!await enterStyleInstructions(sceneData.style)) {
        vfLog('Continuando sin style instructions', 'warn');
      }
    }

    // 3. Ingresar el texto de narración
    if (!await enterNarrationText(sceneData.narration)) {
      return { success: false, error: 'No se pudo ingresar el texto' };
    }

    // 4. Generar (captura el src anterior para detectar cambio)
    const generateResult = await clickGenerate();
    if (!generateResult.success) {
      return { success: false, error: 'No se pudo iniciar generación' };
    }

    // 5. Esperar resultado (pasando el src anterior)
    if (!await waitForGeneration(60000, generateResult.previousAudioSrc)) {
      return { success: false, error: 'Timeout en generación' };
    }

    // 6. Obtener URL de audio
    const audioUrl = getGeneratedAudioUrl();

    return { success: true, audioUrl };
  } catch (error) {
    vfLog(`Error en generación: ${error.message}`, 'error');
    return { success: false, error: error.message };
  }
}

console.log('VidFlow Speech: generation.js cargado');
