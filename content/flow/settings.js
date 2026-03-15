/**
 * VidFlow - Configuración de Ajustes
 * Nuevo Flow 2025: settings popup con role="tab" + model dropdown con role="menu"
 * Interacción via focus() + Enter (btn.click() no abre popups en este UI)
 */

// ========== HELPERS ==========

/**
 * Simula un click real en un elemento del nuevo Flow.
 * El UI de Google Flow usa React con event handlers que no responden a btn.click().
 * focus() + Enter funciona de forma consistente.
 * @param {Element} el - Elemento a clickar
 */
async function flowClick(el) {
  if (!el) return;
  el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  await sleep(300);
}

/**
 * Encuentra el botón de settings inline del nuevo Flow.
 * Es el botón que muestra "Vídeocrop_16_9x1" o similar (tipo + orientación + cantidad).
 * @returns {Element|null}
 */
function findSettingsButton() {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || '';
    // El botón contiene "crop" (icono de orientación) + "x" + número (resultados)
    if (text.includes('crop') && /x\d/.test(text) && text.length < 30) {
      return btn;
    }
  }
  return null;
}

/**
 * Verifica si el popup de settings está visible (buscando tabs de orientación)
 * @returns {boolean}
 */
function isSettingsPopupOpen() {
  const tabs = document.querySelectorAll('[role="tab"]');
  for (const t of tabs) {
    const text = t.textContent?.trim() || '';
    const rect = t.getBoundingClientRect();
    if (rect.height > 0 && (text.includes('Horizontal') || text.includes('Vertical'))) {
      return true;
    }
  }
  return false;
}

/**
 * Encuentra un tab visible en el popup de settings por texto
 * @param {Array<string>} targetTexts - Textos a buscar
 * @returns {Element|null}
 */
function findSettingsTab(targetTexts) {
  const tabs = document.querySelectorAll('[role="tab"]');
  for (const tab of tabs) {
    const text = tab.textContent?.trim() || '';
    const rect = tab.getBoundingClientRect();
    if (rect.height <= 0) continue;
    for (const target of targetTexts) {
      if (text.toLowerCase().includes(target.toLowerCase())) {
        return tab;
      }
    }
  }
  return null;
}

// ========== SETTINGS CONFIGURATION ==========

/**
 * Configura todos los ajustes del video
 * @param {Object} config - Configuración
 */
async function configureSettings(config) {
  vfLog('Configurando ajustes...', 'info');

  // Buscar botón de settings inline (nuevo Flow)
  let settingsBtn = findSettingsButton();

  // Fallback: buscar botón "tune" (viejo Flow)
  if (!settingsBtn) {
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const iconText = btn.textContent?.toLowerCase() || '';
      if (iconText.includes('tune') || iconText.includes('ajustes')) {
        settingsBtn = btn;
        break;
      }
    }
  }

  if (!settingsBtn) {
    vfLog('Botón de ajustes no encontrado', 'warn');
    return;
  }

  // Abrir popup de settings
  vfLog('Abriendo panel de ajustes...', 'info');
  await flowClick(settingsBtn);
  await sleep(300);

  if (!isSettingsPopupOpen()) {
    vfLog('Panel de ajustes no se abrió, reintentando...', 'warn');
    await flowClick(settingsBtn);
    await sleep(500);
  }

  if (!isSettingsPopupOpen()) {
    vfLog('Panel de ajustes no se pudo abrir', 'warn');
    return;
  }

  vfLog('Panel de ajustes abierto', 'success');

  // Configurar orientación
  if (config.aspectRatio) {
    await setAspectRatio(config.aspectRatio);
    await sleep(300);
  }

  // Configurar resultados por petición
  if (config.resultsPerRequest) {
    await setResultsPerRequest(config.resultsPerRequest);
    await sleep(300);
  }

  // Configurar modelo
  if (config.veoModel) {
    await setModel(config.veoModel);
    await sleep(300);
  }

  // Cerrar popup de settings
  vfLog('Cerrando panel de ajustes...', 'info');
  await closeSettingsPopup();
  await sleep(300);

  vfLog('Ajustes configurados', 'success');
}

/**
 * Cierra el popup de settings
 */
async function closeSettingsPopup() {
  // Método 1: Escape
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await sleep(200);

  if (!isSettingsPopupOpen()) return;

  // Método 2: Click en el prompt input (fuera del popup)
  const promptEl = findPromptInput();
  if (promptEl) {
    promptEl.focus();
    await sleep(200);
  }

  if (!isSettingsPopupOpen()) return;

  // Método 3: Click en el botón de settings de nuevo (toggle)
  const settingsBtn = findSettingsButton();
  if (settingsBtn) {
    await flowClick(settingsBtn);
  }
}

/**
 * Configura la orientación del video (nuevo Flow: tabs con role="tab")
 * @param {string} ratio - '16:9' o '9:16'
 */
async function setAspectRatio(ratio) {
  vfLog('  - Orientación: ' + ratio, 'info');

  const targetTexts = ratio === '9:16'
    ? ['Vertical', 'crop_9_16']
    : ['Horizontal', 'crop_16_9'];

  const tab = findSettingsTab(targetTexts);
  if (!tab) {
    vfLog('  Tab de orientación no encontrado', 'warn');
    return;
  }

  if (tab.getAttribute('aria-selected') === 'true') {
    vfLog('  Orientación ya configurada: ' + ratio, 'info');
    return;
  }

  await flowClick(tab);

  if (tab.getAttribute('aria-selected') === 'true') {
    vfLog('  Orientación configurada: ' + ratio, 'success');
  } else {
    vfLog('  No se pudo cambiar orientación', 'warn');
  }
}

/**
 * Configura el número de resultados por petición (nuevo Flow: tabs x1/x2/x3/x4)
 * @param {number} count - 1 a 4
 */
async function setResultsPerRequest(count) {
  vfLog('  - Resultados: x' + count, 'info');

  const tab = findSettingsTab(['x' + count]);
  if (!tab) {
    vfLog('  Tab x' + count + ' no encontrado', 'warn');
    return;
  }

  if (tab.getAttribute('aria-selected') === 'true') {
    vfLog('  Resultados ya configurados: x' + count, 'info');
    return;
  }

  await flowClick(tab);

  if (tab.getAttribute('aria-selected') === 'true') {
    vfLog('  Resultados configurados: x' + count, 'success');
  } else {
    vfLog('  No se pudo cambiar resultados', 'warn');
  }
}

/**
 * Configura el modelo de Veo
 * @param {string} modelId - ID del modelo (ej: 'veo-3.1-fast')
 */
async function setModel(modelId) {
  vfLog('  - Modelo: ' + modelId, 'info');

  const targetTexts = MODEL_TEXTS[modelId] || MODEL_TEXTS['veo-3.1-fast'];

  // Buscar botón del dropdown de modelo (tiene aria-haspopup="menu" y contiene "Veo")
  let modelBtn = null;
  const buttons = document.querySelectorAll('button[aria-haspopup="menu"]');
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || '';
    if (text.includes('Veo')) {
      modelBtn = btn;
      break;
    }
  }

  // Fallback: buscar cualquier botón con "Veo" en el área del popup
  if (!modelBtn) {
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      const text = btn.textContent?.toLowerCase() || '';
      const rect = btn.getBoundingClientRect();
      if (rect.height > 0 && text.includes('veo') && text.length < 60) {
        modelBtn = btn;
        break;
      }
    }
  }

  if (!modelBtn) {
    vfLog('  Dropdown de modelo no encontrado', 'warn');
    return;
  }

  // Verificar si ya tiene el modelo correcto
  const currentText = modelBtn.textContent?.toLowerCase() || '';
  for (const target of targetTexts) {
    if (currentText.includes(target.toLowerCase())) {
      vfLog('  Modelo ya configurado: ' + modelId, 'info');
      return;
    }
  }

  // Abrir dropdown del modelo
  await flowClick(modelBtn);
  await sleep(300);

  // Buscar y clickar el menuitem correcto
  let selected = false;
  const menuItems = document.querySelectorAll('[role="menuitem"]');
  for (const item of menuItems) {
    const itemText = item.textContent?.trim() || '';
    for (const target of targetTexts) {
      if (itemText.toLowerCase().includes(target.toLowerCase())) {
        item.click();
        vfLog('  Modelo seleccionado: ' + itemText.substring(0, 30), 'success');
        selected = true;
        break;
      }
    }
    if (selected) break;
  }

  // Fallback: buscar en listbox (viejo Flow)
  if (!selected) {
    selected = await selectOptionInListbox(targetTexts);
  }

  if (selected) {
    vfLog('  Modelo configurado: ' + modelId, 'success');
  } else {
    vfLog('  No se pudo seleccionar modelo', 'warn');
  }

  await sleep(300);
}

console.log('VidFlow: settings.js cargado');
