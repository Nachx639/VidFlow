/**
 * VidFlow - Download Management
 * downloadCounter, Maps (downloadSceneMap, pendingPromptSceneMap, pendingVideoUrlMap,
 * preparedDownloadMap), registerVidFlowDownload, isVidFlowDownload,
 * vidflowDownloadHandler, registerDownloadListener, unregisterDownloadListener,
 * chrome.downloads.onChanged listener, chrome.action.onClicked listener.
 */

// ========== DOWNLOAD MANAGEMENT ==========

// Contador de descargas para numeración (fallback)
var downloadCounter = 0;

// Map de downloadId → sceneNumber para correlacionar descargas con videos específicos
// Eliminates FIFO race condition: each download ID maps directly to its scene number
var downloadSceneMap = new Map();

// Map de prompt → sceneNumber for browser-initiated downloads (click-to-download)
// When prepareFlowDownload is called before the download starts, we store the mapping here.
// Once a downloadId is known, the entry moves to downloadSceneMap.
var pendingPromptSceneMap = new Map();

// Map de videoUrl fragment → sceneNumber for URL-based matching in onDeterminingFilename
// More reliable than FIFO prompt matching — the download URL shares the video ID with the playback URL
var pendingVideoUrlMap = new Map();

// Map de videoUrl → { sceneNumber, matchedIndex, prompt } from prepareFlowDownload
// Used by handleFlowVideoDownloaded to reuse the SAME match instead of re-matching by prompt
var preparedDownloadMap = new Map();

// Set de IDs de descarga que VidFlow ha iniciado (para no interferir con otras extensiones)
// Capped at 200 entries to prevent unbounded growth in long sessions
var vidflowDownloadIds = new Set();
const MAX_TRACKED_DOWNLOADS = 200;

/**
 * Registra una descarga como iniciada por VidFlow, optionally with a sceneNumber
 */
function registerVidFlowDownload(downloadId, sceneNumber) {
  // Cap the set size to prevent memory leaks in long-running sessions
  if (vidflowDownloadIds.size >= MAX_TRACKED_DOWNLOADS) {
    const oldest = vidflowDownloadIds.values().next().value;
    vidflowDownloadIds.delete(oldest);
    downloadSceneMap.delete(oldest);
  }
  vidflowDownloadIds.add(downloadId);
  if (sceneNumber != null) {
    downloadSceneMap.set(downloadId, sceneNumber);
    console.log(`VidFlow BG: Registered downloadId=${downloadId} → sceneNumber=${sceneNumber}`);
  }
  // Limpiar después de 5 minutos para evitar memory leaks
  setTimeout(() => {
    vidflowDownloadIds.delete(downloadId);
    downloadSceneMap.delete(downloadId);
  }, 300000);
}

/**
 * Verifica si una descarga fue iniciada por VidFlow
 */
function isVidFlowDownload(downloadId) {
  return vidflowDownloadIds.has(downloadId);
}

// Variable para trackear si el listener está registrado
var downloadListenerRegistered = false;

/**
 * Handler para onDeterminingFilename - renombrar/mover descargas de VidFlow
 */
function vidflowDownloadHandler(downloadItem, suggest) {
  const url = downloadItem.url || '';
  const filename = downloadItem.filename || '';
  const referrer = downloadItem.referrer || '';
  const mime = downloadItem.mime || '';
  const downloadId = downloadItem.id;

  // Verificar si es una descarga que VidFlow inició explícitamente
  const isRegisteredDownload = isVidFlowDownload(downloadId);
  const hasPendingDownload = getPendingSpeechDownload();

  // Solo interceptar si:
  // 1. Es una descarga registrada por VidFlow (por ID explícito), O
  // 2. Hay un pending speech download Y es un data URL de audio
  const isDataUrl = url.startsWith('data:');
  const isAudioMime = mime.includes('audio') || filename.endsWith('.wav') || filename.endsWith('.mp3');
  const isPendingSpeech = hasPendingDownload && isDataUrl && isAudioMime;

  const shouldIntercept = isRegisteredDownload || isPendingSpeech;

  if (!shouldIntercept) {
    // NO tocar esta descarga — dejar que Chrome la maneje normalmente
    return;
  }

  console.log('VidFlow BG: onDeterminingFilename -', {
    downloadId,
    url: url.substring(0, 100),
    filename,
    mime,
    isRegisteredDownload,
    isPendingSpeech
  });

  // ========== VIDEO (data URL) — filename pendiente de handleDownloadFlowVideo ==========
  if (isRegisteredDownload && pendingVideoDownload.filename) {
    const videoFilename = pendingVideoDownload.filename;
    pendingVideoDownload.filename = null;
    pendingVideoDownload.downloadId = null;
    console.log(`VidFlow BG: Aplicando filename de video: ${videoFilename}`);
    suggest({ filename: videoFilename, conflictAction: 'uniquify' });
    return true;
  }

  // ========== SPEECH AUDIO (data URL) ==========
  if (isPendingSpeech) {
    const pendingFilename = getPendingSpeechDownload();
    console.log('VidFlow BG: Data URL audio detectado, pendingFilename:', pendingFilename);

    if (pendingFilename) {
      console.log('VidFlow BG: Renombrando audio Speech a:', pendingFilename);
      clearPendingSpeechDownload();
      suggest({
        filename: pendingFilename,
        conflictAction: 'uniquify'
      });
      return true;
    }
  }

  // ========== FLOW VIDEO ==========
  const isFromFlow = url.includes('labs.google') ||
                     url.includes('googleusercontent') ||
                     url.includes('storage.googleapis') ||
                     url.includes('video-downloads') ||
                     referrer.includes('labs.google');

  const isVideo = filename.endsWith('.mp4') ||
                  filename.endsWith('.webm') ||
                  mime.includes('video');

  if (isFromFlow && isVideo) {
    // Si el filename ya tiene la ruta VidFlow/ correcta (set by handleDownloadFlowVideo), aceptarlo
    if (filename.startsWith('VidFlow/') && filename.endsWith('_flow_video.mp4')) {
      console.log(`VidFlow BG: Filename ya correcto, aceptando: ${filename}`);
      downloadSceneMap.delete(downloadId);
      suggest({ filename, conflictAction: 'uniquify' });
      return true;
    }

    // Look up sceneNumber by downloadId (set by registerVidFlowDownload or handleDownloadVideoUrl)
    let sceneNumber;

    if (downloadSceneMap.has(downloadId)) {
      // Direct lookup by download ID — race-condition-free
      sceneNumber = downloadSceneMap.get(downloadId);
      downloadSceneMap.delete(downloadId);
      console.log(`VidFlow BG: sceneNumber=${sceneNumber} from downloadSceneMap (by downloadId=${downloadId})`);
    } else if (pendingVideoUrlMap.size > 0) {
      // URL-based matching: extract video ID or path from download URL and look it up
      // This is the most reliable method — doesn't depend on FIFO order

      // Method 1: Extract video ID from /video/XXX pattern
      const downloadUrlMatch = url.match(/\/video\/([^/?]+)/);
      if (downloadUrlMatch) {
        const downloadVideoId = downloadUrlMatch[1];
        if (pendingVideoUrlMap.has(downloadVideoId)) {
          sceneNumber = pendingVideoUrlMap.get(downloadVideoId);
          pendingVideoUrlMap.delete(downloadVideoId);
          // Clean up ALL entries with the same sceneNumber (videoId + urlPath duplicates)
          for (const [key, val] of pendingVideoUrlMap) {
            if (val === sceneNumber) { pendingVideoUrlMap.delete(key); break; }
          }
          for (const [key, val] of pendingPromptSceneMap) {
            if (val === sceneNumber) { pendingPromptSceneMap.delete(key); break; }
          }
          console.log(`VidFlow BG: sceneNumber=${sceneNumber} from URL match (videoId=${downloadVideoId.substring(0, 12)}...)`);
        }
      }

      // Method 2: Match by URL path (for storage.googleapis.com URLs without /video/)
      if (sceneNumber == null) {
        try {
          const downloadPath = new URL(url).pathname;
          if (pendingVideoUrlMap.has(downloadPath)) {
            sceneNumber = pendingVideoUrlMap.get(downloadPath);
            pendingVideoUrlMap.delete(downloadPath);
            // Clean up ALL entries with the same sceneNumber
            for (const [key, val] of pendingVideoUrlMap) {
              if (val === sceneNumber) { pendingVideoUrlMap.delete(key); break; }
            }
            for (const [key, val] of pendingPromptSceneMap) {
              if (val === sceneNumber) { pendingPromptSceneMap.delete(key); break; }
            }
            console.log(`VidFlow BG: sceneNumber=${sceneNumber} from URL path match (${downloadPath.substring(0, 40)}...)`);
          }
        } catch (e) { /* invalid URL, skip */ }
      }

      // If URL match failed, fall back to prompt FIFO
      if (sceneNumber == null && pendingPromptSceneMap.size > 0) {
        const firstKey = pendingPromptSceneMap.keys().next().value;
        sceneNumber = pendingPromptSceneMap.get(firstKey);
        pendingPromptSceneMap.delete(firstKey);
        console.log(`VidFlow BG: sceneNumber=${sceneNumber} from pendingPromptSceneMap FIFO (prompt key: "${firstKey?.substring(0, 40)}...")`);
      }
    } else if (pendingPromptSceneMap.size > 0) {
      // No video URL mappings, use prompt FIFO as last resort
      const firstKey = pendingPromptSceneMap.keys().next().value;
      sceneNumber = pendingPromptSceneMap.get(firstKey);
      pendingPromptSceneMap.delete(firstKey);
      console.log(`VidFlow BG: sceneNumber=${sceneNumber} from pendingPromptSceneMap FIFO (prompt key: "${firstKey?.substring(0, 40)}...")`);
    } else {
      // Fallback: contador incremental (compatibilidad con código antiguo)
      downloadCounter++;
      sceneNumber = downloadCounter;
      console.log(`VidFlow BG: WARN: No mapping found, usando contador incremental: ${sceneNumber}`);
    }

    const paddedNumber = String(sceneNumber).padStart(3, '0');

    // Usar la carpeta configurada o la por defecto
    const folderName = workflowState.folderName || 'VidFlow01';

    // Crear nombre de archivo con formato: VidFlow/VidFlow01/001_flow_video.mp4
    const newFilename = `VidFlow/${folderName}/${paddedNumber}_flow_video.mp4`;

    console.log(`VidFlow: Renombrando descarga a ${newFilename} (escena #${sceneNumber})`);

    suggest({
      filename: newFilename,
      conflictAction: 'uniquify' // Si existe, añade (1), (2), etc.
    });

    return true; // Indica que usamos suggest()
  }

  // Para otros archivos registrados por VidFlow (GIFs, imágenes de Flow)
  if (isRegisteredDownload && isFromFlow) {
    const folderName = workflowState.folderName || pipelineState.projectFolder || 'VidFlow01';
    const newFilename = `VidFlow/${folderName}/${filename}`;
    console.log(`VidFlow: Moviendo a carpeta: ${newFilename}`);
    suggest({
      filename: newFilename,
      conflictAction: 'uniquify'
    });
    return true;
  }

  // Si llegamos aquí, no hacer nada con esta descarga
  return false;
}

/**
 * Registra el listener de descargas de VidFlow
 * Solo debe llamarse cuando el pipeline está activo
 */
function registerDownloadListener() {
  // El listener ahora es permanente y seguro — solo actúa sobre IDs registrados
  if (!downloadListenerRegistered) {
    chrome.downloads.onDeterminingFilename.addListener(vidflowDownloadHandler);
    downloadListenerRegistered = true;
    console.log('VidFlow BG: Download listener REGISTRADO (permanente, solo IDs registrados)');
  }
}

/**
 * No-op: el listener ahora es permanente y seguro.
 * Solo actúa sobre descargas con ID explícitamente registrado en vidflowDownloadIds.
 */
function unregisterDownloadListener() {
  // No desregistrar — el listener es seguro y solo toca descargas de VidFlow
}

// Listener para cuando una descarga se completa o falla
// Solo actúa si VidFlow está activo, para no interferir con otras extensiones
chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;

  const state = delta.state.current;

  // Solo procesar si VidFlow tiene un workflow/pipeline activo O es una descarga nuestra
  const isActive = workflowState.isRunning || pipelineState.isRunning;
  const isOurs = isVidFlowDownload(delta.id);

  if (!isActive && !isOurs) return;

  // Limpiar pending download si hay uno (por seguridad)
  if (state === 'complete' || state === 'interrupted') {
    if (getPendingSpeechDownload()) {
      console.log('VidFlow: Limpiando pending download tras estado:', state);
      clearPendingSpeechDownload();
    }
  }

  if (state === 'complete' && isOurs) {
    chrome.downloads.search({ id: delta.id }, (downloads) => {
      if (downloads && downloads[0]) {
        const download = downloads[0];
        if (download.filename.includes('VidFlow')) {
          console.log('VidFlow: Descarga completada:', download.filename);
        }
      }
    });
  }
});

// Al hacer clic en el icono, abrir el side panel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Registrar listener de descargas al cargar (es seguro, solo toca IDs registrados)
registerDownloadListener();

console.log('████████████████████████████████████████');
console.log('██ VidFlow v2 — SAFE download handler ██');
console.log('████████████████████████████████████████');
