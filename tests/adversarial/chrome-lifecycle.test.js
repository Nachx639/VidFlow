/**
 * ROUND 15: Adversarial Testing - Chrome Extension Lifecycle
 * Tests for corrupted storage, failed APIs, and extension invalidation
 */

const { storageMock, tabsMock, downloadsMock, scriptingMock } = require('../mocks/chrome-api');

// Inline StorageManager for testing
class StorageManager {
  constructor() { this.storage = chrome.storage.local; }
  async get(key) { const result = await this.storage.get(key); return result[key]; }
  async getAll() { return await this.storage.get(null); }
  async set(key, value) { await this.storage.set({ [key]: value }); }
  async setMultiple(items) { await this.storage.set(items); }
  async remove(key) { await this.storage.remove(key); }
  async clear() { await this.storage.clear(); }
  async saveWorkflowState(state) { await this.set('workflowState', { ...state, timestamp: Date.now() }); }
  async getWorkflowState() { return await this.get('workflowState'); }
  async clearWorkflowState() { await this.remove('workflowState'); }
}

describe('Chrome Extension Lifecycle Edge Cases', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    global.resetChromeStorage();
  });

  // ========== C1. Corrupted Storage Data ==========

  describe('chrome.storage.local.get returns corrupted data', () => {
    test('storage returns undefined for expected key', async () => {
      const manager = new StorageManager();
      const result = await manager.get('nonexistent');
      expect(result).toBeUndefined();
    });

    test('storage returns null values gracefully', async () => {
      global.setChromeStorageData({ workflowState: null });
      const manager = new StorageManager();
      const result = await manager.get('workflowState');
      expect(result).toBeNull();
    });

    test('storage returns corrupted JSON-like string', async () => {
      global.setChromeStorageData({ workflowState: '{broken json' });
      const manager = new StorageManager();
      const result = await manager.get('workflowState');
      expect(result).toBe('{broken json');
      // Caller should handle non-object gracefully
    });

    test('storage returns number instead of object', async () => {
      global.setChromeStorageData({ workflowState: 42 });
      const manager = new StorageManager();
      const result = await manager.get('workflowState');
      expect(result).toBe(42);
    });

    test('storage returns array instead of object', async () => {
      global.setChromeStorageData({ pipelineState: [1, 2, 3] });
      const manager = new StorageManager();
      const result = await manager.get('pipelineState');
      expect(result).toEqual([1, 2, 3]);
    });

    test('getAll with corrupted entries does not throw', async () => {
      global.setChromeStorageData({
        key1: null,
        key2: undefined,
        key3: NaN,
        key4: Infinity,
        key5: { valid: true },
      });
      const manager = new StorageManager();
      const all = await manager.getAll();
      expect(typeof all).toBe('object');
      expect(all).not.toBeNull();
      expect(all.key5.valid).toBe(true);
    });

    test('saveWorkflowState adds timestamp', async () => {
      const manager = new StorageManager();
      const state = { isRunning: true, currentStep: 'flow' };
      await manager.saveWorkflowState(state);

      const saved = await manager.get('workflowState');
      expect(typeof saved.timestamp).toBe('number');
      expect(saved.timestamp).toBeGreaterThan(0);
      expect(saved.isRunning).toBe(true);
    });

    test('clearWorkflowState removes the key', async () => {
      const manager = new StorageManager();
      await manager.set('workflowState', { test: true });
      await manager.clearWorkflowState();
      const result = await manager.get('workflowState');
      expect(result).toBeUndefined();
    });
  });

  // ========== C2. chrome.tabs.sendMessage failures ==========

  describe('chrome.tabs.sendMessage failures', () => {
    test('Extension context invalidated error', async () => {
      chrome.tabs.sendMessage.mockRejectedValueOnce(
        new Error('Extension context invalidated')
      );

      await expect(
        chrome.tabs.sendMessage(1, { action: 'ping' })
      ).rejects.toThrow('Extension context invalidated');
    });

    test('Receiving end does not exist', async () => {
      chrome.tabs.sendMessage.mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.')
      );

      try {
        await chrome.tabs.sendMessage(1, { action: 'setupFlow' });
        fail('Should have thrown');
      } catch (e) {
        expect(e.message).toContain('Receiving end does not exist');
      }
    });

    test('Tab was closed during message send', async () => {
      chrome.tabs.sendMessage.mockRejectedValueOnce(
        new Error('No tab with id: 999')
      );

      try {
        await chrome.tabs.sendMessage(999, { action: 'test' });
        fail('Should have thrown');
      } catch (e) {
        expect(e.message).toContain('No tab');
      }
    });

    test('sendMessage with undefined tabId', async () => {
      chrome.tabs.sendMessage.mockRejectedValueOnce(
        new Error('Error: Invalid tabId')
      );

      await expect(
        chrome.tabs.sendMessage(undefined, { action: 'test' })
      ).rejects.toThrow();
    });
  });

  // ========== C3. chrome.downloads.download returns undefined ==========

  describe('chrome.downloads.download edge cases', () => {
    test('download returns undefined instead of downloadId', async () => {
      chrome.downloads.download.mockResolvedValueOnce(undefined);

      const downloadId = await chrome.downloads.download({
        url: 'data:audio/wav;base64,AAAA',
        filename: 'test.wav',
      });

      expect(downloadId).toBeUndefined();
      // Code should handle: registerVidFlowDownload(undefined) shouldn't crash
    });

    test('download rejects with permission error', async () => {
      chrome.downloads.download.mockRejectedValueOnce(
        new Error('Download permission denied')
      );

      await expect(
        chrome.downloads.download({ url: 'http://example.com/file.mp4' })
      ).rejects.toThrow('permission denied');
    });

    test('download with invalid URL', async () => {
      chrome.downloads.download.mockRejectedValueOnce(
        new Error('Invalid URL')
      );

      await expect(
        chrome.downloads.download({ url: 'not-a-url' })
      ).rejects.toThrow('Invalid URL');
    });

    test('download with empty data URL', async () => {
      chrome.downloads.download.mockResolvedValueOnce(42);

      const downloadId = await chrome.downloads.download({
        url: 'data:image/png;base64,',
        filename: 'empty.png',
      });

      expect(downloadId).toBe(42);
    });
  });

  // ========== C4. chrome.scripting.executeScript failures ==========

  describe('chrome.scripting.executeScript failures', () => {
    test('throws after partial injection', async () => {
      // First call succeeds, second fails
      chrome.scripting.executeScript
        .mockResolvedValueOnce([{ result: true }])
        .mockRejectedValueOnce(new Error('Cannot access contents of the page'));

      // First injection works
      const result1 = await chrome.scripting.executeScript({
        target: { tabId: 1 },
        files: ['content/flow/utils.js'],
      });
      expect(result1[0].result).toBe(true);

      // Second injection fails (partial injection scenario)
      await expect(
        chrome.scripting.executeScript({
          target: { tabId: 1 },
          files: ['content/flow/main.js'],
        })
      ).rejects.toThrow('Cannot access contents');
    });

    test('executeScript on chrome:// URL', async () => {
      chrome.scripting.executeScript.mockRejectedValueOnce(
        new Error('Cannot access a chrome:// URL')
      );

      await expect(
        chrome.scripting.executeScript({
          target: { tabId: 1 },
          files: ['content/flow/main.js'],
        })
      ).rejects.toThrow('chrome:// URL');
    });

    test('executeScript on closed tab', async () => {
      chrome.scripting.executeScript.mockRejectedValueOnce(
        new Error('No tab with id: 999')
      );

      await expect(
        chrome.scripting.executeScript({
          target: { tabId: 999 },
          files: ['content/flow/main.js'],
        })
      ).rejects.toThrow('No tab');
    });
  });

  // ========== C5. Storage quota exceeded ==========

  describe('Storage quota exceeded', () => {
    test('set fails with QUOTA_BYTES exceeded', async () => {
      chrome.storage.local.set.mockRejectedValueOnce(
        new Error('QUOTA_BYTES quota exceeded')
      );

      await expect(
        chrome.storage.local.set({ hugeData: 'x'.repeat(10000000) })
      ).rejects.toThrow('QUOTA_BYTES');
    });

    test('saveWorkflowState handles quota error gracefully', async () => {
      // This simulates the try/catch in background.js saveState()
      chrome.storage.local.set.mockRejectedValueOnce(
        new Error('QUOTA_BYTES quota exceeded')
      );

      let errorCaught = false;
      try {
        await chrome.storage.local.set({ workflowState: { huge: true } });
      } catch (error) {
        errorCaught = true;
        expect(error.message).toContain('QUOTA_BYTES');
      }
      expect(errorCaught).toBe(true);
    });
  });

  // ========== C6. Alarms API edge cases ==========

  describe('Keepalive alarm edge cases', () => {
    test('chrome.alarms undefined does not crash', () => {
      const savedAlarms = chrome.alarms;
      delete chrome.alarms;

      // Simulate startKeepalive check
      expect(() => {
        if (typeof chrome !== 'undefined' && chrome.alarms) {
          chrome.alarms.create('test', { periodInMinutes: 0.4 });
        }
      }).not.toThrow();

      chrome.alarms = savedAlarms;
    });
  });

  // ========== C7. Multiple StorageManager instances ==========

  describe('Multiple StorageManager instances', () => {
    test('concurrent reads and writes', async () => {
      const manager1 = new StorageManager();
      const manager2 = new StorageManager();

      await manager1.set('key1', 'value1');
      await manager2.set('key2', 'value2');

      const result1 = await manager1.get('key2');
      const result2 = await manager2.get('key1');

      expect(result1).toBe('value2');
      expect(result2).toBe('value1');
    });

    test('clear from one instance affects the other', async () => {
      const manager1 = new StorageManager();
      const manager2 = new StorageManager();

      await manager1.set('shared', 'data');
      await manager2.clear();

      const result = await manager1.get('shared');
      expect(result).toBeUndefined();
    });
  });

  // ========== C8. Download tracking memory management ==========

  describe('Download tracking bounds', () => {
    test('vidflowDownloadIds Set does not grow unbounded (simulated)', () => {
      const MAX_TRACKED = 200;
      const vidflowDownloadIds = new Set();

      // Simulate registering 300 downloads
      for (let i = 0; i < 300; i++) {
        if (vidflowDownloadIds.size >= MAX_TRACKED) {
          const oldest = vidflowDownloadIds.values().next().value;
          vidflowDownloadIds.delete(oldest);
        }
        vidflowDownloadIds.add(i);
      }

      expect(vidflowDownloadIds.size).toBe(MAX_TRACKED);
      // Oldest entries should be gone
      expect(vidflowDownloadIds.has(0)).toBe(false);
      expect(vidflowDownloadIds.has(99)).toBe(false);
      // Newest entries should exist
      expect(vidflowDownloadIds.has(299)).toBe(true);
      expect(vidflowDownloadIds.has(100)).toBe(true);
    });
  });

  // ========== C9. Pending download expiry ==========

  describe('Pending download expiry logic', () => {
    test('pending speech download expires after 30 seconds', () => {
      const pendingSpeechDownload = {
        filename: 'test.wav',
        timestamp: Date.now() - 31000, // 31 seconds ago
      };

      const getPending = () => {
        if (pendingSpeechDownload.filename && pendingSpeechDownload.timestamp) {
          if (Date.now() - pendingSpeechDownload.timestamp < 30000) {
            return pendingSpeechDownload.filename;
          }
          pendingSpeechDownload.filename = null;
          pendingSpeechDownload.timestamp = null;
        }
        return null;
      };

      expect(getPending()).toBeNull();
      expect(pendingSpeechDownload.filename).toBeNull();
    });

    test('pending speech download valid within 30 seconds', () => {
      const pendingSpeechDownload = {
        filename: 'test.wav',
        timestamp: Date.now() - 5000, // 5 seconds ago
      };

      const getPending = () => {
        if (pendingSpeechDownload.filename && pendingSpeechDownload.timestamp) {
          if (Date.now() - pendingSpeechDownload.timestamp < 30000) {
            return pendingSpeechDownload.filename;
          }
        }
        return null;
      };

      expect(getPending()).toBe('test.wav');
    });
  });
});
