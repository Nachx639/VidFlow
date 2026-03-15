/**
 * VidFlow - Storage Manager
 * Handles Chrome storage operations
 */

export class StorageManager {
  constructor() {
    this.storage = chrome.storage.local;
  }

  /**
   * Get a single value from storage
   * @param {string} key - Storage key
   * @returns {Promise<any>} Stored value
   */
  async get(key) {
    const result = await this.storage.get(key);
    return result[key];
  }

  /**
   * Get all stored values
   * @returns {Promise<Object>} All stored values
   */
  async getAll() {
    return await this.storage.get(null);
  }

  /**
   * Set a single value in storage
   * @param {string} key - Storage key
   * @param {any} value - Value to store
   */
  async set(key, value) {
    await this.storage.set({ [key]: value });
  }

  /**
   * Set multiple values in storage
   * @param {Object} items - Key-value pairs to store
   */
  async setMultiple(items) {
    await this.storage.set(items);
  }

  /**
   * Remove a value from storage
   * @param {string} key - Storage key
   */
  async remove(key) {
    await this.storage.remove(key);
  }

  /**
   * Clear all storage
   */
  async clear() {
    await this.storage.clear();
  }

  /**
   * Store workflow state for resume capability
   * @param {Object} state - Current workflow state
   */
  async saveWorkflowState(state) {
    await this.set('workflowState', {
      ...state,
      timestamp: Date.now()
    });
  }

  /**
   * Get saved workflow state
   * @returns {Promise<Object|null>} Saved state or null
   */
  async getWorkflowState() {
    return await this.get('workflowState');
  }

  /**
   * Clear workflow state
   */
  async clearWorkflowState() {
    await this.remove('workflowState');
  }
}

// For use without modules
if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}
