/**
 * Chrome API Mocks para VidFlow Tests
 * Simula las APIs de Chrome necesarias para testing
 */

// Storage mock con datos en memoria
const storageData = {};

const storageMock = {
  local: {
    get: jest.fn((keys) => {
      return new Promise((resolve) => {
        if (keys === null || keys === undefined) {
          resolve({ ...storageData });
        } else if (typeof keys === 'string') {
          resolve({ [keys]: storageData[keys] });
        } else if (Array.isArray(keys)) {
          const result = {};
          keys.forEach((key) => {
            if (storageData[key] !== undefined) {
              result[key] = storageData[key];
            }
          });
          resolve(result);
        } else {
          resolve(keys);
        }
      });
    }),
    set: jest.fn((items) => {
      return new Promise((resolve) => {
        Object.assign(storageData, items);
        resolve();
      });
    }),
    remove: jest.fn((keys) => {
      return new Promise((resolve) => {
        if (typeof keys === 'string') {
          delete storageData[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach((key) => delete storageData[key]);
        }
        resolve();
      });
    }),
    clear: jest.fn(() => {
      return new Promise((resolve) => {
        Object.keys(storageData).forEach((key) => delete storageData[key]);
        resolve();
      });
    }),
  },
  sync: {
    get: jest.fn(() => Promise.resolve({})),
    set: jest.fn(() => Promise.resolve()),
    remove: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
};

// Runtime mock
const runtimeMock = {
  sendMessage: jest.fn(() => Promise.resolve({ success: true })),
  onMessage: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    hasListener: jest.fn(() => false),
  },
  connect: jest.fn(() => ({
    postMessage: jest.fn(),
    disconnect: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    onDisconnect: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
  })),
  getURL: jest.fn((path) => `chrome-extension://mock-extension-id/${path}`),
  lastError: null,
  id: 'mock-extension-id',
};

// Tabs mock
const tabsMock = {
  query: jest.fn(() => Promise.resolve([{ id: 1, url: 'https://labs.google/fx/flow' }])),
  sendMessage: jest.fn(() => Promise.resolve({ success: true })),
  create: jest.fn(() => Promise.resolve({ id: 2 })),
  update: jest.fn(() => Promise.resolve()),
  remove: jest.fn(() => Promise.resolve()),
  get: jest.fn((tabId) => Promise.resolve({ id: tabId, url: 'https://labs.google/fx/flow' })),
  onUpdated: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
  onRemoved: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
};

// Downloads mock
const downloadsMock = {
  download: jest.fn(() => Promise.resolve(1)),
  onDeterminingFilename: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
  onChanged: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
  search: jest.fn(() => Promise.resolve([])),
  pause: jest.fn(() => Promise.resolve()),
  resume: jest.fn(() => Promise.resolve()),
  cancel: jest.fn(() => Promise.resolve()),
};

// Scripting mock
const scriptingMock = {
  executeScript: jest.fn(() => Promise.resolve([{ result: true }])),
  insertCSS: jest.fn(() => Promise.resolve()),
  removeCSS: jest.fn(() => Promise.resolve()),
};

// SidePanel mock
const sidePanelMock = {
  open: jest.fn(() => Promise.resolve()),
  setOptions: jest.fn(() => Promise.resolve()),
  getOptions: jest.fn(() => Promise.resolve({ enabled: true })),
  setPanelBehavior: jest.fn(() => Promise.resolve()),
};

// Action mock
const actionMock = {
  onClicked: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  },
  setBadgeText: jest.fn(() => Promise.resolve()),
  setBadgeBackgroundColor: jest.fn(() => Promise.resolve()),
  setTitle: jest.fn(() => Promise.resolve()),
  setIcon: jest.fn(() => Promise.resolve()),
};

// Construir objeto chrome completo
global.chrome = {
  storage: storageMock,
  runtime: runtimeMock,
  tabs: tabsMock,
  downloads: downloadsMock,
  scripting: scriptingMock,
  sidePanel: sidePanelMock,
  action: actionMock,
};

// Helper para resetear storage entre tests
global.resetChromeStorage = () => {
  Object.keys(storageData).forEach((key) => delete storageData[key]);
  storageMock.local.get.mockClear();
  storageMock.local.set.mockClear();
  storageMock.local.remove.mockClear();
  storageMock.local.clear.mockClear();
};

// Helper para pre-poblar storage
global.setChromeStorageData = (data) => {
  Object.assign(storageData, data);
};

// Helper para obtener storage actual
global.getChromeStorageData = () => ({ ...storageData });

// Helper para simular error de runtime
global.simulateChromeRuntimeError = (message) => {
  chrome.runtime.lastError = { message };
};

global.clearChromeRuntimeError = () => {
  chrome.runtime.lastError = null;
};

// Exportar para uso en tests específicos
module.exports = {
  storageMock,
  runtimeMock,
  tabsMock,
  downloadsMock,
  scriptingMock,
  sidePanelMock,
  actionMock,
};
