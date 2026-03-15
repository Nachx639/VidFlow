/**
 * VidFlow - Background Constants & State
 * Service worker keepalive, workflow/pipeline state declarations,
 * and pendingSpeechDownload helpers.
 */

// ========== SERVICE WORKER KEEPALIVE (MV3) ==========
// Chrome MV3 service workers are killed after 30s of inactivity.
// We use chrome.alarms (min 1 min) + periodic storage writes to stay alive.
const KEEPALIVE_ALARM_NAME = 'vidflow-keepalive';

function startKeepalive() {
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: 0.5 }); // 30s (Chrome MV3 minimum)
    console.log('VidFlow BG: Keepalive alarm started');
  }
}

function stopKeepalive() {
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
    console.log('VidFlow BG: Keepalive alarm stopped');
  }
}

// Listen for alarm
if (typeof chrome !== 'undefined' && chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM_NAME) {
      // Touch storage to keep service worker alive
      if (workflowState.isRunning) {
        workflowState.lastKeepalive = Date.now();
        chrome.storage.local.set({ keepalive: Date.now() }).catch(() => {});
        console.log('VidFlow BG: Keepalive tick', new Date().toISOString());
      } else {
        // No workflow running, stop keepalive to save resources
        stopKeepalive();
      }
    }
  });
}

// Workflow state
var workflowState = {
  isRunning: false,
  currentStep: null, // 'flow', 'speech'
  currentIndex: 0,
  totalItems: 0,
  prompts: [],
  references: {},
  batchImages: [], // Array de {name, data} para modo batch
  config: {},
  generatedImages: [],
  generatedVideos: [],
  folderName: 'VidFlow01' // Carpeta de descarga
};

// Pipeline state (para pipeline: Flow + Speech)
var pipelineState = {
  isRunning: false,
  currentStep: null, // 'flow' | 'speech' | 'parallel' | null
  projectFolder: null,

  // Modo de ejecución
  parallelMode: false, // true = Flow + Speech simultáneo

  // Configuración de pasos
  runFlow: true,
  runSpeech: true,

  // Estado de cada paso
  flow: { isComplete: false, currentIndex: 0, totalItems: 0, generatedVideos: [], tabId: null },
  speech: { isComplete: false, currentIndex: 0, totalItems: 0, generatedAudios: [], tabId: null },

  // Datos de escenas
  scenes: [], // [{index, prompt, narration, flowImage}]
  config: {}
};

// Filename pendiente de descarga Speech (para el listener de downloads con data URLs)
var pendingSpeechDownload = {
  filename: null,
  timestamp: null
};

function setPendingSpeechDownload(filename) {
  pendingSpeechDownload.filename = filename;
  pendingSpeechDownload.timestamp = Date.now();
  console.log('VidFlow BG: Pending speech download set:', filename);
}

function clearPendingSpeechDownload() {
  const was = pendingSpeechDownload.filename;
  pendingSpeechDownload.filename = null;
  pendingSpeechDownload.timestamp = null;
  if (was) console.log('VidFlow BG: Pending speech download cleared');
}

function getPendingSpeechDownload() {
  // Solo válido por 30 segundos
  if (pendingSpeechDownload.filename && pendingSpeechDownload.timestamp) {
    if (Date.now() - pendingSpeechDownload.timestamp < 30000) {
      return pendingSpeechDownload.filename;
    }
    clearPendingSpeechDownload();
  }
  return null;
}
