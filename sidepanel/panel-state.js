/**
 * VidFlow - Panel State
 * State object declaration and batch queue state.
 */

// State
var state = {
  // Escenas del video
  scenes: [], // [{id, prompt, narration}]

  // Imágenes de referencia (una por escena, ordenadas por número)
  batchImages: [],

  // Drafts de importación (se guardan para no perderlos)
  importDrafts: {
    prompts: '',
    narrations: '',
    styles: '',
    imagePrompts: ''
  },

  // Configuración
  config: {
    // Pipeline steps
    runFlow: true,
    runSpeech: true,
    parallelMode: false, // Modo paralelo: Flow || Speech simultáneo

    // Flow config
    generationType: 'text-to-video',
    veoModel: 'veo-3.1-fast',
    aspectRatio: '16:9',
    resultsPerRequest: 1,

    // Speech config
    useSameStyle: true,
    speechStyle: 'Read aloud in a warm and friendly tone:',
    defaultStyle: 'Read aloud in a warm and friendly tone:',
    speechVoice: 'Sulafat',
    speechModel: 'gemini-2.5-pro-preview-tts',
    geminiApiKey: '',

    // General
    delay: 60,
    autoDownload: true,
    folderName: '',
    autoNewFolder: true,

    // Batch mode (imágenes de referencia)
    useBatch: false
  },

  isRunning: false,
  currentStep: null // 'flow' | 'speech' | null
};

// Batch queue state
var batchQueue = [];      // Array de {id, name, scenes, config, status}
var currentBatchIndex = -1;

console.log('VidFlow: panel-state.js cargado');
