/**
 * Tests para content/flow/settings.js
 * Configuración de ajustes de video
 */

// Mocks globales
global.vfLog = jest.fn();
global.sleep = jest.fn(() => Promise.resolve());
global.findElement = jest.fn();
global.findElementInSettings = jest.fn();
global.selectOptionInListbox = jest.fn();

// Simular MODEL_TEXTS (de selectors.js)
global.MODEL_TEXTS = {
  'veo-3.1-fast': ['Veo 3.1 - Fast', '3.1 - Fast', 'Veo 3.1'],
  'veo-3.1-quality': ['Veo 3.1 - Quality', '3.1 - Quality'],
  'veo-2-fast': ['Veo 2 - Fast', '2 - Fast'],
  'veo-2-quality': ['Veo 2 - Quality', '2 - Quality']
};

// Cargar el módulo
const fs = require('fs');
const path = require('path');
const settingsCode = fs.readFileSync(
  path.join(__dirname, '../../content/flow/settings.js'),
  'utf8'
);

eval(settingsCode);

describe('settings.js - configureSettings()', () => {
  let mockSettingsBtn;

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();

    mockSettingsBtn = document.createElement('button');
    mockSettingsBtn.textContent = 'tune Ajustes';
    mockSettingsBtn.click = jest.fn();
    document.body.appendChild(mockSettingsBtn);
  });

  test('debe abrir panel de ajustes si encuentra botón', async () => {
    await configureSettings({});

    expect(mockSettingsBtn.click).toHaveBeenCalled();
    expect(vfLog).toHaveBeenCalledWith('Abriendo panel de ajustes...', 'info');
  });

  test('debe loguear warning si no encuentra botón', async () => {
    document.body.innerHTML = ''; // Sin botón

    await configureSettings({});

    expect(vfLog).toHaveBeenCalledWith(
      'Botón de ajustes no encontrado, usando valores por defecto',
      'warn'
    );
  });

  test('debe configurar modelo si se especifica', async () => {
    findElementInSettings.mockReturnValue({
      click: jest.fn()
    });
    selectOptionInListbox.mockResolvedValue(true);

    await configureSettings({ veoModel: 'veo-3.1-fast' });

    expect(vfLog).toHaveBeenCalledWith('  - Modelo: veo-3.1-fast', 'info');
  });

  test('debe configurar aspect ratio si se especifica', async () => {
    findElementInSettings.mockReturnValue({
      click: jest.fn()
    });
    selectOptionInListbox.mockResolvedValue(true);

    await configureSettings({ aspectRatio: '16:9' });

    expect(vfLog).toHaveBeenCalledWith('  - Orientación: 16:9', 'info');
  });

  test('debe configurar resultados por petición si se especifica', async () => {
    findElementInSettings.mockReturnValue({
      click: jest.fn()
    });
    selectOptionInListbox.mockResolvedValue(true);

    await configureSettings({ resultsPerRequest: 2 });

    expect(vfLog).toHaveBeenCalledWith('  - Resultados por petición: 2', 'info');
  });

  test('debe cerrar panel al finalizar', async () => {
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'tune';
    closeBtn.click = jest.fn();
    document.body.appendChild(closeBtn);

    await configureSettings({});

    expect(vfLog).toHaveBeenCalledWith('Panel cerrado con botón toggle', 'success');
  });

  test('debe cerrar con click en textarea si no hay botón de cierre', async () => {
    // Solo el botón de ajustes inicial
    document.body.innerHTML = '';
    const settingsBtn = document.createElement('button');
    settingsBtn.textContent = 'tune';
    settingsBtn.click = jest.fn();
    document.body.appendChild(settingsBtn);

    const textarea = document.createElement('textarea');
    textarea.click = jest.fn();
    document.body.appendChild(textarea);

    // El segundo querySelectorAll no encuentra botón de cierre
    const originalQuerySelectorAll = document.querySelectorAll.bind(document);
    let callCount = 0;
    jest.spyOn(document, 'querySelectorAll').mockImplementation((selector) => {
      callCount++;
      if (selector === 'button' && callCount > 1) {
        return []; // No encuentra botón para cerrar
      }
      return originalQuerySelectorAll(selector);
    });

    await configureSettings({});

    document.querySelectorAll.mockRestore();
  });
});

describe('settings.js - setAspectRatio()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('debe buscar dropdown de orientación', async () => {
    findElementInSettings.mockReturnValue(null);

    await setAspectRatio('16:9');

    expect(findElementInSettings).toHaveBeenCalledWith([
      'Horizontal', 'Vertical', '16:9', '9:16'
    ]);
  });

  test('debe loguear warning si no encuentra dropdown', async () => {
    findElementInSettings.mockReturnValue(null);

    await setAspectRatio('16:9');

    expect(vfLog).toHaveBeenCalledWith('  Dropdown de orientación no encontrado', 'warn');
  });

  test('debe seleccionar Horizontal para 16:9', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await setAspectRatio('16:9');

    expect(mockDropdown.click).toHaveBeenCalled();
    expect(selectOptionInListbox).toHaveBeenCalledWith(['Horizontal', '16:9']);
  });

  test('debe seleccionar Vertical para 9:16', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await setAspectRatio('9:16');

    expect(selectOptionInListbox).toHaveBeenCalledWith(['Vertical', '9:16']);
  });

  test('debe loguear success cuando se configura', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await setAspectRatio('16:9');

    expect(vfLog).toHaveBeenCalledWith('  Orientación configurada: 16:9', 'success');
  });
});

describe('settings.js - setResultsPerRequest()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  test('debe loguear warning si no encuentra panel de ajustes (dialog)', async () => {
    // No dialog in DOM
    await setResultsPerRequest(2);

    expect(vfLog).toHaveBeenCalledWith('  Panel de ajustes no encontrado', 'warn');
  });

  test('debe loguear warning si no encuentra combobox de resultados', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    // combobox with unrelated text
    const cb = document.createElement('div');
    cb.setAttribute('role', 'combobox');
    cb.textContent = 'Modelo';
    dialog.appendChild(cb);
    document.body.appendChild(dialog);

    await setResultsPerRequest(1);

    expect(vfLog).toHaveBeenCalledWith('  Dropdown de resultados no encontrado', 'warn');
  });

  test('debe seleccionar opción correcta', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const cb = document.createElement('div');
    cb.setAttribute('role', 'combobox');
    cb.textContent = 'Resultados por petición';
    cb.click = jest.fn();
    dialog.appendChild(cb);
    document.body.appendChild(dialog);

    selectOptionInListbox.mockResolvedValue(true);

    await setResultsPerRequest(3);

    expect(cb.click).toHaveBeenCalled();
    expect(selectOptionInListbox).toHaveBeenCalledWith(['3']);
  });

  test('debe loguear success cuando se configura', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const cb = document.createElement('div');
    cb.setAttribute('role', 'combobox');
    cb.textContent = 'Resultados por petición';
    cb.click = jest.fn();
    dialog.appendChild(cb);
    document.body.appendChild(dialog);

    selectOptionInListbox.mockResolvedValue(true);

    await setResultsPerRequest(4);

    expect(vfLog).toHaveBeenCalledWith('  Resultados configurados: 4', 'success');
  });
});

describe('settings.js - setModel()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('debe buscar dropdown de modelo', async () => {
    findElementInSettings.mockReturnValue(null);

    await setModel('veo-3.1-fast');

    expect(findElementInSettings).toHaveBeenCalledWith(['Veo 3.1', 'Veo 2', 'Veo']);
  });

  test('debe loguear warning si no encuentra dropdown', async () => {
    findElementInSettings.mockReturnValue(null);

    await setModel('veo-3.1-fast');

    expect(vfLog).toHaveBeenCalledWith('  Dropdown de modelo no encontrado', 'warn');
  });

  test('debe seleccionar modelo Veo 3.1 Fast', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await setModel('veo-3.1-fast');

    expect(selectOptionInListbox).toHaveBeenCalledWith(MODEL_TEXTS['veo-3.1-fast']);
  });

  test('debe seleccionar modelo Veo 2 Quality', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await setModel('veo-2-quality');

    expect(selectOptionInListbox).toHaveBeenCalledWith(MODEL_TEXTS['veo-2-quality']);
  });

  test('debe usar modelo por defecto si modelId no existe', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await setModel('modelo-inexistente');

    // Debe usar veo-3.1-fast como fallback
    expect(selectOptionInListbox).toHaveBeenCalledWith(MODEL_TEXTS['veo-3.1-fast']);
  });

  test('debe loguear success cuando se configura', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await setModel('veo-3.1-quality');

    expect(vfLog).toHaveBeenCalledWith('  Modelo configurado: veo-3.1-quality', 'success');
  });
});

describe('settings.js - Flujo completo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();

    const settingsBtn = document.createElement('button');
    settingsBtn.textContent = 'tune';
    settingsBtn.click = jest.fn();
    document.body.appendChild(settingsBtn);
  });

  test('debe configurar múltiples ajustes', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await configureSettings({
      veoModel: 'veo-3.1-fast',
      aspectRatio: '9:16',
      resultsPerRequest: 2
    });

    // Debe haber configurado los tres
    expect(vfLog).toHaveBeenCalledWith('  - Modelo: veo-3.1-fast', 'info');
    expect(vfLog).toHaveBeenCalledWith('  - Orientación: 9:16', 'info');
    expect(vfLog).toHaveBeenCalledWith('  - Resultados por petición: 2', 'info');
    expect(vfLog).toHaveBeenCalledWith('Ajustes configurados', 'success');
  });

  test('debe manejar configuración parcial', async () => {
    const mockDropdown = { click: jest.fn() };
    findElementInSettings.mockReturnValue(mockDropdown);
    selectOptionInListbox.mockResolvedValue(true);

    await configureSettings({
      aspectRatio: '16:9'
      // Sin modelo ni resultados
    });

    expect(vfLog).toHaveBeenCalledWith('  - Orientación: 16:9', 'info');
    expect(vfLog).not.toHaveBeenCalledWith(expect.stringContaining('- Modelo:'), 'info');
  });
});
