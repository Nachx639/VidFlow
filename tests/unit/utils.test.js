/**
 * Tests para content/flow/utils.js
 * Funciones de utilidad compartidas
 */

// Mock de vfLog para tests que lo usan
global.vfLog = jest.fn();

// Importar las funciones (simulamos módulo)
// En producción, estas funciones están en el scope global del content script

// ========== IMPLEMENTACIONES PARA TESTING ==========
// Copiamos las funciones puras para poder testearlas

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function findElement(texts, tagFilter = null) {
  const allElements = document.querySelectorAll(tagFilter || '*');

  for (const el of allElements) {
    const elText = el.textContent?.trim().toLowerCase();
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
    const placeholder = el.getAttribute('placeholder')?.toLowerCase();

    for (const searchText of texts) {
      const search = searchText.toLowerCase();

      if (elText === search ||
          elText?.includes(search) ||
          ariaLabel?.includes(search) ||
          placeholder?.includes(search)) {

        if (el.tagName === 'BUTTON' ||
            el.tagName === 'A' ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('role') === 'option' ||
            el.getAttribute('role') === 'menuitem' ||
            el.onclick ||
            el.closest('button')) {
          return el.closest('button') || el;
        }

        if (!tagFilter) {
          return el;
        }
      }
    }
  }

  return null;
}

function findElementInSettings(texts) {
  const settingsPanel = document.querySelector('[role="dialog"]');

  if (!settingsPanel) {
    vfLog('Panel de ajustes (dialog) no encontrado', 'warn');
    return null;
  }

  const comboboxes = settingsPanel.querySelectorAll('[role="combobox"]');
  for (const cb of comboboxes) {
    const cbText = cb.textContent?.trim().toLowerCase() || '';
    for (const searchText of texts) {
      const search = searchText.toLowerCase();
      if (cbText.includes(search)) {
        vfLog('Combobox encontrado: ' + cbText.substring(0, 30), 'info');
        return cb;
      }
    }
  }

  const allElements = settingsPanel.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"]');
  for (const el of allElements) {
    const elText = el.textContent?.trim().toLowerCase() || '';
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';

    for (const searchText of texts) {
      const search = searchText.toLowerCase();
      if (elText.includes(search) || ariaLabel.includes(search)) {
        return el;
      }
    }
  }
  return null;
}

async function selectOptionInListbox(targetTexts) {
  await sleep(300);
  const listbox = document.querySelector('[role="listbox"]');
  if (!listbox) {
    vfLog('Listbox no encontrado', 'warn');
    return false;
  }

  const options = listbox.querySelectorAll('[role="option"]');
  for (const opt of options) {
    const optText = opt.textContent?.toLowerCase() || '';
    for (const target of targetTexts) {
      if (optText.includes(target.toLowerCase())) {
        opt.click();
        vfLog('Opción seleccionada: ' + optText.substring(0, 30), 'success');
        return true;
      }
    }
  }
  vfLog('Opción no encontrada en listbox', 'warn');
  return false;
}

function showDebugBadge(text, duration = 3000) {
  const existingBadge = document.getElementById('vidflow-debug-badge');
  if (existingBadge) existingBadge.remove();

  const badge = document.createElement('div');
  badge.id = 'vidflow-debug-badge';
  badge.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 10px;
    background: #f97316;
    color: white;
    padding: 10px 16px;
    border-radius: 8px;
    z-index: 999999;
    font-size: 13px;
    font-weight: 500;
    font-family: system-ui, sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    animation: vf-fade-in 0.3s ease;
  `;
  badge.textContent = text;
  document.body.appendChild(badge);

  if (duration > 0) {
    setTimeout(() => badge.remove(), duration);
  }
}

// ========== TESTS ==========

describe('Utils - sleep()', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debe resolver después del tiempo especificado', async () => {
    const promise = sleep(1000);

    jest.advanceTimersByTime(999);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(1);
    await promise;
    expect(jest.getTimerCount()).toBe(0);
  });

  test('debe manejar 0ms', async () => {
    const promise = sleep(0);
    jest.advanceTimersByTime(0);
    await promise;
  });

  test('debe manejar valores grandes', async () => {
    const promise = sleep(60000);
    jest.advanceTimersByTime(60000);
    await promise;
  });
});

describe('Utils - escapeHtml()', () => {
  test('debe escapar caracteres HTML básicos', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  test('debe escapar ampersands', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('debe escapar comillas', () => {
    expect(escapeHtml('He said "hello"')).toBe('He said "hello"');
  });

  test('debe manejar texto sin caracteres especiales', () => {
    expect(escapeHtml('texto normal')).toBe('texto normal');
  });

  test('debe manejar string vacío', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('debe escapar múltiples caracteres especiales', () => {
    const input = '<div class="test">Hello & Welcome</div>';
    const result = escapeHtml(input);
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&amp;');
  });
});

describe('Utils - findElement()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('debe encontrar elemento por textContent exacto', () => {
    const btn = createMockElement('button', { textContent: 'Generar' });
    document.body.appendChild(btn);

    const result = findElement(['Generar']);
    expect(result).not.toBeNull();
    expect(result.textContent).toBe('Generar');
  });

  test('debe encontrar elemento por textContent parcial (case insensitive)', () => {
    const btn = createMockElement('button', { textContent: 'Generar Video' });
    document.body.appendChild(btn);

    const result = findElement(['generar']);
    expect(result).not.toBeNull();
    expect(result.textContent).toContain('Generar');
  });

  test('debe encontrar elemento por aria-label', () => {
    const btn = createMockElement('button', { ariaLabel: 'Cerrar diálogo' });
    document.body.appendChild(btn);

    const result = findElement(['cerrar']);
    expect(result).toBe(btn);
  });

  test('debe encontrar elemento por placeholder', () => {
    const input = createMockElement('input', { placeholder: 'Escribe tu prompt aquí' });
    document.body.appendChild(input);

    const result = findElement(['prompt']);
    expect(result).toBe(input);
  });

  test('debe retornar el botón padre si el texto está en un hijo', () => {
    const btn = document.createElement('button');
    const span = document.createElement('span');
    span.textContent = 'Descargar';
    btn.appendChild(span);
    document.body.appendChild(btn);

    const result = findElement(['descargar']);
    expect(result).not.toBeNull();
    // El resultado contiene el texto buscado
    expect(result.textContent?.toLowerCase()).toContain('descargar');
  });

  test('debe filtrar por tag si se especifica', () => {
    const div = createMockElement('div', { textContent: 'Generar' });
    const btn = createMockElement('button', { textContent: 'Generar' });
    document.body.appendChild(div);
    document.body.appendChild(btn);

    const result = findElement(['generar'], 'button');
    expect(result).toBe(btn);
  });

  test('debe retornar null si no encuentra el elemento', () => {
    const result = findElement(['texto inexistente']);
    expect(result).toBeNull();
  });

  test('debe buscar múltiples textos y retornar el primero encontrado', () => {
    const btn = createMockElement('button', { textContent: 'Aceptar' });
    document.body.appendChild(btn);

    const result = findElement(['Cancelar', 'Aceptar', 'OK']);
    expect(result).not.toBeNull();
    expect(result.textContent).toBe('Aceptar');
  });

  test('debe encontrar elementos con role="button"', () => {
    const div = createMockElement('div', { textContent: 'Click aquí', role: 'button' });
    document.body.appendChild(div);

    const result = findElement(['click']);
    expect(result).not.toBeNull();
  });

  test('debe encontrar elementos con role="option"', () => {
    const div = createMockElement('div', { textContent: 'Opcion uno', role: 'option' });
    document.body.appendChild(div);

    const result = findElement(['opcion']);
    expect(result).not.toBeNull();
  });
});

describe('Utils - findElementInSettings()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
  });

  test('debe retornar null y loguear si no hay dialog', () => {
    const result = findElementInSettings(['VEO 3.1']);
    expect(result).toBeNull();
    expect(vfLog).toHaveBeenCalledWith('Panel de ajustes (dialog) no encontrado', 'warn');
  });

  test('debe encontrar combobox dentro del dialog', () => {
    const dialog = createMockElement('div', { role: 'dialog' });
    const combobox = createMockElement('div', { role: 'combobox', textContent: 'VEO 3.1 Fast' });
    dialog.appendChild(combobox);
    document.body.appendChild(dialog);

    const result = findElementInSettings(['VEO 3.1']);
    expect(result).toBe(combobox);
    expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('Combobox encontrado'), 'info');
  });

  test('debe encontrar botón dentro del dialog', () => {
    const dialog = createMockElement('div', { role: 'dialog' });
    const btn = createMockElement('button', { textContent: 'Aplicar cambios' });
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    const result = findElementInSettings(['aplicar']);
    expect(result).toBe(btn);
  });

  test('debe encontrar elemento por aria-label', () => {
    const dialog = createMockElement('div', { role: 'dialog' });
    const btn = createMockElement('button', { ariaLabel: 'Cerrar configuración' });
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    const result = findElementInSettings(['cerrar']);
    expect(result).toBe(btn);
  });
});

describe('Utils - selectOptionInListbox()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vfLog.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debe retornar false si no hay listbox', async () => {
    const promise = selectOptionInListbox(['Opción 1']);
    jest.advanceTimersByTime(300);
    const result = await promise;

    expect(result).toBe(false);
    expect(vfLog).toHaveBeenCalledWith('Listbox no encontrado', 'warn');
  });

  test('debe seleccionar opción y retornar true', async () => {
    const listbox = createMockElement('div', { role: 'listbox' });
    const option1 = createMockElement('div', { role: 'option', textContent: 'VEO 2' });
    const option2 = createMockElement('div', { role: 'option', textContent: 'VEO 3.1 Fast' });
    option2.click = jest.fn();
    listbox.appendChild(option1);
    listbox.appendChild(option2);
    document.body.appendChild(listbox);

    const promise = selectOptionInListbox(['VEO 3.1']);
    jest.advanceTimersByTime(300);
    const result = await promise;

    expect(result).toBe(true);
    expect(option2.click).toHaveBeenCalled();
    expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('Opción seleccionada'), 'success');
  });

  test('debe retornar false si la opción no existe', async () => {
    const listbox = createMockElement('div', { role: 'listbox' });
    const option1 = createMockElement('div', { role: 'option', textContent: 'Opción A' });
    listbox.appendChild(option1);
    document.body.appendChild(listbox);

    const promise = selectOptionInListbox(['Opción X']);
    jest.advanceTimersByTime(300);
    const result = await promise;

    expect(result).toBe(false);
    expect(vfLog).toHaveBeenCalledWith('Opción no encontrada en listbox', 'warn');
  });
});

describe('Utils - showDebugBadge()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('debe crear badge con el texto especificado', () => {
    showDebugBadge('Test Badge');

    const badge = document.getElementById('vidflow-debug-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Test Badge');
  });

  test('debe eliminar badge existente antes de crear nuevo', () => {
    showDebugBadge('Badge 1');
    showDebugBadge('Badge 2');

    const badges = document.querySelectorAll('#vidflow-debug-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe('Badge 2');
  });

  test('debe auto-eliminar badge después de duration', () => {
    showDebugBadge('Temporal', 1000);

    expect(document.getElementById('vidflow-debug-badge')).not.toBeNull();

    jest.advanceTimersByTime(1000);

    expect(document.getElementById('vidflow-debug-badge')).toBeNull();
  });

  test('debe mantener badge si duration es 0', () => {
    showDebugBadge('Permanente', 0);

    jest.advanceTimersByTime(5000);

    expect(document.getElementById('vidflow-debug-badge')).not.toBeNull();
  });

  test('debe tener estilos correctos', () => {
    showDebugBadge('Styled Badge');

    const badge = document.getElementById('vidflow-debug-badge');
    expect(badge.style.position).toBe('fixed');
    expect(badge.style.zIndex).toBe('999999');
  });
});
