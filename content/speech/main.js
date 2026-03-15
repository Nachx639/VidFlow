/**
 * VidFlow - Speech Main Content Script
 * Automatiza AI Studio Speech para generación de narración
 * URL: https://aistudio.google.com/generate-speech
 */

(function() {
  'use strict';

  console.log('VidFlow Speech: main.js cargado');

  // ========== STATE ==========
  let isAutomating = false;
  let currentSceneIndex = 0;
  let totalScenes = 0;

  // ========== INITIALIZATION ==========

  // Notificar al background que estamos listos
  chrome.runtime.sendMessage({ action: 'contentScriptReady', page: 'speech' });

  // Inicializar panel de log
  setTimeout(() => {
    initLogPanel();
    vfLog('Speech content script listo', 'success');
  }, 1000);

  // ========== MESSAGE LISTENER ==========

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Speech recibió mensaje:', message.action);

    switch (message.action) {
      case 'ping':
        sendResponse({ success: true, page: 'speech' });
        break;

      case 'initSpeechPanel':
        initLogPanel();
        sendResponse({ success: true });
        break;

      case 'setupSpeechConfig':
        handleSetupConfig(message.data).then(sendResponse);
        return true;

      case 'generateSpeechAudio':
        handleGenerateAudio(message.data).then(sendResponse);
        return true;

      case 'speechGenerateSingle':
        handleSingleGeneration(message.data).then(sendResponse);
        return true;

      case 'stopAutomation':
        stopAutomation();
        sendResponse({ success: true });
        break;

      case 'getSpeechStatus':
        sendResponse({
          success: true,
          isAutomating,
          currentSceneIndex,
          totalScenes
        });
        break;

      // ========== PIPELINE LINEAL HANDLERS ==========
      case 'setupSpeechPipeline':
        handleSetupPipeline(message.data).then(sendResponse);
        return true;

      case 'generateSpeechScene':
        handleGenerateScene(message.data).then(sendResponse);
        return true;

      default:
        sendResponse({ success: false, error: 'Acción desconocida' });
    }

    return true;
  });

  // ========== HANDLERS ==========

  /**
   * Configura opciones globales de speech
   */
  async function handleSetupConfig(data) {
    try {
      vfLog('Configurando opciones de speech...', 'step');

      // Esperar a que la página esté lista
      await waitForPageReady();

      // Configurar idioma si se especifica
      if (data.language) {
        await selectLanguage(data.language);
      }

      // Configurar voz si se especifica
      if (data.voice) {
        await selectVoice(data.voice);
      }

      return { success: true };
    } catch (error) {
      vfLog(`Error en configuración: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Genera audio para una escena específica
   */
  async function handleGenerateAudio(data) {
    if (!isAutomating && data.startAutomation) {
      isAutomating = true;
      totalScenes = data.totalScenes || 1;
    }

    if (!isAutomating) {
      return { success: false, error: 'Automatización no activa' };
    }

    try {
      currentSceneIndex = data.index;
      vfLog(`=== Narración ${data.index + 1}/${totalScenes} ===`, 'step');

      // 1. Configurar style instructions si existen
      if (data.styleInstructions) {
        await enterStyleInstructions(data.styleInstructions);
      }

      // 2. Limpiar texto anterior
      await clearText();

      // 3. Ingresar texto de narración
      const narrationText = data.narration || data.text;
      if (!narrationText) {
        throw new Error('No hay texto de narración');
      }

      if (!await enterNarrationText(narrationText)) {
        throw new Error('No se pudo ingresar el texto');
      }

      // 4. Configurar voz específica si existe
      if (data.voice) {
        await selectVoice(data.voice);
      }

      // 5. Generar audio (captura el src anterior para detectar cambio)
      const generateResult = await clickGenerate();
      if (!generateResult.success) {
        throw new Error('No se pudo iniciar la generación');
      }

      // 6. Esperar resultado (pasando el src anterior)
      if (!await waitForGeneration(60000, generateResult.previousAudioSrc)) {
        throw new Error('La generación falló o expiró');
      }

      // 7. Descargar audio
      const filename = await downloadGeneratedAudio(data.index, data.projectFolder);
      if (!filename) {
        throw new Error('No se pudo descargar el audio');
      }

      // 8. Notificar al background
      await chrome.runtime.sendMessage({
        action: 'speechAudioGenerated',
        data: {
          index: data.index,
          filename: filename,
          audioUrl: getGeneratedAudioUrl()
        }
      });

      return { success: true, filename };

    } catch (error) {
      vfLog(`Error generando audio: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Genera un solo audio (modo manual)
   */
  async function handleSingleGeneration(data) {
    try {
      vfLog('Generación manual de audio iniciada', 'step');

      // Configurar idioma/voz si existen
      if (data.language) {
        await selectLanguage(data.language);
      }
      if (data.voice) {
        await selectVoice(data.voice);
      }

      // Ingresar texto
      if (data.text) {
        await enterNarrationText(data.text);
      }

      // Generar (captura el src anterior para detectar cambio)
      const generateResult = await clickGenerate();
      if (!generateResult.success) {
        throw new Error('No se pudo iniciar la generación');
      }
      await waitForGeneration(60000, generateResult.previousAudioSrc);

      const audioUrl = getGeneratedAudioUrl();
      vfLog('Generación manual completada', 'success');

      return { success: true, audioUrl };

    } catch (error) {
      vfLog(`Error: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Detiene la automatización
   */
  function stopAutomation() {
    isAutomating = false;
    currentSceneIndex = 0;
    totalScenes = 0;
    vfLog('Automatización detenida', 'warn');
  }

  // ========== PIPELINE LINEAL HANDLERS ==========

  // Estado del pipeline
  let pipelineConfig = {
    scenes: [],
    projectFolder: null,
    config: {}
  };

  /**
   * Configura el pipeline (recibe datos del background)
   */
  async function handleSetupPipeline(data) {
    try {
      vfLog('Configurando pipeline Speech...', 'step');

      pipelineConfig = {
        scenes: data.scenes || [],
        projectFolder: data.projectFolder || 'VidFlow',
        config: data.config || {}
      };

      totalScenes = pipelineConfig.scenes.length;
      isAutomating = true;
      currentSceneIndex = 0;

      // Esperar a que la página esté lista
      await waitForPageReady();

      // IMPORTANTE: Asegurar modo Single-speaker
      vfLog('Verificando modo Single-speaker...', 'step');
      await ensureSingleSpeakerMode();
      await sleep(500);

      // Configurar voz global (speechVoice del config o voice como fallback)
      const voiceToUse = data.config?.speechVoice || data.config?.voice;
      if (voiceToUse) {
        vfLog(`Configurando voz: ${voiceToUse}`, 'step');
        const voiceSelected = await selectVoice(voiceToUse);
        if (voiceSelected) {
          vfLog(`Voz configurada: ${voiceToUse}`, 'success');
        } else {
          vfLog(`Voz ${voiceToUse} no encontrada, usando default`, 'warn');
        }
      }

      vfLog(`Pipeline configurado: ${totalScenes} narraciones`, 'success');
      return { success: true };

    } catch (error) {
      vfLog(`Error en setup pipeline: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  /**
   * Genera audio para una escena del pipeline
   */
  async function handleGenerateScene(data) {
    if (!isAutomating) {
      isAutomating = true;
      totalScenes = pipelineConfig.scenes.length || 1;
    }

    try {
      currentSceneIndex = data.index;
      vfLog(`=== Pipeline Narración ${data.index + 1}/${totalScenes} ===`, 'step');

      // 1. Limpiar texto anterior
      await clearText();
      await sleep(300);

      // 2. Configurar style instructions si existen
      if (data.styleInstructions) {
        vfLog('Configurando estilo...', 'step');
        await enterStyleInstructions(data.styleInstructions);
      }

      // 3. Ingresar texto de narración
      const narrationText = data.narration || data.text;
      vfLog(`Texto: "${narrationText?.substring(0, 50)}..."`, 'step');

      if (!narrationText) {
        throw new Error('No hay texto de narración');
      }

      if (!await enterNarrationText(narrationText)) {
        throw new Error('No se pudo ingresar el texto');
      }

      // 4. Configurar voz específica si existe
      if (data.voice) {
        await selectVoice(data.voice);
      }

      // 5. Generar audio (captura el src anterior para detectar cambio)
      vfLog('Iniciando generación...', 'step');
      const generateResult = await clickGenerate();
      if (!generateResult.success) {
        throw new Error('No se pudo iniciar la generación');
      }

      // 6. Esperar resultado (pasando el src anterior para detectar el NUEVO audio)
      vfLog('Esperando audio...', 'step');
      if (!await waitForGeneration(60000, generateResult.previousAudioSrc)) {
        throw new Error('La generación falló o expiró');
      }

      // 7. Obtener audio como dataURL (para pasar entre pasos si es necesario)
      const audioData = await getGeneratedAudioAsDataURL();

      // 8. Descargar audio a la carpeta del proyecto (projectFolder ya incluye /narracion)
      const filename = await downloadGeneratedAudio(data.index, data.projectFolder);

      vfLog(`Audio ${data.index + 1} generado: ${filename}`, 'success');

      // 9. Notificar al background (para el pipeline)
      await chrome.runtime.sendMessage({
        action: 'speechSceneComplete',
        data: {
          index: data.index,
          filename: filename,
          audioData: audioData,
          duration: getAudioInfo()?.duration || 0
        }
      });

      return { success: true, filename, audioData };

    } catch (error) {
      vfLog(`Error en narración ${data.index + 1}: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

})();
