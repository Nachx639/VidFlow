/**
 * VidFlow - Panel Scenes Management
 * Scene import, style toggle, summary rendering, image prompts, and reference matching.
 */

// ========== SCENES ==========

function initScenes() {
  // Botón importar
  document.getElementById('vf-import-btn')?.addEventListener('click', importScenes);

  // Botón limpiar escenas
  document.getElementById('vf-clear-scenes')?.addEventListener('click', clearScenes);

  // Botones limpiar campos individuales
  document.getElementById('vf-clear-prompts')?.addEventListener('click', () => {
    const textarea = document.getElementById('vf-import-prompts');
    if (textarea) {
      textarea.value = '';
      state.importDrafts.prompts = '';
      saveState();
      importScenes();
    }
  });

  document.getElementById('vf-clear-narrations')?.addEventListener('click', () => {
    const textarea = document.getElementById('vf-import-narrations');
    if (textarea) {
      textarea.value = '';
      state.importDrafts.narrations = '';
      saveState();
      importScenes();
    }
  });

  document.getElementById('vf-clear-style')?.addEventListener('click', () => {
    const input = document.getElementById('vf-speech-style');
    if (input) {
      input.value = '';
      state.config.speechStyle = '';
      saveState();
    }
  });

  // Guardar drafts y auto-importar con debounce
  let autoImportTimer = null;
  const scheduleAutoImport = () => {
    clearTimeout(autoImportTimer);
    autoImportTimer = setTimeout(() => importScenes(), 400);
  };

  document.getElementById('vf-import-prompts')?.addEventListener('input', (e) => {
    state.importDrafts.prompts = e.target.value;
    saveState();
    scheduleAutoImport();
  });

  document.getElementById('vf-import-narrations')?.addEventListener('input', (e) => {
    state.importDrafts.narrations = e.target.value;
    saveState();
    scheduleAutoImport();
  });

  document.getElementById('vf-import-styles')?.addEventListener('input', (e) => {
    state.importDrafts.styles = e.target.value;
    saveState();
    scheduleAutoImport();
  });

  // Toggle mismo estilo / estilos por escena
  document.getElementById('vf-same-style')?.addEventListener('change', (e) => {
    state.config.useSameStyle = e.target.checked;
    toggleStyleMode(e.target.checked);
    saveState();
  });

  // Estilo único
  document.getElementById('vf-speech-style')?.addEventListener('input', (e) => {
    state.config.speechStyle = e.target.value;
    saveState();
  });

  // Estilo default (para batch)
  document.getElementById('vf-default-style')?.addEventListener('input', (e) => {
    state.config.defaultStyle = e.target.value;
    saveState();
  });

  renderScenesSummary();
}

function toggleStyleMode(useSameStyle) {
  const singleContainer = document.getElementById('vf-single-style-container');
  const batchContainer = document.getElementById('vf-batch-style-container');

  if (useSameStyle) {
    singleContainer.style.display = 'block';
    batchContainer.style.display = 'none';
  } else {
    singleContainer.style.display = 'none';
    batchContainer.style.display = 'block';
  }
}

function clearScenes(clearInputs) {
  state.scenes = [];
  if (clearInputs) {
    state.batchImages = [];
    state.referenceCategories = [];
    state.importDrafts = { prompts: '', narrations: '', styles: '' };
    const promptsEl = document.getElementById('vf-import-prompts');
    const narrationsEl = document.getElementById('vf-import-narrations');
    const stylesEl = document.getElementById('vf-import-styles');
    if (promptsEl) promptsEl.value = '';
    if (narrationsEl) narrationsEl.value = '';
    if (stylesEl) stylesEl.value = '';
    document.getElementById('vf-folder-name').value = '';
    updateBatchUI();
    renderReferenceCategories();
  }
  renderScenesSummary();
  updateStartButton();
  saveState();
}

function renderScenesSummary() {
  const summary = document.getElementById('vf-scenes-summary');
  const promptsCount = document.getElementById('vf-prompts-count');
  const narrationsCount = document.getElementById('vf-narrations-count');
  const stylesCount = document.getElementById('vf-styles-count');
  const stylesStat = document.getElementById('vf-styles-stat');
  const sceneRange = document.getElementById('vf-scene-range');

  if (!summary) return;

  if (state.scenes.length === 0) {
    summary.style.display = 'none';
    return;
  }

  // Contar escenas
  const withPrompt = state.scenes.filter(s => s.prompt && s.prompt.trim()).length;
  const withNarration = state.scenes.filter(s => s.narration && s.narration.trim()).length;
  const withCustomStyle = state.scenes.filter(s => s.style && s.style !== state.config.defaultStyle && s.style !== state.config.speechStyle).length;

  // Obtener rango de números de escena
  const sceneNumbers = state.scenes.map(s => s.sceneNumber).filter(n => n != null).sort((a, b) => a - b);
  const minScene = sceneNumbers[0];
  const maxScene = sceneNumbers[sceneNumbers.length - 1];

  promptsCount.textContent = withPrompt;
  narrationsCount.textContent = withNarration;

  // Mostrar estilos solo si no usa "mismo estilo para todas"
  if (stylesStat) {
    if (state.config.useSameStyle) {
      stylesStat.style.display = 'none';
    } else {
      stylesStat.style.display = 'inline';
      stylesCount.textContent = withCustomStyle;
    }
  }

  // Mostrar rango de escenas
  if (sceneRange && sceneNumbers.length > 0) {
    sceneRange.textContent = `Escenas ${minScene} - ${maxScene}`;
  }

  summary.style.display = 'block';

  updateRefsMatch();
}

function importScenes() {
  const promptsText = document.getElementById('vf-import-prompts')?.value?.trim();
  const narrationsText = document.getElementById('vf-import-narrations')?.value?.trim();
  const stylesText = document.getElementById('vf-import-styles')?.value?.trim();

  if (!promptsText) {
    state.scenes = [];
    renderScenesSummary();
    updateStartButton();
    saveState();
    return;
  }

  // Limpiar escenas anteriores antes de importar nuevas
  state.scenes = [];

  // Parsear bloques numerados
  const promptsMap = parseNumberedBlocks(promptsText);
  const narrationsMap = parseNumberedBlocks(narrationsText);
  const stylesMap = parseNumberedBlocks(stylesText);

  // Obtener estilo default
  const useSameStyle = state.config.useSameStyle;
  const defaultStyle = useSameStyle
    ? state.config.speechStyle
    : (state.config.defaultStyle || 'Read aloud in a warm and friendly tone:');

  // Crear escenas por cada prompt numerado
  const sceneNumbers = Array.from(promptsMap.keys()).sort((a, b) => a - b);

  let truncatedCount = 0;
  sceneNumbers.forEach(num => {
    let prompt = promptsMap.get(num);
    let narration = narrationsMap.get(num) || ''; // Vacío si no existe
    const style = useSameStyle ? defaultStyle : (stylesMap.get(num) || defaultStyle);

    // Truncate extremely long prompts to prevent storage/performance issues
    if (prompt.length > MAX_PROMPT_LENGTH) {
      prompt = prompt.substring(0, MAX_PROMPT_LENGTH);
      truncatedCount++;
    }
    if (narration.length > MAX_PROMPT_LENGTH) {
      narration = narration.substring(0, MAX_PROMPT_LENGTH);
    }

    state.scenes.push({
      id: 'scene_' + Date.now() + '_' + num,
      sceneNumber: num, // Guardamos el número original
      prompt: prompt,
      narration: narration,
      style: style,
      references: { subject: null, scene: null, style: null }
    });
  });

  if (truncatedCount > 0) {
    console.warn(`VidFlow: ${truncatedCount} prompt(s) truncated to ${MAX_PROMPT_LENGTH} chars`);
  }

  // NO limpiar campos (por si el usuario quiere volver a importar)
  // Solo limpiar escenas anteriores está en clearScenes()

  renderScenesSummary();
  updateStartButton();
  saveState();

  console.log(`VidFlow: ${sceneNumbers.length} escenas importadas (números: ${sceneNumbers.join(', ')})`);
}

// ========== REFERENCE CATEGORIES ==========

function initImagePrompts() {
  const textarea = document.getElementById('vf-image-prompts');
  const copyBtn = document.getElementById('vf-copy-image-prompts');
  const clearBtn = document.getElementById('vf-clear-image-prompts');

  textarea?.addEventListener('input', (e) => {
    state.importDrafts.imagePrompts = e.target.value;
    updateRefsMatch();
    saveState();
  });

  copyBtn?.addEventListener('click', () => {
    const text = textarea?.value?.trim();
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '\u2713';
        setTimeout(() => { copyBtn.textContent = '\uD83D\uDCCB'; }, 1500);
      });
    }
  });

  clearBtn?.addEventListener('click', () => {
    if (textarea) {
      textarea.value = '';
      state.importDrafts.imagePrompts = '';
      updateRefsMatch();
      saveState();
    }
  });
}

/**
 * Cuenta las referencias (image prompts + batch images) y valida contra escenas
 */
function countImagePrompts() {
  const text = document.getElementById('vf-image-prompts')?.value || '';
  return parseNumberedPrompts(text).length;
}

function updateRefsMatch() {
  const imagePromptCount = countImagePrompts();
  const batchCount = state.batchImages.length;
  const sceneCount = state.scenes.length;
  const totalRefs = imagePromptCount + batchCount;

  // Indicador en tab Referencias - Image Prompts
  const refsMatchEl = document.getElementById('vf-refs-match');
  if (refsMatchEl) {
    if (imagePromptCount > 0 && sceneCount > 0) {
      const match = imagePromptCount === sceneCount;
      refsMatchEl.className = `vf-refs-match ${match ? 'vf-match-ok' : 'vf-match-warn'}`;
      refsMatchEl.textContent = match
        ? `${imagePromptCount} prompts de imagen = ${sceneCount} escenas`
        : `${imagePromptCount} prompts de imagen \u2260 ${sceneCount} escenas`;
      refsMatchEl.style.display = 'block';
    } else {
      refsMatchEl.style.display = 'none';
    }
  }

  // Indicador en tab Referencias - Batch images
  const batchMatchEl = document.getElementById('vf-batch-match');
  if (batchMatchEl) {
    if (batchCount > 0 && sceneCount > 0) {
      const match = batchCount === sceneCount;
      batchMatchEl.className = `vf-refs-match ${match ? 'vf-match-ok' : 'vf-match-warn'}`;
      batchMatchEl.textContent = match
        ? `${batchCount} im\u00E1genes = ${sceneCount} escenas`
        : `${batchCount} im\u00E1genes \u2260 ${sceneCount} escenas`;
      batchMatchEl.style.display = 'block';
    } else {
      batchMatchEl.style.display = 'none';
    }
  }

  // Indicador en tab Escenas - resumen
  const refsStat = document.getElementById('vf-refs-stat');
  const refsCount = document.getElementById('vf-refs-count');
  const mismatchEl = document.getElementById('vf-refs-mismatch');

  if (refsStat && refsCount) {
    if (totalRefs > 0) {
      refsCount.textContent = totalRefs;
      refsStat.style.display = 'inline';
    } else {
      refsStat.style.display = 'none';
    }
  }

  if (mismatchEl) {
    if (totalRefs > 0 && sceneCount > 0 && totalRefs !== sceneCount) {
      mismatchEl.className = 'vf-summary-mismatch vf-match-warn';
      mismatchEl.textContent = `${totalRefs} referencias \u2260 ${sceneCount} escenas`;
      mismatchEl.style.display = 'block';
    } else if (totalRefs > 0 && sceneCount > 0 && totalRefs === sceneCount) {
      mismatchEl.className = 'vf-summary-mismatch vf-match-ok';
      mismatchEl.textContent = `${totalRefs} referencias = ${sceneCount} escenas`;
      mismatchEl.style.display = 'block';
    } else {
      mismatchEl.style.display = 'none';
    }
  }
}

console.log('VidFlow: panel-scenes.js cargado');
