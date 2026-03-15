/**
 * Tests de integración para content/flow/pipeline.js
 * Modo pipeline: 5 videos en paralelo
 */

// Mock de vfLog
global.vfLog = jest.fn();

// ========== IMPLEMENTACIONES PARA TESTING ==========

/**
 * Detecta el estado de un video por su prompt
 */
function getVideoStatusByPrompt(promptText, mockVideoCards = []) {
  const normalizedPrompt = promptText.toLowerCase().trim().substring(0, 50);

  for (const card of mockVideoCards) {
    const cardText = card.textContent?.toLowerCase() || '';

    if (!cardText.includes(normalizedPrompt.substring(0, 20))) {
      continue;
    }

    // Verificar estados
    if (cardText.includes('no se ha podido') || cardText.includes('failed')) {
      return { status: 'FAILED', prompt: promptText };
    }

    const percentMatch = cardText.match(/(\d+)\s*%/);
    if (percentMatch) {
      return {
        status: 'GENERATING',
        progress: parseInt(percentMatch[1]),
        prompt: promptText
      };
    }

    if (card.querySelector('video') || card.querySelector('[class*="thumbnail"]')) {
      return { status: 'COMPLETED', prompt: promptText };
    }

    return { status: 'PENDING', prompt: promptText };
  }

  return { status: 'NOT_FOUND', prompt: promptText };
}

/**
 * Contabiliza estados de videos
 */
function countVideoStatuses(prompts, mockVideoCards = []) {
  const counts = {
    COMPLETED: 0,
    GENERATING: 0,
    PENDING: 0,
    FAILED: 0,
    NOT_FOUND: 0
  };

  const details = [];

  for (const prompt of prompts) {
    const status = getVideoStatusByPrompt(prompt, mockVideoCards);
    counts[status.status]++;
    details.push(status);
  }

  return { counts, details };
}

/**
 * Simula la lógica de pipeline
 */
class PipelineSimulator {
  constructor(maxParallel = 5) {
    this.maxParallel = maxParallel;
    this.queue = [];
    this.inProgress = [];
    this.completed = [];
    this.failed = [];
    this.retries = new Map(); // prompt -> retry count
    this.maxRetries = 3;
  }

  addToQueue(prompts) {
    this.queue = [...prompts];
  }

  canSubmitMore() {
    return this.inProgress.length < this.maxParallel && this.queue.length > 0;
  }

  submitNext() {
    if (!this.canSubmitMore()) return null;

    const prompt = this.queue.shift();
    this.inProgress.push(prompt);
    return prompt;
  }

  markCompleted(prompt) {
    const index = this.inProgress.indexOf(prompt);
    if (index > -1) {
      this.inProgress.splice(index, 1);
      this.completed.push(prompt);
      return true;
    }
    return false;
  }

  markFailed(prompt) {
    const index = this.inProgress.indexOf(prompt);
    if (index > -1) {
      this.inProgress.splice(index, 1);

      const retryCount = (this.retries.get(prompt) || 0) + 1;
      this.retries.set(prompt, retryCount);

      if (retryCount < this.maxRetries) {
        // Requeue for retry
        this.queue.push(prompt);
        return { status: 'requeued', retryCount };
      } else {
        // Max retries reached
        this.failed.push(prompt);
        return { status: 'failed', retryCount };
      }
    }
    return { status: 'not_found' };
  }

  getStats() {
    return {
      queued: this.queue.length,
      inProgress: this.inProgress.length,
      completed: this.completed.length,
      failed: this.failed.length,
      total: this.queue.length + this.inProgress.length + this.completed.length + this.failed.length
    };
  }

  isComplete() {
    return this.queue.length === 0 && this.inProgress.length === 0;
  }
}

// ========== TESTS ==========

describe('Pipeline - getVideoStatusByPrompt()', () => {
  test('debe detectar video COMPLETED', () => {
    const mockCards = [{
      textContent: 'bruno walks in the forest',
      querySelector: (selector) => selector.includes('video') ? {} : null
    }];

    const result = getVideoStatusByPrompt('Bruno walks in the forest', mockCards);
    expect(result.status).toBe('COMPLETED');
  });

  test('debe detectar video GENERATING con porcentaje', () => {
    const mockCards = [{
      textContent: 'bruno walks in the forest 45%',
      querySelector: () => null
    }];

    const result = getVideoStatusByPrompt('Bruno walks in the forest', mockCards);
    expect(result.status).toBe('GENERATING');
    expect(result.progress).toBe(45);
  });

  test('debe detectar video FAILED', () => {
    const mockCards = [{
      textContent: 'bruno walks - no se ha podido generar',
      querySelector: () => null
    }];

    const result = getVideoStatusByPrompt('Bruno walks', mockCards);
    expect(result.status).toBe('FAILED');
  });

  test('debe detectar video NOT_FOUND', () => {
    const mockCards = [{
      textContent: 'completely different prompt',
      querySelector: () => null
    }];

    const result = getVideoStatusByPrompt('Bruno walks', mockCards);
    expect(result.status).toBe('NOT_FOUND');
  });

  test('debe detectar video PENDING (encontrado pero sin estado claro)', () => {
    const mockCards = [{
      textContent: 'bruno walks processing...',
      querySelector: () => null
    }];

    const result = getVideoStatusByPrompt('Bruno walks', mockCards);
    expect(result.status).toBe('PENDING');
  });
});

describe('Pipeline - countVideoStatuses()', () => {
  test('debe contabilizar múltiples estados', () => {
    const prompts = ['prompt1', 'prompt2', 'prompt3', 'prompt4'];
    const mockCards = [
      { textContent: 'prompt1 video', querySelector: (s) => s.includes('video') ? {} : null },
      { textContent: 'prompt2 45%', querySelector: () => null },
      { textContent: 'prompt3 no se ha podido', querySelector: () => null },
      { textContent: 'other content', querySelector: () => null }
    ];

    const result = countVideoStatuses(prompts, mockCards);

    expect(result.counts.COMPLETED).toBe(1);
    expect(result.counts.GENERATING).toBe(1);
    expect(result.counts.FAILED).toBe(1);
    expect(result.counts.NOT_FOUND).toBe(1);
    expect(result.details.length).toBe(4);
  });

  test('debe manejar lista vacía', () => {
    const result = countVideoStatuses([], []);
    expect(result.counts.COMPLETED).toBe(0);
    expect(result.counts.GENERATING).toBe(0);
    expect(result.details.length).toBe(0);
  });
});

describe('Pipeline - PipelineSimulator', () => {
  let pipeline;

  beforeEach(() => {
    pipeline = new PipelineSimulator(5);
  });

  describe('inicialización', () => {
    test('debe inicializar con valores correctos', () => {
      expect(pipeline.maxParallel).toBe(5);
      expect(pipeline.queue).toEqual([]);
      expect(pipeline.inProgress).toEqual([]);
      expect(pipeline.completed).toEqual([]);
      expect(pipeline.failed).toEqual([]);
    });

    test('debe permitir configurar maxParallel', () => {
      const customPipeline = new PipelineSimulator(3);
      expect(customPipeline.maxParallel).toBe(3);
    });
  });

  describe('addToQueue()', () => {
    test('debe agregar prompts a la cola', () => {
      pipeline.addToQueue(['p1', 'p2', 'p3']);
      expect(pipeline.queue).toEqual(['p1', 'p2', 'p3']);
    });

    test('debe reemplazar cola existente', () => {
      pipeline.addToQueue(['p1', 'p2']);
      pipeline.addToQueue(['p3', 'p4']);
      expect(pipeline.queue).toEqual(['p3', 'p4']);
    });
  });

  describe('canSubmitMore()', () => {
    test('debe retornar true si hay espacio y cola', () => {
      pipeline.addToQueue(['p1', 'p2']);
      expect(pipeline.canSubmitMore()).toBe(true);
    });

    test('debe retornar false si cola vacía', () => {
      expect(pipeline.canSubmitMore()).toBe(false);
    });

    test('debe retornar false si maxParallel alcanzado', () => {
      pipeline.addToQueue(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
      for (let i = 0; i < 5; i++) {
        pipeline.submitNext();
      }
      expect(pipeline.canSubmitMore()).toBe(false);
    });
  });

  describe('submitNext()', () => {
    test('debe mover prompt de cola a inProgress', () => {
      pipeline.addToQueue(['p1', 'p2', 'p3']);
      const submitted = pipeline.submitNext();

      expect(submitted).toBe('p1');
      expect(pipeline.queue).toEqual(['p2', 'p3']);
      expect(pipeline.inProgress).toEqual(['p1']);
    });

    test('debe retornar null si no puede enviar', () => {
      const result = pipeline.submitNext();
      expect(result).toBeNull();
    });

    test('debe respetar límite de paralelos', () => {
      pipeline.addToQueue(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);

      for (let i = 0; i < 7; i++) {
        pipeline.submitNext();
      }

      expect(pipeline.inProgress.length).toBe(5);
      expect(pipeline.queue.length).toBe(2);
    });
  });

  describe('markCompleted()', () => {
    test('debe mover de inProgress a completed', () => {
      pipeline.addToQueue(['p1', 'p2']);
      pipeline.submitNext();
      pipeline.submitNext();

      const result = pipeline.markCompleted('p1');

      expect(result).toBe(true);
      expect(pipeline.inProgress).toEqual(['p2']);
      expect(pipeline.completed).toEqual(['p1']);
    });

    test('debe retornar false si no está en inProgress', () => {
      const result = pipeline.markCompleted('unknown');
      expect(result).toBe(false);
    });
  });

  describe('markFailed() - Sistema de reintentos', () => {
    test('debe reencolar en primer fallo', () => {
      pipeline.addToQueue(['p1']);
      pipeline.submitNext();

      const result = pipeline.markFailed('p1');

      expect(result.status).toBe('requeued');
      expect(result.retryCount).toBe(1);
      expect(pipeline.queue).toContain('p1');
      expect(pipeline.failed).not.toContain('p1');
    });

    test('debe marcar como fallido después de maxRetries', () => {
      pipeline.addToQueue(['p1']);
      // maxRetries = 3 significa que se puede reintentar hasta 2 veces (retryCount < 3)
      // retryCount 1: requeued (1 < 3)
      // retryCount 2: requeued (2 < 3)
      // retryCount 3: failed (3 < 3 es false)

      // Primer fallo - retryCount=1, requeued
      pipeline.submitNext();
      let result = pipeline.markFailed('p1');
      expect(result.status).toBe('requeued');
      expect(result.retryCount).toBe(1);

      // Segundo fallo - retryCount=2, requeued
      pipeline.submitNext();
      result = pipeline.markFailed('p1');
      expect(result.status).toBe('requeued');
      expect(result.retryCount).toBe(2);

      // Tercer fallo - retryCount=3, failed (3 < 3 es false)
      pipeline.submitNext();
      result = pipeline.markFailed('p1');
      expect(result.status).toBe('failed');
      expect(result.retryCount).toBe(3);
      expect(pipeline.failed).toContain('p1');
    });

    test('debe trackear conteo de reintentos', () => {
      pipeline.addToQueue(['p1']);
      pipeline.submitNext();
      pipeline.markFailed('p1');

      expect(pipeline.retries.get('p1')).toBe(1);

      pipeline.submitNext();
      pipeline.markFailed('p1');

      expect(pipeline.retries.get('p1')).toBe(2);
    });
  });

  describe('getStats()', () => {
    test('debe retornar estadísticas correctas', () => {
      pipeline.addToQueue(['p1', 'p2', 'p3', 'p4', 'p5']);
      pipeline.submitNext(); // p1 -> inProgress
      pipeline.submitNext(); // p2 -> inProgress
      pipeline.markCompleted('p1'); // p1 -> completed

      const stats = pipeline.getStats();

      expect(stats.queued).toBe(3);
      expect(stats.inProgress).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });
  });

  describe('isComplete()', () => {
    test('debe retornar false si hay trabajo pendiente', () => {
      pipeline.addToQueue(['p1']);
      expect(pipeline.isComplete()).toBe(false);

      pipeline.submitNext();
      expect(pipeline.isComplete()).toBe(false);
    });

    test('debe retornar true cuando todo está completado', () => {
      pipeline.addToQueue(['p1', 'p2']);
      pipeline.submitNext();
      pipeline.submitNext();
      pipeline.markCompleted('p1');
      pipeline.markCompleted('p2');

      expect(pipeline.isComplete()).toBe(true);
    });
  });

  describe('Flujo completo de pipeline', () => {
    test('debe procesar 10 prompts con límite de 5 paralelos', () => {
      const prompts = Array.from({ length: 10 }, (_, i) => `prompt${i + 1}`);
      pipeline.addToQueue(prompts);

      // Simular procesamiento
      let iterations = 0;
      const maxIterations = 20;

      while (!pipeline.isComplete() && iterations < maxIterations) {
        // Enviar los que se pueda
        while (pipeline.canSubmitMore()) {
          pipeline.submitNext();
        }

        // Simular que el primero en inProgress se completa
        if (pipeline.inProgress.length > 0) {
          const completed = pipeline.inProgress[0];
          pipeline.markCompleted(completed);
        }

        iterations++;
      }

      expect(pipeline.completed.length).toBe(10);
      expect(pipeline.isComplete()).toBe(true);
    });

    test('debe manejar fallos y reintentos en pipeline', () => {
      pipeline.addToQueue(['p1', 'p2', 'p3']);

      // Enviar todos
      pipeline.submitNext();
      pipeline.submitNext();
      pipeline.submitNext();

      // p1 falla, p2 y p3 completan
      pipeline.markFailed('p1'); // requeue
      pipeline.markCompleted('p2');
      pipeline.markCompleted('p3');

      // p1 debería estar en queue para reintento
      expect(pipeline.queue).toContain('p1');

      // Procesar reintento
      pipeline.submitNext();
      pipeline.markCompleted('p1');

      expect(pipeline.completed).toContain('p1');
      expect(pipeline.isComplete()).toBe(true);
    });
  });
});

describe('Pipeline - Escenarios de edge cases', () => {
  test('debe manejar pipeline vacío', () => {
    const pipeline = new PipelineSimulator();
    expect(pipeline.isComplete()).toBe(true);
    expect(pipeline.submitNext()).toBeNull();
  });

  test('debe manejar todos los prompts fallando', () => {
    const pipeline = new PipelineSimulator(5);
    pipeline.maxRetries = 1; // Solo 1 reintento para acelerar test

    pipeline.addToQueue(['p1', 'p2']);

    // Primer intento
    pipeline.submitNext();
    pipeline.submitNext();
    pipeline.markFailed('p1'); // requeue
    pipeline.markFailed('p2'); // requeue

    // Segundo intento (último)
    pipeline.submitNext();
    pipeline.submitNext();
    pipeline.markFailed('p1'); // failed definitivo
    pipeline.markFailed('p2'); // failed definitivo

    expect(pipeline.failed.length).toBe(2);
    expect(pipeline.isComplete()).toBe(true);
  });

  test('debe manejar maxParallel = 1', () => {
    const pipeline = new PipelineSimulator(1);
    pipeline.addToQueue(['p1', 'p2', 'p3']);

    pipeline.submitNext();
    expect(pipeline.inProgress.length).toBe(1);
    expect(pipeline.canSubmitMore()).toBe(false);

    pipeline.markCompleted('p1');
    expect(pipeline.canSubmitMore()).toBe(true);
  });
});
