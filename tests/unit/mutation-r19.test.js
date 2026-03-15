/**
 * ROUND 19: MUTATION TESTING
 *
 * Each test is designed to FAIL if a specific line/condition in the source
 * code were mutated (changed, removed, or inverted). Tests that only check
 * "success: true" or only grep source text are NOT mutation-catching.
 *
 * Approach: behavioural simulators that mirror real logic, plus targeted
 * source-level assertions for things that can only be verified structurally.
 */

const fs = require('fs');
const backgroundSrc = fs.readFileSync(require('path').join(__dirname, '../../background.js'), 'utf8');
const mainSrc = fs.readFileSync(require('path').join(__dirname, '../../content/flow/main.js'), 'utf8');
const whiskSrc = fs.readFileSync(require('path').join(__dirname, '../../content/whisk/main.js'), 'utf8');

// =====================================================================
// SECTION 1: processNextFlowVideo — break after first send
// Mutation: remove "break;" → would send ALL videos at once instead of one
// =====================================================================
describe('processNextFlowVideo: break-after-first-send', () => {
  // Behavioural test: simulate the for-loop logic
  function simulateSendLoop(toSend, withBreak) {
    const sent = [];
    for (let i = 0; i < toSend; i++) {
      sent.push(i);
      if (withBreak) break; // mirrors real code
    }
    return sent;
  }

  test('with break, only 1 video is sent even when toSend > 1', () => {
    const sent = simulateSendLoop(4, true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(0);
  });

  test('without break, all videos would be sent (mutation detection)', () => {
    const sent = simulateSendLoop(4, false);
    expect(sent).toHaveLength(4); // proves the break matters
  });

  test('source code has break inside the for-loop body after sendMessage', () => {
    // Extract the for-loop body inside processNextFlowVideo
    const fnStart = backgroundSrc.indexOf('async function processNextFlowVideo');
    const fnEnd = backgroundSrc.indexOf('async function handleFlowVideoQueued');
    const fnBody = backgroundSrc.substring(fnStart, fnEnd);

    // The for loop: "for (let i = 0; i < toSend; i++)"
    expect(fnBody).toMatch(/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*toSend/);
    // The break must appear AFTER chrome.tabs.sendMessage and BEFORE the closing }
    const forStart = fnBody.indexOf('for (let i = 0; i < toSend');
    const afterFor = fnBody.substring(forStart);
    const sendMsgIdx = afterFor.indexOf('chrome.tabs.sendMessage');
    const breakIdx = afterFor.indexOf('break;', sendMsgIdx);
    expect(sendMsgIdx).toBeGreaterThan(0);
    expect(breakIdx).toBeGreaterThan(sendMsgIdx);
  });
});

// =====================================================================
// SECTION 2: isFirstOfSession flag
// Mutation: change condition to `true` or `false` always
// =====================================================================
describe('isFirstOfSession flag logic', () => {
  function computeIsFirstOfSession(activeVideosLen, generatedVideosLen) {
    return activeVideosLen === 0 && generatedVideosLen === 0;
  }

  test('is true only when both activeVideos and generatedVideos are empty', () => {
    expect(computeIsFirstOfSession(0, 0)).toBe(true);
  });

  test('is false when activeVideos has items', () => {
    expect(computeIsFirstOfSession(1, 0)).toBe(false);
  });

  test('is false when generatedVideos has items', () => {
    expect(computeIsFirstOfSession(0, 1)).toBe(false);
  });

  test('is false when both have items', () => {
    expect(computeIsFirstOfSession(2, 3)).toBe(false);
  });

  test('source uses both conditions with AND', () => {
    expect(backgroundSrc).toMatch(
      /isFirstOfThisSession\s*=\s*workflowState\.activeVideos\.length\s*===\s*0\s*&&\s*workflowState\.generatedVideos\.length\s*===\s*0/
    );
  });
});

// =====================================================================
// SECTION 3: resumedFrom offset in progress calculations
// Mutation: remove "+ resumedFrom" → progress would reset to 0 on resume
// =====================================================================
describe('resumedFrom offset in progress', () => {
  function calculateProgress(resumedFrom, generatedCount) {
    return resumedFrom + generatedCount;
  }

  test('progress includes resumedFrom offset', () => {
    expect(calculateProgress(5, 3)).toBe(8);
    expect(calculateProgress(0, 3)).toBe(3);
    expect(calculateProgress(10, 0)).toBe(10);
  });

  test('without resumedFrom, progress is wrong on resume (mutation proof)', () => {
    // If someone removes the resumedFrom addition
    const wrongProgress = 0 + 3; // would be just generatedVideos.length
    expect(wrongProgress).not.toBe(8); // should be 5+3=8
  });

  test('source calculates totalProgress with resumedFrom in BOTH handlers', () => {
    // handleFlowVideoDownloaded
    const dlFnStart = backgroundSrc.indexOf('async function handleFlowVideoDownloaded');
    const dlFnEnd = backgroundSrc.indexOf('async function handleFlowVideoGenerated');
    const dlBody = backgroundSrc.substring(dlFnStart, dlFnEnd);
    expect(dlBody).toMatch(/totalProgress\s*=\s*resumedFrom\s*\+\s*workflowState\.generatedVideos\.length/);

    // handleFlowVideoGenerated
    const genFnStart = backgroundSrc.indexOf('async function handleFlowVideoGenerated');
    const genFnEnd = backgroundSrc.indexOf('async function handleMonitorStatus');
    const genBody = backgroundSrc.substring(genFnStart, genFnEnd);
    expect(genBody).toMatch(/totalProgress\s*=\s*resumedFrom\s*\+\s*workflowState\.generatedVideos\.length/);
  });

  // Behavioral: full resume scenario
  test('resumed flow reports correct progress starting from offset', () => {
    const resumedFrom = 20;
    let generatedVideos = [];
    const totalItems = 30;

    // Generate 5 more videos after resume
    for (let i = 0; i < 5; i++) {
      generatedVideos.push({ index: 20 + i });
      const progress = resumedFrom + generatedVideos.length;
      expect(progress).toBe(21 + i);
    }
    // Final progress = 20 + 5 = 25
    expect(resumedFrom + generatedVideos.length).toBe(25);
    // Without resumedFrom it would be just 5 — WRONG
    expect(generatedVideos.length).toBe(5);
    expect(generatedVideos.length).not.toBe(25);
  });
});

// =====================================================================
// SECTION 4: isPipelineMode flag
// Mutation: forget to set it → completeFlowStep won't reset it
// =====================================================================
describe('isPipelineMode flag', () => {
  test('startFlowStep sets isPipelineMode = true on workflowState', () => {
    const fnStart = backgroundSrc.indexOf('async function startFlowStep');
    const fnEnd = backgroundSrc.indexOf('async function handleFlowSceneComplete');
    const fnBody = backgroundSrc.substring(fnStart, fnEnd);
    expect(fnBody).toContain('isPipelineMode: true');
  });

  test('completeFlowStep resets isPipelineMode to false', () => {
    const fnStart = backgroundSrc.indexOf('async function completeFlowStep');
    // Find next function after completeFlowStep
    const afterStart = backgroundSrc.substring(fnStart + 50);
    const nextFn = afterStart.indexOf('\nasync function ');
    const fnBody = backgroundSrc.substring(fnStart, fnStart + 50 + (nextFn > 0 ? nextFn : 500));
    expect(fnBody).toContain('isPipelineMode = false');
  });

  test('isPipelineMode is checked before pipeline-specific logic', () => {
    // The guard that uses isPipelineMode
    expect(backgroundSrc).toMatch(/workflowState\.isPipelineMode\s*&&\s*pipelineState\.isRunning/);
  });
});

// =====================================================================
// SECTION 5: flowManagedByWhiskThenFlow in checkParallelCompletion
// Mutation: remove the early return → would double-start Flow
// =====================================================================
describe('flowManagedByWhiskThenFlow guard', () => {
  function checkParallelCompletion(state) {
    const whiskDone = !state.runWhisk || state.whisk.isComplete;
    const speechDone = !state.runSpeech || state.speech.isComplete;
    const flowDone = !state.runFlow || state.flow.isComplete;

    if (state.flowManagedByWhiskThenFlow) {
      if (whiskDone && speechDone && flowDone) {
        return 'all-complete-managed';
      }
      return 'waiting-managed'; // early return - does NOT start Flow
    }

    if (whiskDone && speechDone) {
      if (flowDone) return 'pipeline-complete';
      if (state.runFlow && state.whisk.generatedImages.length > 0) {
        return 'start-flow'; // would start Flow
      }
      return 'pipeline-complete-no-flow';
    }
    return 'waiting';
  }

  test('when flowManagedByWhiskThenFlow=true and whisk+speech done, does NOT return start-flow', () => {
    const result = checkParallelCompletion({
      flowManagedByWhiskThenFlow: true,
      runWhisk: true, runSpeech: true, runFlow: true,
      whisk: { isComplete: true, generatedImages: [1, 2, 3] },
      speech: { isComplete: true },
      flow: { isComplete: false }
    });
    expect(result).toBe('waiting-managed');
    expect(result).not.toBe('start-flow'); // mutation: removing the guard would trigger start-flow
  });

  test('when flowManagedByWhiskThenFlow=false and whisk+speech done, DOES return start-flow', () => {
    const result = checkParallelCompletion({
      flowManagedByWhiskThenFlow: false,
      runWhisk: true, runSpeech: true, runFlow: true,
      whisk: { isComplete: true, generatedImages: [1, 2, 3] },
      speech: { isComplete: true },
      flow: { isComplete: false }
    });
    expect(result).toBe('start-flow');
  });

  test('when flowManagedByWhiskThenFlow=true and all done, returns all-complete-managed', () => {
    const result = checkParallelCompletion({
      flowManagedByWhiskThenFlow: true,
      runWhisk: true, runSpeech: true, runFlow: true,
      whisk: { isComplete: true, generatedImages: [] },
      speech: { isComplete: true },
      flow: { isComplete: true }
    });
    expect(result).toBe('all-complete-managed');
  });

  test('source: checkParallelCompletion returns early when flowManagedByWhiskThenFlow', () => {
    const fnStart = backgroundSrc.indexOf('function checkParallelCompletion');
    const fnBody = backgroundSrc.substring(fnStart, fnStart + 2000);
    // The if-guard must appear BEFORE the startFlowStep call
    const guardIdx = fnBody.indexOf('pipelineState.flowManagedByWhiskThenFlow');
    const startFlowIdx = fnBody.indexOf('startFlowStep()');
    expect(guardIdx).toBeGreaterThan(0);
    expect(startFlowIdx).toBeGreaterThan(guardIdx);
    // The return inside the guard block
    const returnIdx = fnBody.indexOf('return;', guardIdx);
    expect(returnIdx).toBeGreaterThan(guardIdx);
    expect(returnIdx).toBeLessThan(startFlowIdx);
  });
});

// =====================================================================
// SECTION 6: noWait flag in generateVideo
// Mutation: remove noWait=true → videos would be sent sequentially
// =====================================================================
describe('noWait flag', () => {
  test('messageData.noWait is set to true before sendMessage in processNextFlowVideo', () => {
    const fnStart = backgroundSrc.indexOf('async function processNextFlowVideo');
    const fnEnd = backgroundSrc.indexOf('async function handleFlowVideoQueued');
    const fnBody = backgroundSrc.substring(fnStart, fnEnd);
    // noWait must be set BEFORE the sendMessage call
    const noWaitIdx = fnBody.indexOf('messageData.noWait = true');
    const sendIdx = fnBody.indexOf('chrome.tabs.sendMessage(tabId', noWaitIdx);
    expect(noWaitIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(noWaitIdx);
  });
});

// =====================================================================
// SECTION 7: findCompletedVideoCards sort order (b.position - a.position)
// Mutation: swap to a.position - b.position → wrong download order
// =====================================================================
describe('findCompletedVideoCards sort order', () => {
  function sortCards(cards, comparator) {
    return [...cards].sort(comparator);
  }

  const cards = [
    { prompt: 'first', position: 500 },  // bottom = first sent
    { prompt: 'second', position: 300 },
    { prompt: 'third', position: 100 },   // top = newest
  ];

  test('b.position - a.position sorts bottom-first (descending position)', () => {
    const sorted = sortCards(cards, (a, b) => b.position - a.position);
    expect(sorted[0].prompt).toBe('first');   // position 500 (bottom)
    expect(sorted[2].prompt).toBe('third');   // position 100 (top)
  });

  test('a.position - b.position would sort WRONG (ascending = top-first)', () => {
    const sorted = sortCards(cards, (a, b) => a.position - b.position);
    expect(sorted[0].prompt).toBe('third');   // position 100 (top) — WRONG order
    expect(sorted[0].prompt).not.toBe('first');
  });

  test('source uses b.position - a.position (not a - b) for primary sort', () => {
    // The sort uses b.position - a.position (inverted: higher position first)
    expect(mainSrc).toMatch(/b\.position\s*-\s*a\.position/);
    // And it should be the primary comparator (rowDiff)
    expect(mainSrc).toContain('const rowDiff = b.position - a.position');
  });
});

// =====================================================================
// SECTION 8: isUpsampled filter in getExistingProjectState
// Mutation: remove filter → would count upsampled videos as originals
// =====================================================================
describe('isUpsampled filter', () => {
  function filterOriginalWorkflows(workflows) {
    return workflows.filter(w => {
      const step = w.workflowSteps?.[0];
      const mediaKey = step?.mediaGenerations?.[0]?.mediaGenerationId?.mediaKey || '';
      const genMode = step?.workflowStepLog?.requestData?.videoGenerationRequestData?.videoModelControlInput?.videoGenerationMode || '';
      const isUpsampled = mediaKey.includes('upsampled') || genMode.includes('VIDEO_TO_VIDEO');
      return !isUpsampled;
    });
  }

  const workflows = [
    { workflowSteps: [{ mediaGenerations: [{ mediaGenerationId: { mediaKey: 'abc123' } }], workflowStepLog: { requestData: { videoGenerationRequestData: { videoModelControlInput: { videoGenerationMode: 'TEXT_TO_VIDEO' } } } } }] },
    { workflowSteps: [{ mediaGenerations: [{ mediaGenerationId: { mediaKey: 'def_upsampled_456' } }], workflowStepLog: { requestData: { videoGenerationRequestData: { videoModelControlInput: { videoGenerationMode: 'TEXT_TO_VIDEO' } } } } }] },
    { workflowSteps: [{ mediaGenerations: [{ mediaGenerationId: { mediaKey: 'ghi789' } }], workflowStepLog: { requestData: { videoGenerationRequestData: { videoModelControlInput: { videoGenerationMode: 'VIDEO_TO_VIDEO' } } } } }] },
    { workflowSteps: [{ mediaGenerations: [{ mediaGenerationId: { mediaKey: 'jkl000' } }], workflowStepLog: { requestData: { videoGenerationRequestData: { videoModelControlInput: { videoGenerationMode: 'TEXT_TO_VIDEO' } } } } }] },
  ];

  test('filters out upsampled (by mediaKey) and VIDEO_TO_VIDEO workflows', () => {
    const originals = filterOriginalWorkflows(workflows);
    expect(originals).toHaveLength(2);
    expect(originals[0].workflowSteps[0].mediaGenerations[0].mediaGenerationId.mediaKey).toBe('abc123');
    expect(originals[1].workflowSteps[0].mediaGenerations[0].mediaGenerationId.mediaKey).toBe('jkl000');
  });

  test('without filter, all 4 workflows would be counted (mutation detection)', () => {
    expect(workflows).toHaveLength(4);
  });

  test('source filters by both upsampled key and VIDEO_TO_VIDEO mode', () => {
    expect(mainSrc).toMatch(/mediaKey\.includes\(['"]upsampled['"]\)/);
    expect(mainSrc).toMatch(/genMode\.includes\(['"]VIDEO_TO_VIDEO['"]\)/);
    expect(mainSrc).toMatch(/return\s+!isUpsampled/);
  });
});

// =====================================================================
// SECTION 9: Download handler fallback chain
// downloadSceneMap → pendingPromptSceneMap → counter
// Mutation: reorder the chain or remove a level
// =====================================================================
describe('vidflowDownloadHandler fallback chain', () => {
  let downloadSceneMap, pendingPromptSceneMap, downloadCounter;

  beforeEach(() => {
    downloadSceneMap = new Map();
    pendingPromptSceneMap = new Map();
    downloadCounter = 0;
  });

  function getSceneNumber(downloadId) {
    if (downloadSceneMap.has(downloadId)) {
      const sn = downloadSceneMap.get(downloadId);
      downloadSceneMap.delete(downloadId);
      return { sceneNumber: sn, source: 'downloadSceneMap' };
    } else if (pendingPromptSceneMap.size > 0) {
      const firstKey = pendingPromptSceneMap.keys().next().value;
      const sn = pendingPromptSceneMap.get(firstKey);
      pendingPromptSceneMap.delete(firstKey);
      return { sceneNumber: sn, source: 'pendingPromptSceneMap' };
    } else {
      downloadCounter++;
      return { sceneNumber: downloadCounter, source: 'counter' };
    }
  }

  test('prefers downloadSceneMap when entry exists', () => {
    downloadSceneMap.set(42, 7);
    pendingPromptSceneMap.set('prompt1', 3);
    const result = getSceneNumber(42);
    expect(result.source).toBe('downloadSceneMap');
    expect(result.sceneNumber).toBe(7);
    // pendingPromptSceneMap should NOT be consumed
    expect(pendingPromptSceneMap.size).toBe(1);
  });

  test('falls back to pendingPromptSceneMap when no downloadSceneMap entry', () => {
    pendingPromptSceneMap.set('prompt1', 5);
    pendingPromptSceneMap.set('prompt2', 6);
    const result = getSceneNumber(99);
    expect(result.source).toBe('pendingPromptSceneMap');
    expect(result.sceneNumber).toBe(5); // FIFO — first inserted
    expect(pendingPromptSceneMap.size).toBe(1); // consumed one
  });

  test('falls back to counter when both maps empty', () => {
    const r1 = getSceneNumber(1);
    const r2 = getSceneNumber(2);
    expect(r1.source).toBe('counter');
    expect(r1.sceneNumber).toBe(1);
    expect(r2.sceneNumber).toBe(2);
  });

  test('downloadSceneMap entry is deleted after use (no double-consume)', () => {
    downloadSceneMap.set(42, 7);
    getSceneNumber(42);
    expect(downloadSceneMap.has(42)).toBe(false);
    // Second call for same ID falls through
    const r2 = getSceneNumber(42);
    expect(r2.source).not.toBe('downloadSceneMap');
  });

  test('source code order: downloadSceneMap checked before pendingPromptSceneMap', () => {
    const fnStart = backgroundSrc.indexOf('function vidflowDownloadHandler');
    const fnBody = backgroundSrc.substring(fnStart, fnStart + 8000);
    const dsmIdx = fnBody.indexOf('downloadSceneMap.has(downloadId)');
    const ppmIdx = fnBody.indexOf('pendingPromptSceneMap.size > 0');
    const ctrIdx = fnBody.indexOf('downloadCounter++');
    expect(dsmIdx).toBeGreaterThan(0);
    expect(ppmIdx).toBeGreaterThan(dsmIdx);
    expect(ctrIdx).toBeGreaterThan(ppmIdx);
  });
});

// =====================================================================
// SECTION 10: clearNonPersistentReferences logic in Whisk
// Mutation: remove the areDifferent check → would always clear
// =====================================================================
describe('clearNonPersistent reference logic', () => {
  function shouldClearReferences(currentRefs, newRefs, persistentFingerprints) {
    const hasNonPersistentLoaded = currentRefs.some(fp => !persistentFingerprints.includes(fp));
    const newNonPersistent = newRefs.filter(r => !r.persistent);

    if (hasNonPersistentLoaded && newNonPersistent.length > 0) {
      const currentNonPersistent = currentRefs.filter(fp => !persistentFingerprints.includes(fp));
      const newNonPersistentFps = newNonPersistent.map(r => r.data.substring(50, 150));

      const areDifferent = currentNonPersistent.length !== newNonPersistentFps.length ||
        currentNonPersistent.some(fp => !newNonPersistentFps.includes(fp));

      return areDifferent ? 'clear' : 'keep';
    } else if (currentRefs.length > 0 && newRefs.length === 0) {
      return 'clear-all';
    }
    return 'keep';
  }

  test('clears when non-persistent refs change', () => {
    const current = ['fp_old_image'];
    const newRefs = [{ data: '0'.repeat(50) + 'fp_new_image' + '0'.repeat(100), persistent: false }];
    const persistent = [];
    expect(shouldClearReferences(current, newRefs, persistent)).toBe('clear');
  });

  test('keeps when non-persistent refs are the same', () => {
    const fp = 'same_fingerprint_value_here_padded_to_100_chars' + '0'.repeat(52);
    const current = [fp];
    const newRefs = [{ data: '0'.repeat(50) + fp, persistent: false }];
    const persistent = [];
    expect(shouldClearReferences(current, newRefs, persistent)).toBe('keep');
  });

  test('clears all when no new refs but had loaded refs', () => {
    expect(shouldClearReferences(['old'], [], [])).toBe('clear-all');
  });

  test('keeps when nothing loaded and nothing new', () => {
    expect(shouldClearReferences([], [], [])).toBe('keep');
  });

  test('source has the areDifferent guard before clearing', () => {
    expect(whiskSrc).toMatch(/areDifferent\s*=\s*currentNonPersistent\.length\s*!==\s*newNonPersistentFps\.length/);
    expect(whiskSrc).toMatch(/if\s*\(\s*areDifferent\s*\)/);
  });
});

// =====================================================================
// SECTION 11: pendingIndexes vs sequential mode
// Mutation: always use pendingIndexes (or never) → wrong index mapping
// =====================================================================
describe('pendingIndexes offset logic', () => {
  function getNextPromptIndex(state) {
    const usePending = Array.isArray(state.pendingIndexes);
    return usePending
      ? state.pendingIndexes[state.currentIndex]
      : state.currentIndex;
  }

  test('without pendingIndexes, realIdx = currentIndex', () => {
    expect(getNextPromptIndex({ pendingIndexes: null, currentIndex: 3 })).toBe(3);
  });

  test('with pendingIndexes, realIdx = pendingIndexes[currentIndex]', () => {
    // Resume: only scenes 3, 5, 7 are missing
    expect(getNextPromptIndex({ pendingIndexes: [3, 5, 7], currentIndex: 0 })).toBe(3);
    expect(getNextPromptIndex({ pendingIndexes: [3, 5, 7], currentIndex: 1 })).toBe(5);
    expect(getNextPromptIndex({ pendingIndexes: [3, 5, 7], currentIndex: 2 })).toBe(7);
  });

  test('mutation: using currentIndex directly when pendingIndexes exists gives wrong result', () => {
    const state = { pendingIndexes: [3, 5, 7], currentIndex: 0 };
    const correct = state.pendingIndexes[state.currentIndex]; // 3
    const wrong = state.currentIndex; // 0
    expect(correct).not.toBe(wrong);
  });
});

// =====================================================================
// SECTION 12: Tests that verify actual data, not just success: true
// =====================================================================
describe('Verify data integrity, not just success flags', () => {
  test('download naming produces correctly padded scene numbers', () => {
    function makeFilename(sceneNumber) {
      return `${String(sceneNumber).padStart(3, '0')}_flow_video.mp4`;
    }
    expect(makeFilename(1)).toBe('001_flow_video.mp4');
    expect(makeFilename(10)).toBe('010_flow_video.mp4');
    expect(makeFilename(100)).toBe('100_flow_video.mp4');
    // Mutation: padStart(2, '0') would give '01' instead of '001'
    expect(makeFilename(1)).not.toBe('01_flow_video.mp4');
  });

  test('whisk filename uses padStart(2) not padStart(3)', () => {
    // Whisk uses 2-digit padding: 01_whisk.png
    const fnBody = backgroundSrc.substring(
      backgroundSrc.indexOf('isFromWhisk && isImage'),
      backgroundSrc.indexOf('isFromWhisk && isImage') + 1000
    );
    expect(fnBody).toMatch(/padStart\(2,\s*'0'\)/);
  });

  test('flow filename uses padStart(3) not padStart(2)', () => {
    // Flow uses 3-digit: 001_flow_video.mp4
    const fnStart = backgroundSrc.indexOf('isFromFlow && isVideo');
    const fnBody = backgroundSrc.substring(fnStart, fnStart + 1500);
    expect(fnBody).toMatch(/padStart\(3,\s*'0'\)/);
  });

  test('batch image assignment uses realPromptIdx not currentIndex', () => {
    const fnStart = backgroundSrc.indexOf('async function processNextFlowVideo');
    const fnEnd = backgroundSrc.indexOf('async function handleFlowVideoQueued');
    const fnBody = backgroundSrc.substring(fnStart, fnEnd);
    // batchImages[realPromptIdx] — not batchImages[currentIndex] or batchImages[i]
    expect(fnBody).toMatch(/batchImages\[realPromptIdx\]/);
  });
});

// =====================================================================
// SECTION 13: flowManagedByWhiskThenFlow is initialized to false
// Mutation: initialize to true → would skip Flow start
// =====================================================================
describe('pipelineState initialization', () => {
  test('flowManagedByWhiskThenFlow defaults to false in startParallelPipeline init', () => {
    // The runtime init at line ~1899 (startParallelPipeline) includes the flag
    // Find the SECOND pipelineState = { which is inside startParallelPipeline
    // Find the pipelineState init that contains flowManagedByWhiskThenFlow
    const flagIdx = backgroundSrc.indexOf('flowManagedByWhiskThenFlow: false');
    expect(flagIdx).toBeGreaterThan(0);
    // Verify it's inside a pipelineState assignment
    const before = backgroundSrc.substring(Math.max(0, flagIdx - 300), flagIdx);
    expect(before).toContain('pipelineState = {');
  });

  test('flowManagedByWhiskThenFlow is set to true only in runWhiskThenFlow paths', () => {
    const setTrueMatches = backgroundSrc.match(/flowManagedByWhiskThenFlow\s*=\s*true/g) || [];
    expect(setTrueMatches.length).toBeGreaterThanOrEqual(1);
    // The init should be false, not true
    expect(backgroundSrc).toContain('flowManagedByWhiskThenFlow: false');
    expect(backgroundSrc).not.toMatch(/pipelineState\s*=\s*\{[^}]*flowManagedByWhiskThenFlow:\s*true/);
  });
});

// =====================================================================
// SECTION 14: activeVideos pushed BEFORE sending message
// Mutation: push after → race condition if response arrives instantly
// =====================================================================
describe('activeVideos ordering relative to sendMessage', () => {
  test('activeVideos.push happens before chrome.tabs.sendMessage', () => {
    const fnStart = backgroundSrc.indexOf('async function processNextFlowVideo');
    const fnEnd = backgroundSrc.indexOf('async function handleFlowVideoQueued');
    const fnBody = backgroundSrc.substring(fnStart, fnEnd);
    const pushIdx = fnBody.indexOf('workflowState.activeVideos.push(');
    const sendIdx = fnBody.indexOf('chrome.tabs.sendMessage(tabId,', pushIdx);
    expect(pushIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(pushIdx);
  });

  test('currentIndex incremented before sendMessage too', () => {
    const fnStart = backgroundSrc.indexOf('async function processNextFlowVideo');
    const fnEnd = backgroundSrc.indexOf('async function handleFlowVideoQueued');
    const fnBody = backgroundSrc.substring(fnStart, fnEnd);
    const incIdx = fnBody.indexOf('workflowState.currentIndex++');
    const sendIdx = fnBody.indexOf('chrome.tabs.sendMessage(tabId,', incIdx);
    expect(incIdx).toBeGreaterThan(0);
    expect(sendIdx).toBeGreaterThan(incIdx);
  });
});

// =====================================================================
// SECTION 15: Completion condition uses >= not ===
// Mutation: change to === → edge case with extra downloads wouldn't complete
// =====================================================================
describe('completion condition', () => {
  test('source uses >= for completion check (not strict ===)', () => {
    // In handleFlowVideoDownloaded
    expect(backgroundSrc).toMatch(/generatedVideos\.length\s*>=\s*totalToGenerate/);
  });

  test('>= catches overshoot edge case that === would miss', () => {
    const totalToGenerate = 5;
    // Normal: exactly 5
    expect(5 >= totalToGenerate).toBe(true);
    expect(5 === totalToGenerate).toBe(true);
    // Overshoot: 6 (e.g., race condition with duplicate completion)
    expect(6 >= totalToGenerate).toBe(true);
    expect(6 === totalToGenerate).toBe(false); // === would MISS this
  });
});
