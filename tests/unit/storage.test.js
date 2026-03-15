/**
 * Tests para lib/storage.js
 * StorageManager class
 */

// Mock Chrome API
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn()
    }
  }
};

// Cargar StorageManager
const fs = require('fs');
const path = require('path');
const storageCode = fs.readFileSync(
  path.join(__dirname, '../../lib/storage.js'),
  'utf8'
).replace('export class', 'class'); // Remover export para eval

eval(storageCode);

describe('StorageManager', () => {
  let storage;

  beforeEach(() => {
    storage = new StorageManager();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('debe usar chrome.storage.local', () => {
      expect(storage.storage).toBe(chrome.storage.local);
    });
  });

  describe('get()', () => {
    test('debe obtener un valor por key', async () => {
      chrome.storage.local.get.mockResolvedValue({ testKey: 'testValue' });

      const result = await storage.get('testKey');

      expect(chrome.storage.local.get).toHaveBeenCalledWith('testKey');
      expect(result).toBe('testValue');
    });

    test('debe retornar undefined si key no existe', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const result = await storage.get('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    test('debe obtener todos los valores', async () => {
      const allData = { key1: 'value1', key2: 'value2' };
      chrome.storage.local.get.mockResolvedValue(allData);

      const result = await storage.getAll();

      expect(chrome.storage.local.get).toHaveBeenCalledWith(null);
      expect(result).toEqual(allData);
    });
  });

  describe('set()', () => {
    test('debe guardar un valor', async () => {
      chrome.storage.local.set.mockResolvedValue();

      await storage.set('myKey', 'myValue');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ myKey: 'myValue' });
    });

    test('debe guardar objetos complejos', async () => {
      chrome.storage.local.set.mockResolvedValue();
      const complexValue = { prompts: ['p1', 'p2'], config: { model: 'veo' } };

      await storage.set('workflow', complexValue);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({ workflow: complexValue });
    });
  });

  describe('setMultiple()', () => {
    test('debe guardar múltiples valores', async () => {
      chrome.storage.local.set.mockResolvedValue();
      const items = { key1: 'v1', key2: 'v2', key3: 'v3' };

      await storage.setMultiple(items);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(items);
    });
  });

  describe('remove()', () => {
    test('debe eliminar un valor', async () => {
      chrome.storage.local.remove.mockResolvedValue();

      await storage.remove('keyToRemove');

      expect(chrome.storage.local.remove).toHaveBeenCalledWith('keyToRemove');
    });
  });

  describe('clear()', () => {
    test('debe limpiar todo el storage', async () => {
      chrome.storage.local.clear.mockResolvedValue();

      await storage.clear();

      expect(chrome.storage.local.clear).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveWorkflowState()', () => {
    test('debe guardar estado con timestamp', async () => {
      chrome.storage.local.set.mockResolvedValue();
      const state = { currentIndex: 5, prompts: ['p1', 'p2'] };
      const beforeTime = Date.now();

      await storage.saveWorkflowState(state);

      const savedArg = chrome.storage.local.set.mock.calls[0][0];
      expect(savedArg.workflowState).toEqual(expect.objectContaining({
        currentIndex: 5,
        prompts: ['p1', 'p2'],
      }));
      expect(savedArg.workflowState.currentIndex).toBe(5);
      expect(savedArg.workflowState.prompts).toEqual(['p1', 'p2']);
      expect(savedArg.workflowState.timestamp).toBeGreaterThanOrEqual(beforeTime);
    });

    test('debe preservar propiedades existentes del estado', async () => {
      chrome.storage.local.set.mockResolvedValue();
      const state = {
        mode: 'pipeline',
        completed: [1, 2, 3],
        failed: []
      };

      await storage.saveWorkflowState(state);

      const savedArg = chrome.storage.local.set.mock.calls[0][0];
      expect(savedArg.workflowState.mode).toBe('pipeline');
      expect(savedArg.workflowState.completed).toEqual([1, 2, 3]);
      expect(savedArg.workflowState.failed).toEqual([]);
    });
  });

  describe('getWorkflowState()', () => {
    test('debe obtener estado guardado', async () => {
      const savedState = {
        currentIndex: 3,
        timestamp: Date.now()
      };
      chrome.storage.local.get.mockResolvedValue({ workflowState: savedState });

      const result = await storage.getWorkflowState();

      expect(chrome.storage.local.get).toHaveBeenCalledWith('workflowState');
      expect(result).toEqual(savedState);
    });

    test('debe retornar undefined si no hay estado', async () => {
      chrome.storage.local.get.mockResolvedValue({});

      const result = await storage.getWorkflowState();

      expect(result).toBeUndefined();
    });
  });

  describe('clearWorkflowState()', () => {
    test('debe eliminar el estado del workflow', async () => {
      chrome.storage.local.remove.mockResolvedValue();

      await storage.clearWorkflowState();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith('workflowState');
    });
  });
});

describe('StorageManager - Flujo completo', () => {
  let storage;

  beforeEach(() => {
    storage = new StorageManager();
    jest.clearAllMocks();
  });

  test('debe manejar ciclo de vida de workflow state', async () => {
    // 1. Guardar estado inicial
    chrome.storage.local.set.mockResolvedValue();
    await storage.saveWorkflowState({
      mode: 'pipeline',
      currentIndex: 0,
      prompts: ['p1', 'p2', 'p3']
    });

    // 2. Recuperar estado
    chrome.storage.local.get.mockResolvedValue({
      workflowState: {
        mode: 'pipeline',
        currentIndex: 0,
        prompts: ['p1', 'p2', 'p3'],
        timestamp: Date.now()
      }
    });
    const state = await storage.getWorkflowState();
    expect(state.mode).toBe('pipeline');

    // 3. Limpiar estado
    chrome.storage.local.remove.mockResolvedValue();
    await storage.clearWorkflowState();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('workflowState');
  });
});
