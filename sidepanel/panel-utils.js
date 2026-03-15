/**
 * VidFlow - Panel Utilities
 * Pure utility functions: escapeHtml, sanitizeFolderName, readFileAsDataURL, parsing helpers, etc.
 */

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Sanitize folder name: remove path separators and control characters
 */
function sanitizeFolderName(name) {
  if (!name) return '';
  return name
    .replace(/[\/\\:*?"<>|]/g, '_')  // Replace path-unsafe chars
    .replace(/[\x00-\x1f\x7f]/g, '') // Remove control characters
    .substring(0, 255);               // Limit length
}

/** Maximum prompt length per scene (characters) */
var MAX_PROMPT_LENGTH = 5000;

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

function generateAutoFolderName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');
  return `Proyecto_${year}${month}${day}_${hours}${mins}`;
}

/**
 * Parsea texto con formato numerado: "N. contenido"
 * Devuelve un Map con número -> contenido
 */
function parseNumberedBlocks(text) {
  if (!text || !text.trim()) return new Map();

  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);
  const result = new Map();

  blocks.forEach(block => {
    // Buscar número al inicio: "1.", "2.", "10.", etc.
    const match = block.match(/^(\d+)\.\s*([\s\S]*)/);
    if (match) {
      const num = parseInt(match[1], 10);
      const content = match[2].trim();
      if (content) {
        result.set(num, content);
      }
    }
  });

  return result;
}

/**
 * Parsea prompts numerados del textarea y devuelve un array ordenado por número.
 * Ej: "1. prompt A\n\n2. prompt B" → ["prompt A", "prompt B"]
 */
function parseNumberedPrompts(text) {
  const blocks = parseNumberedBlocks(text);
  if (blocks.size === 0) return [];

  const sorted = [...blocks.entries()].sort((a, b) => a[0] - b[0]);
  return sorted.map(([, content]) => content);
}

function getStepOrder(step) {
  const order = { 'flow': 0, 'speech': 1 };
  return order[step] ?? -1;
}

console.log('VidFlow: panel-utils.js cargado');
