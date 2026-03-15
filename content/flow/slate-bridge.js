/**
 * VidFlow - Slate Bridge (Main World)
 * Runs in the MAIN world (not isolated) to access React fiber + Slate editor API.
 * Communicates with the content script via window.postMessage.
 */
(function() {
  'use strict';

  // Avoid duplicate initialization
  if (window.__vidflowSlateBridge) return;
  window.__vidflowSlateBridge = true;

  /**
   * Find the Slate editor instance by walking the React fiber tree.
   * @returns {Object|null} - The Slate editor object
   */
  function findSlateEditor() {
    var el = document.querySelector('[data-slate-editor="true"]');
    if (!el) return null;

    var fiberKey = Object.keys(el).find(function(k) {
      return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
    });
    if (!fiberKey) return null;

    var fiber = el[fiberKey];
    for (var i = 0; i < 30 && fiber; i++) {
      var ctx = fiber.dependencies && fiber.dependencies.firstContext;
      while (ctx) {
        var val = ctx.memoizedValue;
        if (val && typeof val === 'object') {
          if (val.editor && typeof val.editor.insertText === 'function' && Array.isArray(val.editor.children)) {
            return val.editor;
          }
          if (typeof val.insertText === 'function' && typeof val.apply === 'function' && Array.isArray(val.children)) {
            return val;
          }
        }
        ctx = ctx.next;
      }
      fiber = fiber.return;
    }
    return null;
  }

  /**
   * Set text in the Slate editor using its API.
   * Uses select-all + insertText to replace content.
   * @param {string} text - Text to set (empty string to clear)
   */
  function setSlateText(text) {
    var el = document.querySelector('[data-slate-editor="true"]');
    if (!el) return { success: false, error: 'No Slate editor element' };

    el.focus();

    var editor = findSlateEditor();
    if (!editor) return { success: false, error: 'Slate editor not found in fiber tree' };

    var hasContent = editor.children.some(function(block) {
      return (block.children || []).some(function(leaf) {
        return leaf.text && leaf.text.length > 0;
      });
    });

    if (hasContent) {
      var lastBlockIdx = editor.children.length - 1;
      var lastBlock = editor.children[lastBlockIdx];
      var leaves = lastBlock.children || [lastBlock];
      var lastLeafIdx = leaves.length - 1;
      var lastLeaf = leaves[lastLeafIdx] || { text: '' };
      var lastOffset = (lastLeaf.text || '').length;

      editor.select({
        anchor: { path: [0, 0], offset: 0 },
        focus: { path: [lastBlockIdx, Math.max(0, lastLeafIdx)], offset: lastOffset }
      });

      if (text) {
        editor.insertText(text);
      } else {
        editor.deleteFragment();
      }
    } else if (text) {
      editor.insertText(text);
    }

    return { success: true, length: (text || '').length };
  }

  /**
   * Get current text from the Slate editor.
   * @returns {string}
   */
  function getSlateText() {
    var editor = findSlateEditor();
    if (!editor) return '';

    var texts = [];
    for (var i = 0; i < editor.children.length; i++) {
      var block = editor.children[i];
      var leaves = block.children || [block];
      for (var j = 0; j < leaves.length; j++) {
        if (leaves[j].text) texts.push(leaves[j].text);
      }
    }
    return texts.join('');
  }

  // Listen for messages from VidFlow content script
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'vidflow-slate-request') return;

    var msg = event.data;
    var response = { source: 'vidflow-slate-response', id: msg.id };

    try {
      switch (msg.action) {
        case 'setText':
          var result = setSlateText(msg.text);
          response.success = result.success;
          response.error = result.error;
          response.length = result.length;
          break;

        case 'getText':
          response.success = true;
          response.text = getSlateText();
          break;

        case 'ping':
          response.success = true;
          response.ready = true;
          break;

        default:
          response.success = false;
          response.error = 'Unknown action: ' + msg.action;
      }
    } catch (e) {
      response.success = false;
      response.error = e.message;
    }

    window.postMessage(response, '*');
  });

  console.log('VidFlow: slate-bridge.js loaded (MAIN world)');
})();
