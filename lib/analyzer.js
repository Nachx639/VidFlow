/**
 * VidFlow - Prompt Analyzer
 * Analyzes prompts to determine which reference images to use
 */

export class PromptAnalyzer {
  constructor() {
    // Keywords for detecting characters
    this.brunoKeywords = ['bruno', 'bear', 'oso'];
    this.pomponKeywords = ['pompón', 'pompon', 'bunny', 'conejo', 'rabbit'];
    this.blackboardKeywords = ['blackboard', 'pizarra', 'chalk', 'tiza'];
  }

  /**
   * Analyze a single prompt and determine its category
   * @param {string} prompt - The prompt text
   * @returns {Object} Analysis result with category and metadata
   */
  analyzePrompt(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    const hasBruno = this.brunoKeywords.some(kw => lowerPrompt.includes(kw));
    const hasPompon = this.pomponKeywords.some(kw => lowerPrompt.includes(kw));
    const hasBlackboard = this.blackboardKeywords.some(kw => lowerPrompt.includes(kw));

    // Determine category
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
      referenceNeeded = null; // No reference image needed
    }

    // Extract scene description
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
      // For Whisk: extract scene description for the prompt
      whiskPrompt: this.createWhiskPrompt(prompt),
      // For Flow: the full prompt
      flowPrompt: prompt
    };
  }

  /**
   * Create a simplified prompt for Whisk (just the scene/action)
   * @param {string} prompt - Full prompt
   * @returns {string} Simplified prompt for Whisk
   */
  createWhiskPrompt(prompt) {
    // Remove the detailed character descriptions since we're using reference images
    let simplified = prompt;

    // Remove Bruno's full description
    simplified = simplified.replace(
      /Bruno\s*\([^)]+\)/gi,
      'Bruno'
    );

    // Remove Pompón's full description
    simplified = simplified.replace(
      /Pompón\s*\([^)]+\)/gi,
      'Pompón'
    );

    // Remove Pompon's full description (without accent)
    simplified = simplified.replace(
      /Pompon\s*\([^)]+\)/gi,
      'Pompón'
    );

    return simplified;
  }

  /**
   * Group prompts by their reference image needs
   * @param {Array} analysisResults - Array of analysis results
   * @returns {Object} Grouped prompts
   */
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

  /**
   * Create optimal batch order for processing
   * Groups consecutive prompts with same reference to minimize reference changes
   * @param {Array} analysisResults - Array of analysis results
   * @returns {Array} Optimized order with batch markers
   */
  createBatchOrder(analysisResults) {
    // For now, keep original order but mark batch boundaries
    const batches = [];
    let currentBatch = null;

    analysisResults.forEach((result, index) => {
      if (!currentBatch || currentBatch.reference !== result.referenceNeeded) {
        // Start new batch
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

// For use without modules
if (typeof window !== 'undefined') {
  window.PromptAnalyzer = PromptAnalyzer;
}
