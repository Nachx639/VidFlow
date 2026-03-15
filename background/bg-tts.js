/**
 * VidFlow - Gemini TTS API
 * getGeminiApiKey, generateSpeechViaAPI, downloadSpeechAudio, writeString.
 * WAV conversion (PCM 16-bit, 24000 Hz, mono).
 */

// ========== GEMINI TTS API ==========

// API Key cargada desde chrome.storage.local (configurada por el usuario en el sidepanel)
var storedGeminiApiKey = '';

// Cargar la key al arrancar el service worker
chrome.storage.local.get(['vidflowState'], (result) => {
  const savedKey = result?.vidflowState?.config?.geminiApiKey;
  if (savedKey) {
    storedGeminiApiKey = savedKey;
    console.log('VidFlow BG: Gemini API key cargada desde storage');
  }
});

// Escuchar cambios en storage para actualizar la key en tiempo real
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.vidflowState?.newValue?.config?.geminiApiKey) {
    storedGeminiApiKey = changes.vidflowState.newValue.config.geminiApiKey;
    console.log('VidFlow BG: Gemini API key actualizada desde storage');
  }
});

/**
 * Obtiene la API key de Gemini (de la config del pipeline, storage, o vacía)
 */
function getGeminiApiKey() {
  return pipelineState.config?.geminiApiKey || storedGeminiApiKey || '';
}

/**
 * Genera audio usando la API de Gemini TTS
 * @param {string} text - Texto a convertir en audio
 * @param {string} voiceName - Nombre de la voz (ej: 'Sulafat', 'Puck')
 * @param {string} model - Modelo TTS ('gemini-2.5-pro-preview-tts' o 'gemini-2.5-flash-preview-tts')
 * @returns {Promise<{success: boolean, audioData?: string, error?: string}>}
 */
async function generateSpeechViaAPI(text, voiceName = 'Sulafat', model = 'gemini-2.5-pro-preview-tts') {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.error('VidFlow BG: generateSpeechViaAPI called with invalid text:', typeof text);
    return { success: false, error: 'Texto inválido o vacío para TTS' };
  }

  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return { success: false, error: 'No hay API Key de Gemini configurada' };
  }

  console.log(`VidFlow BG: Generando TTS via API - Voz: ${voiceName}, Modelo: ${model}`);
  console.log(`VidFlow BG: Texto: "${text.substring(0, 50)}..."`);

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: text }]
            }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceName
                  }
                }
              }
            }
          })
        }
      );

      const data = await response.json();

      if (data.error) {
        // Si es error de quota/rate limit, esperar y reintentar
        if (data.error.code === 429 && attempt < MAX_RETRIES) {
          const retryDelay = parseInt(data.error.details?.find(d => d.retryDelay)?.retryDelay) || 30;
          console.log(`VidFlow BG: Rate limit, esperando ${retryDelay}s antes de reintentar...`);
          await sleep(retryDelay * 1000 + 2000);
          continue;
        }
        throw new Error(data.error.message || 'Error en API de Gemini');
      }

      // Extraer audio data
      const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      const mimeType = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType;

      if (!audioData) {
        throw new Error('No se recibió audio de la API');
      }

      console.log(`VidFlow BG: Audio generado OK - MIME: ${mimeType}, Size: ${audioData.length} chars`);

      return {
        success: true,
        audioData: audioData,
        mimeType: mimeType || 'audio/L16;codec=pcm;rate=24000'
      };

    } catch (error) {
      console.error(`VidFlow BG: Error en intento ${attempt}:`, error.message);

      if (attempt >= MAX_RETRIES) {
        return { success: false, error: error.message };
      }

      // Esperar antes de reintentar
      await sleep(3000);
    }
  }

  return { success: false, error: 'Error después de múltiples reintentos' };
}

/**
 * Convierte audio PCM a WAV y lo descarga
 * @param {string} pcmBase64 - Audio PCM en base64
 * @param {string} filename - Nombre del archivo (con path)
 * @returns {Promise<{success: boolean, downloadId?: number, error?: string}>}
 */
async function downloadSpeechAudio(pcmBase64, filename) {
  if (!pcmBase64 || typeof pcmBase64 !== 'string') {
    console.error('VidFlow BG: downloadSpeechAudio called with invalid pcmBase64');
    return { success: false, error: 'Datos de audio inválidos' };
  }
  if (!filename || typeof filename !== 'string') {
    console.error('VidFlow BG: downloadSpeechAudio called with invalid filename');
    return { success: false, error: 'Nombre de archivo inválido' };
  }

  try {
    // Decodificar PCM base64
    const pcmData = atob(pcmBase64);
    const pcmBytes = new Uint8Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      pcmBytes[i] = pcmData.charCodeAt(i);
    }

    // Crear header WAV (PCM 16-bit, 24000 Hz, mono)
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmBytes.length;
    const fileSize = 44 + dataSize;

    const wavBuffer = new ArrayBuffer(fileSize);
    const view = new DataView(wavBuffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Copiar datos PCM
    const wavBytes = new Uint8Array(wavBuffer);
    wavBytes.set(pcmBytes, 44);

    // Convertir a base64 data URL
    // Note: String.fromCharCode.apply has a max args limit (~65K),
    // so we chunk the conversion for large audio files.
    let wavBinaryStr = '';
    const CHUNK_SIZE = 8192;
    for (let offset = 0; offset < wavBytes.length; offset += CHUNK_SIZE) {
      const chunk = wavBytes.subarray(offset, Math.min(offset + CHUNK_SIZE, wavBytes.length));
      wavBinaryStr += String.fromCharCode.apply(null, chunk);
    }
    const wavBase64 = btoa(wavBinaryStr);
    const dataUrl = `data:audio/wav;base64,${wavBase64}`;

    // Asegurar path completo
    let fullFilename = filename;
    if (!fullFilename.startsWith('VidFlow/')) {
      fullFilename = `VidFlow/${fullFilename}`;
    }
    // Cambiar extensión a .wav
    fullFilename = fullFilename.replace(/\.[^.]+$/, '.wav');

    console.log('VidFlow BG: Descargando audio WAV:', fullFilename);

    // Guardar pending download para el listener
    setPendingSpeechDownload(fullFilename);

    // Descargar
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: fullFilename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    // Registrar esta descarga como iniciada por VidFlow
    registerVidFlowDownload(downloadId);

    return { success: true, downloadId };

  } catch (error) {
    console.error('VidFlow BG: Error descargando audio:', error);
    return { success: false, error: error.message };
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
