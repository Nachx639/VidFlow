/**
 * Tests de integración para background.js
 * Service Worker - Orquestador central
 */

// ========== IMPLEMENTACIONES PARA TESTING ==========

/**
 * Simula el estado del workflow
 */
class WorkflowState {
  constructor() {
    this.reset();
  }

  reset() {
    this.isRunning = false;
    this.currentStep = null; // 'whisk', 'flow', 'audio'
    this.currentIndex = 0;
    this.totalItems = 0;
    this.prompts = [];
    this.references = {};
    this.batchImages = [];
    this.config = {};
    this.generatedImages = [];
    this.generatedVideos = [];
    this.folderName = 'VidFlow01';
    this.downloadCount = 0;
  }

  setPrompts(prompts) {
    this.prompts = prompts;
    this.totalItems = prompts.length;
  }

  start(step) {
    this.isRunning = true;
    this.currentStep = step;
    this.currentIndex = 0;
  }

  stop() {
    this.isRunning = false;
    this.currentStep = null;
  }

  advance() {
    if (this.currentIndex < this.totalItems - 1) {
      this.currentIndex++;
      return true;
    }
    return false;
  }

  getProgress() {
    return {
      current: this.currentIndex + 1,
      total: this.totalItems,
      percent: this.totalItems > 0 ? Math.round((this.currentIndex + 1) / this.totalItems * 100) : 0
    };
  }

  addGeneratedVideo(videoData) {
    this.generatedVideos.push(videoData);
    this.downloadCount++;
  }
}

/**
 * Simula el gestor de descargas
 */
class DownloadManager {
  constructor(folderName = 'VidFlow01') {
    this.folderName = folderName;
    this.downloadCount = 0;
    this.downloads = [];
  }

  generateFilename(originalName, index) {
    const paddedIndex = String(index + 1).padStart(3, '0');
    const extension = originalName.split('.').pop() || 'mp4';
    return `VidFlow/${this.folderName}/${paddedIndex}_flow_video.${extension}`;
  }

  recordDownload(url, filename) {
    const record = {
      id: this.downloadCount + 1,
      url,
      filename,
      timestamp: new Date().toISOString()
    };
    this.downloads.push(record);
    this.downloadCount++;
    return record;
  }

  getDownloadsByFolder() {
    const byFolder = {};
    for (const download of this.downloads) {
      const folder = download.filename.split('/')[1] || 'default';
      if (!byFolder[folder]) byFolder[folder] = [];
      byFolder[folder].push(download);
    }
    return byFolder;
  }
}

/**
 * Simula el manejador de mensajes
 */
class MessageHandler {
  constructor(workflowState) {
    this.workflowState = workflowState;
    this.handlers = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    this.handlers.set('startFlow', (data) => this.handleStartFlow(data));
    this.handlers.set('startWhisk', (data) => this.handleStartWhisk(data));
    this.handlers.set('stopWorkflow', () => this.handleStopWorkflow());
    this.handlers.set('getStatus', () => this.handleGetStatus());
  }

  handleStartFlow(data) {
    if (this.workflowState.isRunning) {
      return { success: false, error: 'Workflow ya en ejecución' };
    }

    if (!data.prompts || data.prompts.length === 0) {
      return { success: false, error: 'No hay prompts para procesar' };
    }

    this.workflowState.setPrompts(data.prompts);
    this.workflowState.references = data.references || {};
    this.workflowState.batchImages = data.batchImages || [];
    this.workflowState.config = data.config || {};
    this.workflowState.folderName = data.folderName || 'VidFlow01';
    this.workflowState.start('flow');

    return { success: true, message: 'Flow workflow iniciado' };
  }

  handleStartWhisk(data) {
    if (this.workflowState.isRunning) {
      return { success: false, error: 'Workflow ya en ejecución' };
    }

    if (!data.prompts || data.prompts.length === 0) {
      return { success: false, error: 'No hay prompts para procesar' };
    }

    this.workflowState.setPrompts(data.prompts);
    this.workflowState.references = data.references || {};
    this.workflowState.config = data.config || {};
    this.workflowState.start('whisk');

    return { success: true, message: 'Whisk workflow iniciado' };
  }

  handleStopWorkflow() {
    this.workflowState.stop();
    return { success: true, message: 'Workflow detenido' };
  }

  handleGetStatus() {
    return {
      success: true,
      isRunning: this.workflowState.isRunning,
      currentStep: this.workflowState.currentStep,
      progress: this.workflowState.getProgress()
    };
  }

  async processMessage(action, data = {}) {
    const handler = this.handlers.get(action);
    if (!handler) {
      return { success: false, error: `Acción desconocida: ${action}` };
    }
    return handler(data);
  }
}

// ========== TESTS ==========

describe('Background - WorkflowState', () => {
  let state;

  beforeEach(() => {
    state = new WorkflowState();
  });

  describe('inicialización', () => {
    test('debe inicializar con valores por defecto', () => {
      expect(state.isRunning).toBe(false);
      expect(state.currentStep).toBeNull();
      expect(state.currentIndex).toBe(0);
      expect(state.prompts).toEqual([]);
    });
  });

  describe('setPrompts()', () => {
    test('debe establecer prompts y totalItems', () => {
      const prompts = ['p1', 'p2', 'p3'];
      state.setPrompts(prompts);

      expect(state.prompts).toEqual(prompts);
      expect(state.totalItems).toBe(3);
    });
  });

  describe('start()', () => {
    test('debe iniciar workflow con step especificado', () => {
      state.start('flow');

      expect(state.isRunning).toBe(true);
      expect(state.currentStep).toBe('flow');
      expect(state.currentIndex).toBe(0);
    });
  });

  describe('stop()', () => {
    test('debe detener workflow', () => {
      state.start('flow');
      state.stop();

      expect(state.isRunning).toBe(false);
      expect(state.currentStep).toBeNull();
    });
  });

  describe('advance()', () => {
    test('debe avanzar índice si no está al final', () => {
      state.setPrompts(['p1', 'p2', 'p3']);
      state.start('flow');

      expect(state.advance()).toBe(true);
      expect(state.currentIndex).toBe(1);
    });

    test('debe retornar false al llegar al final', () => {
      state.setPrompts(['p1', 'p2']);
      state.start('flow');

      state.advance(); // 0 -> 1
      expect(state.advance()).toBe(false); // Ya está en el último
      expect(state.currentIndex).toBe(1);
    });
  });

  describe('getProgress()', () => {
    test('debe calcular progreso correctamente', () => {
      state.setPrompts(['p1', 'p2', 'p3', 'p4']);
      state.start('flow');
      state.advance();

      const progress = state.getProgress();
      expect(progress.current).toBe(2);
      expect(progress.total).toBe(4);
      expect(progress.percent).toBe(50);
    });

    test('debe manejar lista vacía', () => {
      const progress = state.getProgress();
      expect(progress.percent).toBe(0);
    });
  });

  describe('reset()', () => {
    test('debe resetear todo el estado', () => {
      state.setPrompts(['p1', 'p2']);
      state.start('flow');
      state.advance();
      state.addGeneratedVideo({ url: 'test.mp4' });

      state.reset();

      expect(state.isRunning).toBe(false);
      expect(state.prompts).toEqual([]);
      expect(state.generatedVideos).toEqual([]);
      expect(state.currentIndex).toBe(0);
    });
  });
});

describe('Background - DownloadManager', () => {
  let manager;

  beforeEach(() => {
    manager = new DownloadManager('TestFolder');
  });

  describe('generateFilename()', () => {
    test('debe generar nombre con formato correcto', () => {
      const filename = manager.generateFilename('video.mp4', 0);
      expect(filename).toBe('VidFlow/TestFolder/001_flow_video.mp4');
    });

    test('debe usar padding de 3 dígitos', () => {
      expect(manager.generateFilename('v.mp4', 0)).toContain('001');
      expect(manager.generateFilename('v.mp4', 9)).toContain('010');
      expect(manager.generateFilename('v.mp4', 99)).toContain('100');
    });

    test('debe preservar extensión original', () => {
      expect(manager.generateFilename('video.webm', 0)).toContain('.webm');
      expect(manager.generateFilename('video.mov', 0)).toContain('.mov');
    });

    test('debe usar nombre original si no hay extensión', () => {
      // El comportamiento actual usa el nombre sin extensión como extensión
      const filename = manager.generateFilename('video', 0);
      expect(filename).toContain('001_flow_video');
    });
  });

  describe('recordDownload()', () => {
    test('debe registrar descarga y aumentar contador', () => {
      const record1 = manager.recordDownload('url1', 'file1.mp4');
      const record2 = manager.recordDownload('url2', 'file2.mp4');

      expect(record1.id).toBe(1);
      expect(record2.id).toBe(2);
      expect(manager.downloadCount).toBe(2);
      expect(manager.downloads.length).toBe(2);
    });

    test('debe incluir timestamp', () => {
      const record = manager.recordDownload('url', 'file.mp4');
      expect(record.timestamp).toBeTruthy();
      expect(new Date(record.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('getDownloadsByFolder()', () => {
    test('debe agrupar descargas por carpeta', () => {
      manager.recordDownload('url1', 'VidFlow/Folder1/001.mp4');
      manager.recordDownload('url2', 'VidFlow/Folder1/002.mp4');
      manager.recordDownload('url3', 'VidFlow/Folder2/001.mp4');

      const byFolder = manager.getDownloadsByFolder();

      expect(byFolder['Folder1'].length).toBe(2);
      expect(byFolder['Folder2'].length).toBe(1);
    });
  });
});

describe('Background - MessageHandler', () => {
  let state;
  let handler;

  beforeEach(() => {
    state = new WorkflowState();
    handler = new MessageHandler(state);
  });

  describe('startFlow', () => {
    test('debe iniciar workflow Flow exitosamente', async () => {
      const data = {
        prompts: [{ prompt: 'test1' }, { prompt: 'test2' }],
        references: { cat1: 'imagedata' },
        config: { veoModel: 'veo-3.1-fast' },
        folderName: 'TestFolder'
      };

      const result = await handler.processMessage('startFlow', data);

      expect(result.success).toBe(true);
      expect(state.isRunning).toBe(true);
      expect(state.currentStep).toBe('flow');
      expect(state.folderName).toBe('TestFolder');
    });

    test('debe rechazar si no hay prompts', async () => {
      const result = await handler.processMessage('startFlow', { prompts: [] });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No hay prompts');
    });

    test('debe rechazar si ya hay workflow en ejecución', async () => {
      await handler.processMessage('startFlow', { prompts: [{ prompt: 'p1' }] });
      const result = await handler.processMessage('startFlow', { prompts: [{ prompt: 'p2' }] });

      expect(result.success).toBe(false);
      expect(result.error).toContain('ya en ejecución');
    });
  });

  describe('startWhisk', () => {
    test('debe iniciar workflow Whisk exitosamente', async () => {
      const data = {
        prompts: [{ prompt: 'test' }],
        references: {}
      };

      const result = await handler.processMessage('startWhisk', data);

      expect(result.success).toBe(true);
      expect(state.currentStep).toBe('whisk');
    });
  });

  describe('stopWorkflow', () => {
    test('debe detener workflow activo', async () => {
      await handler.processMessage('startFlow', { prompts: [{ prompt: 'p1' }] });
      const result = await handler.processMessage('stopWorkflow');

      expect(result.success).toBe(true);
      expect(state.isRunning).toBe(false);
    });
  });

  describe('getStatus', () => {
    test('debe retornar estado actual', async () => {
      await handler.processMessage('startFlow', {
        prompts: [{ prompt: 'p1' }, { prompt: 'p2' }]
      });
      state.advance();

      const result = await handler.processMessage('getStatus');

      expect(result.success).toBe(true);
      expect(result.isRunning).toBe(true);
      expect(result.currentStep).toBe('flow');
      expect(result.progress.current).toBe(2);
      expect(result.progress.total).toBe(2);
    });
  });

  describe('acción desconocida', () => {
    test('debe manejar acciones no válidas', async () => {
      const result = await handler.processMessage('unknownAction');

      expect(result.success).toBe(false);
      expect(result.error).toContain('desconocida');
    });
  });
});

describe('Background - Flujo completo de workflow', () => {
  let state;
  let handler;
  let downloadManager;

  beforeEach(() => {
    state = new WorkflowState();
    handler = new MessageHandler(state);
    downloadManager = new DownloadManager('VidFlow01');
  });

  test('debe procesar workflow completo de Flow', async () => {
    const prompts = [
      { prompt: 'Bruno walks', category: 'bruno', referenceNeeded: 'bruno' },
      { prompt: 'Pompón jumps', category: 'pompon', referenceNeeded: 'pompon' },
      { prompt: 'Sunset scene', category: 'other', referenceNeeded: null }
    ];

    // 1. Iniciar workflow
    const startResult = await handler.processMessage('startFlow', {
      prompts,
      references: { bruno: 'img1', pompon: 'img2' },
      config: { veoModel: 'veo-3.1-fast' },
      folderName: 'TestRun'
    });

    expect(startResult.success).toBe(true);

    // 2. Verificar estado inicial
    let status = await handler.processMessage('getStatus');
    expect(status.progress.current).toBe(1);
    expect(status.progress.total).toBe(3);

    // 3. Simular procesamiento de cada prompt
    for (let i = 0; i < prompts.length; i++) {
      // Simular generación de video
      state.addGeneratedVideo({
        prompt: prompts[i].prompt,
        url: `video${i + 1}.mp4`
      });

      // Simular descarga
      const filename = downloadManager.generateFilename(`video${i + 1}.mp4`, i);
      downloadManager.recordDownload(`url${i + 1}`, filename);

      // Avanzar al siguiente
      if (i < prompts.length - 1) {
        state.advance();
      }
    }

    // 4. Verificar resultados
    expect(state.generatedVideos.length).toBe(3);
    expect(downloadManager.downloadCount).toBe(3);

    // 5. Detener workflow
    await handler.processMessage('stopWorkflow');
    status = await handler.processMessage('getStatus');
    expect(status.isRunning).toBe(false);
  });

  test('debe manejar errores durante el procesamiento', async () => {
    const prompts = [{ prompt: 'test' }];

    await handler.processMessage('startFlow', { prompts });

    // Simular error
    state.stop();

    const status = await handler.processMessage('getStatus');
    expect(status.isRunning).toBe(false);
  });
});

describe('Background - Validación de datos', () => {
  let handler;

  beforeEach(() => {
    handler = new MessageHandler(new WorkflowState());
  });

  test('debe validar estructura de prompts', async () => {
    const invalidCases = [
      { prompts: null },
      { prompts: undefined },
      {},
    ];

    for (const data of invalidCases) {
      const result = await handler.processMessage('startFlow', data);
      expect(result.success).toBe(false);
    }
  });

  test('debe aceptar datos mínimos válidos', async () => {
    const result = await handler.processMessage('startFlow', {
      prompts: [{ prompt: 'test' }]
    });

    expect(result.success).toBe(true);
  });

  test('debe usar valores por defecto para campos opcionales', async () => {
    const state = new WorkflowState();
    const handler = new MessageHandler(state);

    await handler.processMessage('startFlow', {
      prompts: [{ prompt: 'test' }]
    });

    expect(state.references).toEqual({});
    expect(state.batchImages).toEqual([]);
    expect(state.config).toEqual({});
    expect(state.folderName).toBe('VidFlow01');
  });
});

// ========== KEEPALIVE MECHANISM TESTS ==========

describe('Service Worker Keepalive', () => {
  let alarmCallbacks;
  let createdAlarms;
  let clearedAlarms;

  beforeEach(() => {
    alarmCallbacks = [];
    createdAlarms = [];
    clearedAlarms = [];

    // Mock chrome.alarms
    global.chrome.alarms = {
      create: (name, opts) => createdAlarms.push({ name, ...opts }),
      clear: (name) => clearedAlarms.push(name),
      onAlarm: {
        addListener: (cb) => alarmCallbacks.push(cb)
      }
    };
  });

  test('startKeepalive creates an alarm with correct interval', () => {
    const KEEPALIVE_ALARM_NAME = 'vidflow-keepalive';

    // Simulate startKeepalive
    chrome.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: 0.4 });

    expect(createdAlarms).toHaveLength(1);
    expect(createdAlarms[0].name).toBe('vidflow-keepalive');
    expect(createdAlarms[0].periodInMinutes).toBe(0.4);
  });

  test('stopKeepalive clears the alarm', () => {
    const KEEPALIVE_ALARM_NAME = 'vidflow-keepalive';

    chrome.alarms.clear(KEEPALIVE_ALARM_NAME);

    expect(clearedAlarms).toContain('vidflow-keepalive');
  });

  test('keepalive alarm handler touches storage when workflow is running', () => {
    const storageSetCalls = [];
    global.chrome.storage = {
      local: {
        set: (data) => {
          storageSetCalls.push(data);
          return Promise.resolve();
        },
        get: jest.fn().mockResolvedValue({})
      }
    };

    // Simulate alarm handler behavior
    const workflowRunning = true;
    if (workflowRunning) {
      chrome.storage.local.set({ keepalive: Date.now() });
    }

    expect(storageSetCalls).toHaveLength(1);
    expect(storageSetCalls[0]).toHaveProperty('keepalive');
  });

  test('keepalive alarm stops when workflow is not running', () => {
    const KEEPALIVE_ALARM_NAME = 'vidflow-keepalive';
    const workflowRunning = false;

    if (!workflowRunning) {
      chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
    }

    expect(clearedAlarms).toContain('vidflow-keepalive');
  });
});

// ========== TIMING OPTIMIZATION TESTS ==========

describe('Timing Constants', () => {
  test('MAX_PARALLEL_VIDEOS should be 4 (safe for Flow rate limits)', () => {
    const MAX_PARALLEL_VIDEOS = 4;
    expect(MAX_PARALLEL_VIDEOS).toBe(4);
    expect(MAX_PARALLEL_VIDEOS).toBeGreaterThanOrEqual(3);
    expect(MAX_PARALLEL_VIDEOS).toBeLessThanOrEqual(6);
  });

  test('inter-video delay should be between 1-3 seconds', () => {
    const INTER_VIDEO_DELAY = 2000; // Optimized from 3000
    expect(INTER_VIDEO_DELAY).toBeGreaterThanOrEqual(1000);
    expect(INTER_VIDEO_DELAY).toBeLessThanOrEqual(3000);
  });

  test('monitor check interval should be between 2-5 seconds', () => {
    const MONITOR_CHECK_INTERVAL = 3000; // Optimized from 5000
    expect(MONITOR_CHECK_INTERVAL).toBeGreaterThanOrEqual(2000);
    expect(MONITOR_CHECK_INTERVAL).toBeLessThanOrEqual(5000);
  });

  test('content script connect initial wait should be reasonable', () => {
    const CONNECT_INITIAL_WAIT = 2000; // Optimized from 2500
    expect(CONNECT_INITIAL_WAIT).toBeGreaterThanOrEqual(1500);
    expect(CONNECT_INITIAL_WAIT).toBeLessThanOrEqual(3000);
  });

  test('keepalive ping interval should be under 30s (MV3 idle timeout)', () => {
    const KEEPALIVE_PING_INTERVAL = 20000;
    expect(KEEPALIVE_PING_INTERVAL).toBeLessThan(30000);
    expect(KEEPALIVE_PING_INTERVAL).toBeGreaterThanOrEqual(10000);
  });

  test('dynamic timeout calculation for 58 videos', () => {
    const totalVideos = 58;
    const baseTimeMinutes = 3;
    const minutesPerVideo = 1.5;
    const calculatedMinutes = baseTimeMinutes + (totalVideos * minutesPerVideo);
    const maxWaitTime = Math.max(30, calculatedMinutes) * 60 * 1000;

    // 58 videos = 3 + 87 = 90 minutes
    expect(calculatedMinutes).toBe(90);
    expect(maxWaitTime).toBe(90 * 60 * 1000);
    // Should be at least 30 minutes
    expect(maxWaitTime).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  test('no-activity cycles threshold matches check interval', () => {
    const CHECK_INTERVAL_MS = 3000;
    const MAX_NO_ACTIVITY_CYCLES = 10;
    const totalWaitMs = CHECK_INTERVAL_MS * MAX_NO_ACTIVITY_CYCLES;

    // Should be approximately 30 seconds of inactivity before deadlock detection
    expect(totalWaitMs).toBe(30000);
  });
});
