/**
 * VidFlow - Video Card Detection
 * Functions for finding active, completed, failed, and download-ready video cards in the DOM.
 */

/**
 * Encuentra tarjetas de video activas y sus estados
 * Busca contenedores específicos en lugar de todos los elementos con %
 */
function findActiveVideoCards() {
  const cards = [];
  const seenParents = new WeakSet();

  // MÉTODO 1: TreeWalker para buscar nodos de texto con porcentaje (XX%)
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.textContent?.trim() || '';
        return /^\d{1,3}%$/.test(text)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const el = textNode.parentElement;
    if (!el) continue;

    if (seenParents.has(el)) continue;
    seenParents.add(el);

    let hasChildPercents = false;
    for (const child of el.children) {
      if (/^\d{1,3}%$/.test(child.textContent?.trim() || '')) {
        hasChildPercents = true;
        break;
      }
    }
    if (hasChildPercents) continue;

    const percent = parseInt(textNode.textContent.trim());
    cards.push({
      element: el,
      percent: percent < 100 ? percent : 100,
      status: percent < 100 ? 'generating' : 'completed'
    });
  }

  // MÉTODO 2: Spinners/loading indicators
  if (cards.length === 0) {
    const progressBars = document.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="loading"], [class*="spinner"]');
    for (const bar of progressBars) {
      const ariaValue = bar.getAttribute('aria-valuenow');
      if (ariaValue) {
        const percent = parseInt(ariaValue);
        if (percent >= 0 && percent < 100) {
          cards.push({ element: bar, percent, status: 'generating' });
        }
      }
    }
  }

  // MÉTODO 3: API-based (nuevo Flow — no muestra % en texto)
  // Consultar workflow map cache para detectar workflows sin video (= generando)
  if (cards.length === 0 && _workflowMapCache) {
    for (const [mk, data] of _workflowMapCache) {
      if (!data.hasVideo && data.genStatus !== 'FAILED') {
        cards.push({
          element: null,
          percent: 0,
          status: 'generating',
          mediaKey: mk
        });
      }
    }
  }

  return cards;
}

/**
 * Encuentra tarjetas de video completadas con sus URLs de descarga
 * ESTRATEGIA MEJORADA: Buscar el contenedor padre común para cada video
 * y dentro de ese contenedor buscar el prompt Y botón de descarga
 * Esto evita confundir videos cuando hay múltiples completados simultáneamente
 * Retorna un array de objetos con: { videoUrl, promptText, position }
 * Ordenados por posición (más abajo = enviado primero)
 */
function findCompletedVideoCards() {
  const completedCards = [];
  const seenVideoUrls = new Set();

  const videos = document.querySelectorAll('video');

  for (const video of videos) {
    const videoUrl = video.src || video.currentSrc;
    // Aceptar ambos formatos de URL: viejo (storage) y nuevo (mediaRedirect)
    if (!videoUrl || !isValidVideoUrl(videoUrl)) continue;

    if (seenVideoUrls.has(videoUrl)) continue;
    seenVideoUrls.add(videoUrl);

    const videoRect = video.getBoundingClientRect();
    // No filtrar por height=0: Flow usa lazy loading y videos fuera del viewport tienen height 0

    // === MÉTODO 1: Nuevo Flow — card con data-tile-id + API matching ===
    let card = null;
    let el = video;
    for (let i = 0; i < 12 && el; i++) {
      if (el.getAttribute?.('data-tile-id')) { card = el; break; }
      el = el.parentElement;
    }

    const mediaKey = extractMediaKeyFromVideoSrc(videoUrl);
    let foundPrompt = null;

    // Intentar obtener prompt del workflow map cache (síncrono)
    if (mediaKey && _workflowMapCache) {
      const wfData = _workflowMapCache.get(mediaKey);
      if (wfData) foundPrompt = wfData.prompt;
    }

    // === MÉTODO 2: Fallback DOM — buscar prompt en botones (diseño anterior) ===
    if (!foundPrompt) {
      let cardContainer = video.parentElement;
      let maxLevels = 15;
      let bestPromptDist = Infinity;

      while (cardContainer && maxLevels > 0) {
        const buttons = cardContainer.querySelectorAll('button');
        for (const btn of buttons) {
          const btnText = btn.textContent?.trim() || '';
          if (!btnText || btnText.length < 10) continue;

          const nextSibling = btn.nextElementSibling;
          const nextText = nextSibling?.textContent?.trim() || '';
          if (!nextText.toLowerCase().includes('veo 3')) continue;
          if (nextText.toLowerCase().includes('no se ha podido')) continue;

          const lowerText = btnText.toLowerCase();
          if (lowerText.includes('descargar') || lowerText.includes('download') ||
              lowerText.includes('añadir') || lowerText.includes('editar') ||
              lowerText.includes('crear') || lowerText.includes('reutilizar') ||
              lowerText.includes('favorita') || lowerText.includes('copiar') ||
              btnText.includes('_') || btnText.includes('more_vert')) {
            continue;
          }

          const btnRect = btn.getBoundingClientRect();
          const dist = Math.hypot(btnRect.left - videoRect.left, btnRect.top - videoRect.top);
          if (dist < bestPromptDist) {
            bestPromptDist = dist;
            foundPrompt = btnText;
          }
        }
        if (foundPrompt) break;
        cardContainer = cardContainer.parentElement;
        maxLevels--;
      }
    }

    // Sin prompt: usar mediaKey como identificador si disponible
    if (!foundPrompt && mediaKey) {
      foundPrompt = '__mediaKey__' + mediaKey;
    }
    if (!foundPrompt) continue;

    // Buscar botón de descarga (overlay viejo o ⋮ nuevo)
    let foundDownloadBtn = null;
    const searchArea = card || video.parentElement;
    if (searchArea) {
      // Viejo: botón "Descargar" type="button"
      const downloadBtns = searchArea.querySelectorAll('button[type="button"]');
      let bestDist = Infinity;
      for (const btn of downloadBtns) {
        const btnText = btn.textContent?.toLowerCase() || '';
        if ((btnText.includes('descargar') || btnText.includes('download')) &&
            !btn.disabled && btn.offsetParent !== null) {
          const dist = Math.abs(btn.getBoundingClientRect().top - videoRect.top);
          if (dist < bestDist) { bestDist = dist; foundDownloadBtn = btn; }
        }
      }
    }

    completedCards.push({
      button: foundDownloadBtn, // Puede ser null en nuevo diseño
      videoUrl: videoUrl,
      videoElement: video,
      mediaKey: mediaKey,
      card: card, // Card container para descarga via ⋮
      promptText: foundPrompt,
      position: videoRect.top,
      positionLeft: videoRect.left
    });
  }

  // Ordenar: MAYOR top = más abajo = enviado PRIMERO
  completedCards.sort((a, b) => {
    const rowDiff = b.position - a.position;
    if (Math.abs(rowDiff) > 50) return rowDiff;
    return b.positionLeft - a.positionLeft;
  });

  return completedCards;
}

/**
 * Encuentra solo los botones de descarga (legacy, para compatibilidad)
 */
function findDownloadButtons() {
  const cards = findCompletedVideoCards();
  return cards.map(c => c.button).filter(Boolean);
}

/**
 * Encuentra tarjetas de videos FALLIDOS
 * Busca videos con "No se ha podido generar" y su botón de "Reutilizar petición"
 * @returns {Array} - [{promptText, retryButton, container, position}]
 */
function findFailedVideoCards() {
  const failedCards = [];
  const seenTileIds = new Set();

  // Patrones de error (español e inglés)
  const errorPatterns = [
    'No se ha podido', "can't generate", 'Error', 'error generating',
    'unable to generate', 'failed to generate', 'no se pudo'
  ];

  function hasErrorText(text) {
    const lower = text.toLowerCase();
    return errorPatterns.some(p => lower.includes(p.toLowerCase()));
  }

  // MÉTODO 1: Buscar en cards con data-tile-id (nuevo Flow)
  const tileCards = document.querySelectorAll('[data-tile-id]');
  for (const card of tileCards) {
    const tileId = card.getAttribute('data-tile-id');
    if (seenTileIds.has(tileId)) continue;

    const cardText = card.innerText || '';
    if (!hasErrorText(cardText)) continue;

    // Evitar duplicados (cada tile se repite 2x en el DOM)
    seenTileIds.add(tileId);

    // Extraer prompt: 1) mediaKey → API cache, 2) workflow API por exclusión, 3) botón con texto largo
    let promptText = null;

    // 1. Via mediaKey del video (si existe)
    const video = card.querySelector('video[src]');
    if (video && _workflowMapCache) {
      const mk = extractMediaKeyFromVideoSrc(video.src);
      if (mk) {
        const wfData = _workflowMapCache.get(mk);
        if (wfData) promptText = wfData.prompt;
      }
    }

    // 2. Via API cache: buscar workflows con status FAILED
    if (!promptText && _workflowMapCache) {
      for (const [mk, data] of _workflowMapCache) {
        const status = (data.genStatus || '').toUpperCase();
        if ((status.includes('FAIL') || status.includes('ERROR') || status.includes('BLOCKED')) && data.prompt) {
          promptText = data.prompt;
          break;
        }
      }
    }

    // 3. Fallback: buscar botón con texto largo dentro del card
    if (!promptText) {
      for (const btn of card.querySelectorAll('button')) {
        const t = btn.textContent?.trim() || '';
        if (t.length > 15 && !t.includes('more_vert') && !t.includes('Reutilizar') &&
            !t.includes('Reintentar') && !t.includes('Eliminar') && !t.includes('refresh') &&
            !t.includes('undo') && !t.includes('delete')) {
          promptText = t;
          break;
        }
      }
    }

    // 4. Último recurso: usar tileId como identificador
    if (!promptText) {
      promptText = '__tileId__' + tileId;
    }

    // Buscar botón "Reintentar" (más simple, no necesita re-ingresar prompt)
    let retryButton = null;
    let reuseButton = null;
    for (const btn of card.querySelectorAll('button')) {
      const t = btn.textContent?.toLowerCase() || '';
      if (t.includes('reintentar') || t.includes('refresh')) { retryButton = btn; }
      if (t.includes('reutilizar') || t.includes('undo')) { reuseButton = btn; }
    }

    const rect = card.getBoundingClientRect();
    failedCards.push({
      promptText,
      promptButton: card,
      retryButton: retryButton || reuseButton, // Preferir "Reintentar" sobre "Reutilizar"
      reuseButton: reuseButton,
      container: card,
      position: rect.top
    });
  }

  // MÉTODO 2: Fallback DOM — botón + texto de error sibling (diseño anterior)
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const btnText = btn.textContent?.trim() || '';
    if (!btnText || btnText.length < 10) continue;

    const nextSibling = btn.nextElementSibling;
    const nextText = nextSibling?.textContent?.trim() || '';
    if (!hasErrorText(nextText)) continue;

    const parent = btn.parentElement;
    if (!parent) continue;

    // Evitar duplicados con MÉTODO 1
    const parentTile = parent.closest('[data-tile-id]');
    if (parentTile && seenTileIds.has(parentTile.getAttribute('data-tile-id'))) continue;

    let retryButton = null;
    for (const sibBtn of parent.querySelectorAll('button')) {
      const sibText = sibBtn.textContent?.toLowerCase() || '';
      if (sibText.includes('reutilizar') || sibText.includes('reintentar')) {
        retryButton = sibBtn;
        break;
      }
    }

    failedCards.push({
      promptText: btnText, promptButton: btn, retryButton,
      container: parent, position: btn.getBoundingClientRect().top
    });
  }

  failedCards.sort((a, b) => a.position - b.position);
  return failedCards;
}

/**
 * Reintenta un video fallido haciendo clic en "Reutilizar petición"
 * @param {Object} failedCard - Objeto de findFailedVideoCards()
 * @returns {Promise<boolean>} - true si se reenvió correctamente
 */
async function retryFailedVideo(failedCard) {
  const promptText = failedCard.promptText;
  const shortPrompt = promptText.startsWith('__') ? '(ID interno)' : promptText.substring(0, 30) + '...';
  vfLog(`[RETRY] Reintentando video fallido: "${shortPrompt}"`, 'warn');

  // MÉTODO 1: Botón "Reintentar" (refresh) — reenvía automáticamente sin editar
  const retryBtn = failedCard.retryButton;
  if (retryBtn) {
    const btnText = retryBtn.textContent?.toLowerCase() || '';
    if (btnText.includes('reintentar') || btnText.includes('refresh')) {
      vfLog('[RETRY] Usando botón "Reintentar" (reenvío directo)', 'info');
      await flowClick(retryBtn);
      await sleep(1500);
      vfLog('[RETRY] Video reenviado a la cola', 'success');
      return true;
    }
  }

  // MÉTODO 2: Botón "Reutilizar petición" (undo) — carga prompt en editor
  const reuseBtn = failedCard.reuseButton || retryBtn;
  if (reuseBtn) {
    vfLog('[RETRY] Usando botón "Reutilizar petición"', 'info');
    await flowClick(reuseBtn);
    await sleep(800);

    const promptEl = findPromptInput();
    if (!promptEl) {
      vfLog('[RETRY] ERROR: No se encontró prompt input', 'error');
      return false;
    }

    const loadedText = getPromptText(promptEl);
    if (!loadedText) {
      vfLog('[RETRY] ERROR: El prompt no se cargó en el campo de texto', 'error');
      return false;
    }

    vfLog(`[RETRY] Prompt cargado: "${loadedText.substring(0, 40)}..."`, 'info');

    const createBtn = findSubmitButton();
    if (!createBtn) {
      vfLog('[RETRY] ERROR: No se encontró botón "Crear"', 'error');
      return false;
    }

    createBtn.click();
    await sleep(1000);
    vfLog('[RETRY] Video reenviado a la cola', 'success');
    return true;
  }

  // MÉTODO 3: Sin botones de retry — re-enviar prompt manualmente
  if (!promptText.startsWith('__')) {
    vfLog('[RETRY] Sin botones de retry, reenviando prompt manualmente...', 'warn');
    const promptEl = findPromptInput();
    if (!promptEl) return false;
    await setPromptText(promptEl, '');
    await sleep(100);
    await setPromptText(promptEl, promptText);
    await sleep(300);
    const submitBtn = findSubmitButton();
    if (submitBtn) {
      submitBtn.click();
      await sleep(1000);
      vfLog('[RETRY] Video reenviado a la cola', 'success');
      return true;
    }
  }

  vfLog('[RETRY] ERROR: No se pudo reintentar', 'error');
  return false;
}

console.log('VidFlow: detect.js cargado');
