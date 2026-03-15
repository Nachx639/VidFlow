/**
 * VidFlow ↔ OpenClaw Bridge
 * 
 * Content scripts run in an "isolated world" — they share the DOM with the page
 * but NOT the JS context. However, window.postMessage works across worlds.
 * 
 * Protocol:
 *   Main world (OpenClaw relay) → postMessage → Content script (this) → chrome.runtime → Background
 *   Background → response → Content script (this) → postMessage → Main world
 *
 * Usage from OpenClaw relay (browser evaluate):
 *   window.postMessage({source:'openclaw-vidflow', id:'123', action:'getPipelineState', data:{}}, '*')
 *   // Listen for: {source:'vidflow-openclaw', id:'123', success:true, result:{...}}
 */
(function() {
  'use strict';

  if (window.__vidflowBridgeLoaded) return;
  window.__vidflowBridgeLoaded = true;

  const INBOUND = 'openclaw-vidflow';
  const OUTBOUND = 'vidflow-openclaw';

  window.addEventListener('message', async (event) => {
    // Only accept messages from this window (main world postMessage)
    if (event.source !== window) return;
    if (!event.data || event.data.source !== INBOUND) return;

    const { id, action, data } = event.data;
    if (!id || !action) return;

    console.log(`VidFlow Bridge: → "${action}" (${id})`);

    try {
      // Forward to background script, including this tab's ID so background
      // can reuse it instead of opening a new tab (e.g. for startFlow)
      const payload = { action, data: data || {} };
      // chrome.runtime.sendMessage from content script doesn't include sender.tab
      // in the message itself, but background gets it via the sender parameter.
      // We also embed a hint so bridge-originated calls are identifiable.
      if (data) data.__fromBridge = true;
      const response = await chrome.runtime.sendMessage(payload);

      console.log(`VidFlow Bridge: ← "${action}" OK`);
      window.postMessage({ source: OUTBOUND, id, success: true, result: response }, '*');
    } catch (error) {
      console.error(`VidFlow Bridge: ✗ "${action}":`, error.message);
      window.postMessage({ source: OUTBOUND, id, success: false, error: error.message }, '*');
    }
  });

  console.log('VidFlow Bridge: Ready (OpenClaw ↔ VidFlow)');
})();
