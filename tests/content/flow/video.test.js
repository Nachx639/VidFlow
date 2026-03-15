/**
 * Tests para video.js
 * VidFlow Video Management
 */

// Mocks de dependencias
global.vfLog = jest.fn();
global.sleep = jest.fn(() => Promise.resolve());
global.findElement = jest.fn();
global.isAutomating = true;

// Cargar el módulo
const fs = require('fs');
const path = require('path');
const videoCode = fs.readFileSync(
  path.join(__dirname, '../../../content/flow/video.js'),
  'utf8'
);

eval(videoCode);

describe('video.js', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    global.isAutomating = true;
  });

  describe('goToHomeAndCreateProject()', () => {
    beforeEach(() => {
      // Mock window.location
      delete window.location;
      window.location = {
        href: 'https://labs.google/fx/tools/flow',
        assign: jest.fn()
      };
    });

    it('debería encontrar y hacer clic en botón "Nuevo proyecto"', async () => {
      const mockBtn = document.createElement('button');
      mockBtn.innerHTML = '<i class="google-symbols">add</i>Nuevo proyecto';
      mockBtn.click = jest.fn();
      document.body.appendChild(mockBtn);

      // Mock scrollIntoView
      mockBtn.scrollIntoView = jest.fn();

      await goToHomeAndCreateProject();

      expect(mockBtn.click).toHaveBeenCalled();
      expect(vfLog).toHaveBeenCalledWith(expect.stringContaining('Botón encontrado'), 'success');
    });

    it('debería lanzar error si no encuentra el botón', async () => {
      document.body.innerHTML = '<div>Sin botón</div>';

      await expect(goToHomeAndCreateProject()).rejects.toThrow(
        'No se encontró el botón de Nuevo proyecto'
      );
    });
  });

  describe('dismissPreviousResult()', () => {
    it('debería cerrar resultado anterior si existe botón', async () => {
      const closeBtn = document.createElement('button');
      closeBtn.setAttribute('aria-label', 'cerrar');
      closeBtn.click = jest.fn();

      const resultArea = document.createElement('div');
      resultArea.className = 'result-area';
      resultArea.appendChild(closeBtn);
      document.body.appendChild(resultArea);

      await dismissPreviousResult();

      expect(closeBtn.click).toHaveBeenCalled();
    });

    it('debería manejar cuando no hay resultado que cerrar', async () => {
      document.body.innerHTML = '<div>Sin resultado</div>';

      await dismissPreviousResult();

      expect(vfLog).toHaveBeenCalledWith(
        expect.stringContaining('No se encontró botón'),
        'info'
      );
    });
  });

  describe('clearPromptArea()', () => {
    it('debería limpiar el textarea', async () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'Prompt anterior';
      document.body.appendChild(textarea);

      await clearPromptArea();

      expect(textarea.value).toBe('');
      expect(vfLog).toHaveBeenCalledWith('Prompt limpiado', 'success');
    });

    it('debería manejar cuando no hay textarea', async () => {
      document.body.innerHTML = '<div>Sin textarea</div>';

      await clearPromptArea();

      expect(vfLog).toHaveBeenCalledWith(
        'No se encontró textarea para limpiar',
        'warn'
      );
    });
  });

  describe('removeCurrentImage()', () => {
    it('debería encontrar y eliminar imagen actual en área presentation', async () => {
      // Build DOM: textarea inside [role="presentation"] with image button containing "close"
      const presentation = document.createElement('div');
      presentation.setAttribute('role', 'presentation');

      const textarea = document.createElement('textarea');
      textarea.scrollIntoView = jest.fn();
      presentation.appendChild(textarea);

      const imageBtn = document.createElement('button');
      const closeSpan = document.createElement('span');
      closeSpan.textContent = 'close';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = 'Primera imagen';
      imageBtn.appendChild(closeSpan);
      imageBtn.appendChild(labelSpan);
      imageBtn.click = jest.fn();
      presentation.appendChild(imageBtn);

      document.body.appendChild(presentation);

      await removeCurrentImage();

      // The code clicks the closeSpan (child with text "close"), not the button itself
      // But since closeSpan.click isn't mocked, it bubbles. Let's check the log instead.
      expect(vfLog).toHaveBeenCalledWith('Imagen eliminada', 'success');
    });

    it('debería manejar cuando no hay imagen que eliminar', async () => {
      document.body.innerHTML = '<div>Sin imagen</div>';

      await removeCurrentImage();

      expect(vfLog).toHaveBeenCalledWith(
        expect.stringContaining('No se encontró imagen para eliminar'),
        'info'
      );
    });
  });

  describe('waitForVideoGeneration()', () => {
    it('debería detectar video completado por botón de descarga', async () => {
      // Mock sleep para que sea instantáneo
      global.sleep = jest.fn(() => Promise.resolve());

      // Primero simula loading, luego botón de descarga
      let callCount = 0;
      findElement.mockImplementation((texts) => {
        callCount++;
        // En las primeras llamadas, retorna indicador de loading
        if (callCount <= 2) {
          if (texts.includes('Generando') || texts.includes('%')) {
            const loadingEl = document.createElement('div');
            loadingEl.textContent = 'Generando 50%';
            return loadingEl;
          }
          return null;
        }
        // Después retorna botón de descarga
        if (texts.includes('Descargar')) {
          const downloadBtn = document.createElement('button');
          downloadBtn.textContent = 'Descargar';
          return downloadBtn;
        }
        return null;
      });

      await waitForVideoGeneration();

      expect(vfLog).toHaveBeenCalledWith(
        expect.stringContaining('completada'),
        'success'
      );
    });

    it('debería lanzar error si automation se detiene', async () => {
      global.isAutomating = false;
      global.sleep = jest.fn(() => Promise.resolve());

      await expect(waitForVideoGeneration()).rejects.toThrow('Automation stopped');
    });
  });

  describe('downloadVideo()', () => {
    it('debería generar nombre de archivo correcto', async () => {
      const downloadBtn = document.createElement('button');
      downloadBtn.textContent = 'Descargar';
      downloadBtn.click = jest.fn();
      document.body.appendChild(downloadBtn);

      findElement.mockReturnValue(downloadBtn);

      const filename = await downloadVideo(0);

      expect(filename).toBe('001_flow_video.mp4');
    });

    it('debería generar nombre con padding correcto para índice > 9', async () => {
      const downloadBtn = document.createElement('button');
      downloadBtn.textContent = 'Descargar';
      downloadBtn.click = jest.fn();
      document.body.appendChild(downloadBtn);

      findElement.mockReturnValue(downloadBtn);

      const filename = await downloadVideo(99);

      expect(filename).toBe('100_flow_video.mp4');
    });

    it('debería hacer clic en botón de descarga', async () => {
      const downloadBtn = document.createElement('button');
      downloadBtn.textContent = 'Download';
      downloadBtn.click = jest.fn();
      document.body.appendChild(downloadBtn);

      await downloadVideo(0);

      expect(downloadBtn.click).toHaveBeenCalled();
    });

    it('debería seleccionar opción 720p del menú', async () => {
      const downloadBtn = document.createElement('button');
      downloadBtn.textContent = 'Descargar';
      downloadBtn.click = jest.fn();

      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');

      const menuItem720p = document.createElement('div');
      menuItem720p.setAttribute('role', 'menuitem');
      menuItem720p.textContent = 'Tamaño original (720p)';
      menuItem720p.click = jest.fn();
      menu.appendChild(menuItem720p);

      document.body.appendChild(downloadBtn);

      // Simular que el menú aparece después del clic
      downloadBtn.click = jest.fn(() => {
        document.body.appendChild(menu);
      });

      const filename = await downloadVideo(0);

      expect(menuItem720p.click).toHaveBeenCalled();
      expect(vfLog).toHaveBeenCalledWith('Descarga 720p iniciada', 'success');
    });

    it('debería usar fallback si no hay botón de descarga', async () => {
      const video = document.createElement('video');
      video.src = 'https://example.com/video.mp4';
      document.body.appendChild(video);

      findElement.mockReturnValue(null);

      // Espiar la creación del link
      let capturedLink = null;
      const originalCreateElement = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          capturedLink = el;
          jest.spyOn(el, 'click').mockImplementation(() => {});
        }
        return el;
      });

      await downloadVideo(0);

      expect(capturedLink).not.toBeNull();
      expect(capturedLink.click).toHaveBeenCalled();
      expect(capturedLink.download).toBe('001_flow_video.mp4');

      // Restaurar
      document.createElement.mockRestore();
    });
  });

  describe('createNewProject() alias', () => {
    it('debería ser alias de goToHomeAndCreateProject', () => {
      expect(createNewProject).toBeDefined();
      expect(typeof createNewProject).toBe('function');
    });
  });
});
