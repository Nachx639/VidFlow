/**
 * Tests para lib/analyzer.js
 * PromptAnalyzer - Analizador de prompts
 */

// Implementación de PromptAnalyzer para testing
class PromptAnalyzer {
  constructor() {
    this.brunoKeywords = ['bruno', 'bear', 'oso'];
    this.pomponKeywords = ['pompón', 'pompon', 'bunny', 'conejo', 'rabbit'];
    this.blackboardKeywords = ['blackboard', 'pizarra', 'chalk', 'tiza'];
  }

  analyzePrompt(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    const hasBruno = this.brunoKeywords.some(kw => lowerPrompt.includes(kw));
    const hasPompon = this.pomponKeywords.some(kw => lowerPrompt.includes(kw));
    const hasBlackboard = this.blackboardKeywords.some(kw => lowerPrompt.includes(kw));

    let category;
    let referenceNeeded;

    if (hasBruno && hasPompon) {
      category = 'both';
      referenceNeeded = 'both';
    } else if (hasPompon) {
      category = 'pompon';
      referenceNeeded = 'pompon';
    } else if (hasBruno) {
      category = 'bruno';
      referenceNeeded = 'bruno';
    } else if (hasBlackboard) {
      category = 'blackboard';
      referenceNeeded = 'blackboard';
    } else {
      category = 'other';
      referenceNeeded = null;
    }

    const sceneMatch = prompt.match(/Objects:\s*([^.]+)/i);
    const actionMatch = prompt.match(/Action:\s*([^.]+)/i);

    return {
      category,
      referenceNeeded,
      hasBruno,
      hasPompon,
      hasBlackboard,
      scene: sceneMatch ? sceneMatch[1].trim() : '',
      action: actionMatch ? actionMatch[1].trim() : '',
      whiskPrompt: this.createWhiskPrompt(prompt),
      flowPrompt: prompt
    };
  }

  createWhiskPrompt(prompt) {
    let simplified = prompt;
    simplified = simplified.replace(/Bruno\s*\([^)]+\)/gi, 'Bruno');
    simplified = simplified.replace(/Pompón\s*\([^)]+\)/gi, 'Pompón');
    simplified = simplified.replace(/Pompon\s*\([^)]+\)/gi, 'Pompón');
    return simplified;
  }

  groupByReference(analysisResults) {
    const groups = {
      both: [],
      pompon: [],
      bruno: [],
      blackboard: [],
      other: []
    };

    analysisResults.forEach(result => {
      groups[result.category].push(result);
    });

    return groups;
  }

  createBatchOrder(analysisResults) {
    const batches = [];
    let currentBatch = null;

    analysisResults.forEach((result, index) => {
      if (!currentBatch || currentBatch.reference !== result.referenceNeeded) {
        currentBatch = {
          reference: result.referenceNeeded,
          items: []
        };
        batches.push(currentBatch);
      }
      currentBatch.items.push({
        ...result,
        originalIndex: index
      });
    });

    return batches;
  }
}

// ========== TESTS ==========

describe('PromptAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new PromptAnalyzer();
  });

  describe('constructor', () => {
    test('debe inicializar keywords correctamente', () => {
      expect(analyzer.brunoKeywords).toContain('bruno');
      expect(analyzer.brunoKeywords).toContain('bear');
      expect(analyzer.pomponKeywords).toContain('pompón');
      expect(analyzer.pomponKeywords).toContain('bunny');
      expect(analyzer.blackboardKeywords).toContain('blackboard');
      expect(analyzer.blackboardKeywords).toContain('pizarra');
    });
  });

  describe('analyzePrompt() - Detección de categorías', () => {
    test('debe detectar Bruno por keyword "bruno"', () => {
      const result = analyzer.analyzePrompt('Bruno walks in the park');
      expect(result.category).toBe('bruno');
      expect(result.hasBruno).toBe(true);
      expect(result.hasPompon).toBe(false);
      expect(result.referenceNeeded).toBe('bruno');
    });

    test('debe detectar Bruno por keyword "bear"', () => {
      const result = analyzer.analyzePrompt('A friendly bear playing with toys');
      expect(result.category).toBe('bruno');
      expect(result.hasBruno).toBe(true);
    });

    test('debe detectar Bruno por keyword "oso"', () => {
      const result = analyzer.analyzePrompt('Un oso pequeño en el bosque');
      expect(result.category).toBe('bruno');
      expect(result.hasBruno).toBe(true);
    });

    test('debe detectar Pompón por keyword "pompón"', () => {
      const result = analyzer.analyzePrompt('Pompón saltando en el jardín');
      expect(result.category).toBe('pompon');
      expect(result.hasPompon).toBe(true);
      expect(result.referenceNeeded).toBe('pompon');
    });

    test('debe detectar Pompón por keyword "pompon" (sin acento)', () => {
      const result = analyzer.analyzePrompt('Pompon playing happily');
      expect(result.category).toBe('pompon');
      expect(result.hasPompon).toBe(true);
    });

    test('debe detectar Pompón por keyword "bunny"', () => {
      const result = analyzer.analyzePrompt('A cute bunny hopping around');
      expect(result.category).toBe('pompon');
      expect(result.hasPompon).toBe(true);
    });

    test('debe detectar Pompón por keyword "conejo"', () => {
      const result = analyzer.analyzePrompt('El conejo come zanahorias');
      expect(result.category).toBe('pompon');
      expect(result.hasPompon).toBe(true);
    });

    test('debe detectar "both" cuando tiene Bruno y Pompón', () => {
      const result = analyzer.analyzePrompt('Bruno and Pompón play together');
      expect(result.category).toBe('both');
      expect(result.hasBruno).toBe(true);
      expect(result.hasPompon).toBe(true);
      expect(result.referenceNeeded).toBe('both');
    });

    test('debe detectar blackboard', () => {
      const result = analyzer.analyzePrompt('Text on a blackboard says hello');
      expect(result.category).toBe('blackboard');
      expect(result.hasBlackboard).toBe(true);
      expect(result.referenceNeeded).toBe('blackboard');
    });

    test('debe detectar blackboard por "pizarra"', () => {
      const result = analyzer.analyzePrompt('Escrito en la pizarra: 2+2=4');
      expect(result.category).toBe('blackboard');
      expect(result.hasBlackboard).toBe(true);
    });

    test('debe detectar blackboard por "chalk"', () => {
      const result = analyzer.analyzePrompt('Drawing with chalk on the board');
      expect(result.category).toBe('blackboard');
      expect(result.hasBlackboard).toBe(true);
    });

    test('debe categorizar como "other" si no hay keywords', () => {
      const result = analyzer.analyzePrompt('A beautiful sunset over the ocean');
      expect(result.category).toBe('other');
      expect(result.hasBruno).toBe(false);
      expect(result.hasPompon).toBe(false);
      expect(result.hasBlackboard).toBe(false);
      expect(result.referenceNeeded).toBeNull();
    });

    test('debe ser case insensitive', () => {
      const result1 = analyzer.analyzePrompt('BRUNO walks');
      const result2 = analyzer.analyzePrompt('bruno walks');
      const result3 = analyzer.analyzePrompt('Bruno walks');

      expect(result1.hasBruno).toBe(true);
      expect(result2.hasBruno).toBe(true);
      expect(result3.hasBruno).toBe(true);
    });
  });

  describe('analyzePrompt() - Extracción de metadatos', () => {
    test('debe extraer scene de "Objects:"', () => {
      const result = analyzer.analyzePrompt('Objects: trees, flowers, and clouds. Bruno plays.');
      expect(result.scene).toBe('trees, flowers, and clouds');
    });

    test('debe extraer action de "Action:"', () => {
      const result = analyzer.analyzePrompt('Action: jumping and running. Bruno is happy.');
      expect(result.action).toBe('jumping and running');
    });

    test('debe manejar prompt sin Objects ni Action', () => {
      const result = analyzer.analyzePrompt('Bruno plays in the park');
      expect(result.scene).toBe('');
      expect(result.action).toBe('');
    });

    test('debe mantener el flowPrompt original', () => {
      const prompt = 'Bruno (a cute bear) plays with Pompón';
      const result = analyzer.analyzePrompt(prompt);
      expect(result.flowPrompt).toBe(prompt);
    });
  });

  describe('createWhiskPrompt()', () => {
    test('debe simplificar descripción de Bruno', () => {
      const input = 'Bruno (a cute brown bear with big eyes) walks';
      const result = analyzer.createWhiskPrompt(input);
      expect(result).toBe('Bruno walks');
    });

    test('debe simplificar descripción de Pompón', () => {
      const input = 'Pompón (a fluffy white bunny) jumps';
      const result = analyzer.createWhiskPrompt(input);
      expect(result).toBe('Pompón jumps');
    });

    test('debe simplificar Pompon sin acento', () => {
      const input = 'Pompon (a cute bunny) plays';
      const result = analyzer.createWhiskPrompt(input);
      expect(result).toBe('Pompón plays');
    });

    test('debe manejar múltiples personajes', () => {
      const input = 'Bruno (big bear) and Pompón (small bunny) together';
      const result = analyzer.createWhiskPrompt(input);
      expect(result).toBe('Bruno and Pompón together');
    });

    test('debe no modificar prompt sin descripciones entre paréntesis', () => {
      const input = 'Bruno walks in the forest';
      const result = analyzer.createWhiskPrompt(input);
      expect(result).toBe('Bruno walks in the forest');
    });
  });

  describe('groupByReference()', () => {
    test('debe agrupar resultados por categoría', () => {
      const results = [
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'pompon', referenceNeeded: 'pompon' },
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'both', referenceNeeded: 'both' },
        { category: 'other', referenceNeeded: null },
      ];

      const groups = analyzer.groupByReference(results);

      expect(groups.bruno.length).toBe(2);
      expect(groups.pompon.length).toBe(1);
      expect(groups.both.length).toBe(1);
      expect(groups.other.length).toBe(1);
      expect(groups.blackboard.length).toBe(0);
    });

    test('debe manejar lista vacía', () => {
      const groups = analyzer.groupByReference([]);

      expect(groups.bruno).toEqual([]);
      expect(groups.pompon).toEqual([]);
      expect(groups.both).toEqual([]);
      expect(groups.blackboard).toEqual([]);
      expect(groups.other).toEqual([]);
    });
  });

  describe('createBatchOrder()', () => {
    test('debe crear batches consecutivos por referencia', () => {
      const results = [
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'pompon', referenceNeeded: 'pompon' },
        { category: 'pompon', referenceNeeded: 'pompon' },
        { category: 'bruno', referenceNeeded: 'bruno' },
      ];

      const batches = analyzer.createBatchOrder(results);

      expect(batches.length).toBe(3);
      expect(batches[0].reference).toBe('bruno');
      expect(batches[0].items.length).toBe(2);
      expect(batches[1].reference).toBe('pompon');
      expect(batches[1].items.length).toBe(2);
      expect(batches[2].reference).toBe('bruno');
      expect(batches[2].items.length).toBe(1);
    });

    test('debe preservar originalIndex', () => {
      const results = [
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'pompon', referenceNeeded: 'pompon' },
        { category: 'other', referenceNeeded: null },
      ];

      const batches = analyzer.createBatchOrder(results);

      expect(batches[0].items[0].originalIndex).toBe(0);
      expect(batches[1].items[0].originalIndex).toBe(1);
      expect(batches[2].items[0].originalIndex).toBe(2);
    });

    test('debe manejar todos con la misma referencia', () => {
      const results = [
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'bruno', referenceNeeded: 'bruno' },
      ];

      const batches = analyzer.createBatchOrder(results);

      expect(batches.length).toBe(1);
      expect(batches[0].items.length).toBe(3);
    });

    test('debe manejar todos diferentes', () => {
      const results = [
        { category: 'bruno', referenceNeeded: 'bruno' },
        { category: 'pompon', referenceNeeded: 'pompon' },
        { category: 'blackboard', referenceNeeded: 'blackboard' },
        { category: 'other', referenceNeeded: null },
      ];

      const batches = analyzer.createBatchOrder(results);

      expect(batches.length).toBe(4);
    });

    test('debe manejar lista vacía', () => {
      const batches = analyzer.createBatchOrder([]);
      expect(batches).toEqual([]);
    });
  });

  describe('Integración - Flujo completo', () => {
    test('debe analizar múltiples prompts y organizarlos', () => {
      const prompts = [
        'Bruno (cute bear) walks in the forest',
        'Pompón (fluffy bunny) jumps over flowers',
        'Bruno and Pompón play together',
        'A beautiful sunset over the ocean',
        'Text on a blackboard: Hello World',
      ];

      const analysisResults = prompts.map(p => analyzer.analyzePrompt(p));
      const groups = analyzer.groupByReference(analysisResults);
      const batches = analyzer.createBatchOrder(analysisResults);

      // Verificar análisis individual
      expect(analysisResults[0].category).toBe('bruno');
      expect(analysisResults[1].category).toBe('pompon');
      expect(analysisResults[2].category).toBe('both');
      expect(analysisResults[3].category).toBe('other');
      expect(analysisResults[4].category).toBe('blackboard');

      // Verificar grupos
      expect(groups.bruno.length).toBe(1);
      expect(groups.pompon.length).toBe(1);
      expect(groups.both.length).toBe(1);
      expect(groups.other.length).toBe(1);
      expect(groups.blackboard.length).toBe(1);

      // Verificar batches (cada uno diferente = 5 batches)
      expect(batches.length).toBe(5);
    });
  });
});
