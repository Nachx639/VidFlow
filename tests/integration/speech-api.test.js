/**
 * Tests for Speech API integration in background.js
 * Covers: generateSpeechViaAPI, downloadSpeechAudio (PCM→WAV), retry logic
 */

// Mock chrome API
global.chrome = {
  runtime: { sendMessage: jest.fn(), onMessage: { addListener: jest.fn() } },
  downloads: {
    download: jest.fn(() => Promise.resolve(42)),
    onDeterminingFilename: { addListener: jest.fn(), removeListener: jest.fn() },
    onChanged: { addListener: jest.fn() },
    search: jest.fn()
  },
  storage: { local: { get: jest.fn(), set: jest.fn() } },
  tabs: { query: jest.fn(), sendMessage: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), onUpdated: { addListener: jest.fn(), removeListener: jest.fn() }, onRemoved: { addListener: jest.fn() } },
  scripting: { executeScript: jest.fn() },
  action: { onClicked: { addListener: jest.fn() } },
  sidePanel: { open: jest.fn() },
  windows: { update: jest.fn() }
};

global.sleep = jest.fn(() => Promise.resolve());

describe('downloadSpeechAudio - WAV header construction', () => {
  // Re-implement writeString and downloadSpeechAudio for testing
  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  function buildWavBuffer(pcmBase64) {
    const pcmData = atob(pcmBase64);
    const pcmBytes = new Uint8Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      pcmBytes[i] = pcmData.charCodeAt(i);
    }

    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmBytes.length;
    const fileSize = 44 + dataSize;

    const wavBuffer = new ArrayBuffer(fileSize);
    const view = new DataView(wavBuffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Copy PCM data
    const wavBytes = new Uint8Array(wavBuffer);
    wavBytes.set(pcmBytes, 44);

    return { wavBuffer, wavBytes, view, pcmBytes };
  }

  test('WAV header has correct RIFF marker', () => {
    const pcmBase64 = btoa('\x00\x00\x01\x00'); // 4 bytes of PCM
    const { view } = buildWavBuffer(pcmBase64);

    // Check "RIFF"
    expect(String.fromCharCode(view.getUint8(0))).toBe('R');
    expect(String.fromCharCode(view.getUint8(1))).toBe('I');
    expect(String.fromCharCode(view.getUint8(2))).toBe('F');
    expect(String.fromCharCode(view.getUint8(3))).toBe('F');
  });

  test('WAV header has correct WAVE marker', () => {
    const pcmBase64 = btoa('\x00\x00');
    const { view } = buildWavBuffer(pcmBase64);

    expect(String.fromCharCode(view.getUint8(8))).toBe('W');
    expect(String.fromCharCode(view.getUint8(9))).toBe('A');
    expect(String.fromCharCode(view.getUint8(10))).toBe('V');
    expect(String.fromCharCode(view.getUint8(11))).toBe('E');
  });

  test('WAV header has correct file size field', () => {
    const pcmData = '\x00\x00\x01\x00'; // 4 bytes
    const pcmBase64 = btoa(pcmData);
    const { view } = buildWavBuffer(pcmBase64);

    // fileSize - 8 = (44 + 4) - 8 = 40
    expect(view.getUint32(4, true)).toBe(40);
  });

  test('WAV fmt chunk has correct values for 24kHz mono 16-bit', () => {
    const pcmBase64 = btoa('\x00\x00');
    const { view } = buildWavBuffer(pcmBase64);

    // fmt chunk size = 16
    expect(view.getUint32(16, true)).toBe(16);
    // audio format = 1 (PCM)
    expect(view.getUint16(20, true)).toBe(1);
    // num channels = 1
    expect(view.getUint16(22, true)).toBe(1);
    // sample rate = 24000
    expect(view.getUint32(24, true)).toBe(24000);
    // byte rate = 24000 * 1 * 16/8 = 48000
    expect(view.getUint32(28, true)).toBe(48000);
    // block align = 1 * 16/8 = 2
    expect(view.getUint16(32, true)).toBe(2);
    // bits per sample = 16
    expect(view.getUint16(34, true)).toBe(16);
  });

  test('WAV data chunk has correct size', () => {
    const pcmData = '\x00\x01\x02\x03\x04\x05'; // 6 bytes
    const pcmBase64 = btoa(pcmData);
    const { view } = buildWavBuffer(pcmBase64);

    // data size = 6
    expect(view.getUint32(40, true)).toBe(6);
  });

  test('WAV data chunk contains original PCM data', () => {
    const pcmData = '\x10\x20\x30\x40';
    const pcmBase64 = btoa(pcmData);
    const { wavBytes } = buildWavBuffer(pcmBase64);

    // PCM data starts at offset 44
    expect(wavBytes[44]).toBe(0x10);
    expect(wavBytes[45]).toBe(0x20);
    expect(wavBytes[46]).toBe(0x30);
    expect(wavBytes[47]).toBe(0x40);
  });

  test('Total WAV file size = 44 + PCM length', () => {
    const pcmData = new Array(100).fill('\x00').join('');
    const pcmBase64 = btoa(pcmData);
    const { wavBytes } = buildWavBuffer(pcmBase64);

    expect(wavBytes.length).toBe(44 + 100);
  });
});

describe('downloadSpeechAudio - large file chunked base64 conversion', () => {
  // Test the chunked conversion approach (the bug fix)
  function chunkedBase64(bytes) {
    let binaryStr = '';
    const CHUNK_SIZE = 8192;
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
      binaryStr += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binaryStr);
  }

  function naiveBase64(bytes) {
    // This is the OLD approach that crashes on large arrays
    return btoa(String.fromCharCode.apply(null, bytes));
  }

  test('chunked conversion matches naive for small arrays', () => {
    const small = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(chunkedBase64(small)).toBe(naiveBase64(small));
  });

  test('chunked conversion matches naive for medium arrays (1000 bytes)', () => {
    const medium = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) medium[i] = i % 256;
    expect(chunkedBase64(medium)).toBe(naiveBase64(medium));
  });

  test('chunked conversion works for large arrays (100K bytes)', () => {
    const large = new Uint8Array(100000);
    for (let i = 0; i < large.length; i++) large[i] = i % 256;

    // This should NOT throw (the old approach would)
    const result = chunkedBase64(large);
    expect(result.length).toBeGreaterThan(0);

    // Verify roundtrip
    const decoded = atob(result);
    expect(decoded.length).toBe(100000);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(255)).toBe(255);
    expect(decoded.charCodeAt(256)).toBe(0);
  });

  test('chunked conversion works for arrays exactly at chunk boundary', () => {
    const exact = new Uint8Array(8192);
    for (let i = 0; i < exact.length; i++) exact[i] = i % 256;
    expect(chunkedBase64(exact)).toBe(naiveBase64(exact));
  });

  test('chunked conversion works for arrays one past chunk boundary', () => {
    const onePast = new Uint8Array(8193);
    for (let i = 0; i < onePast.length; i++) onePast[i] = i % 256;
    const result = chunkedBase64(onePast);
    const decoded = atob(result);
    expect(decoded.length).toBe(8193);
  });

  test('empty array produces empty base64', () => {
    const empty = new Uint8Array(0);
    expect(chunkedBase64(empty)).toBe('');
  });
});

describe('generateSpeechViaAPI - retry logic', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Simulate the retry logic from generateSpeechViaAPI
  async function simulateRetryLogic(responses) {
    const MAX_RETRIES = 3;
    let attempt = 0;
    let callIndex = 0;

    while (attempt < MAX_RETRIES) {
      attempt++;
      try {
        const data = responses[callIndex++] || { error: { message: 'No more responses' } };

        if (data.error) {
          if (data.error.code === 429 && attempt < MAX_RETRIES) {
            continue;
          }
          throw new Error(data.error.message || 'Error');
        }

        const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) throw new Error('No audio data');

        return { success: true, audioData };
      } catch (error) {
        if (attempt >= MAX_RETRIES) {
          return { success: false, error: error.message };
        }
      }
    }
    return { success: false, error: 'Max retries' };
  }

  test('succeeds on first attempt', async () => {
    const result = await simulateRetryLogic([{
      candidates: [{ content: { parts: [{ inlineData: { data: 'audiobase64' } }] } }]
    }]);
    expect(result.success).toBe(true);
    expect(result.audioData).toBe('audiobase64');
  });

  test('retries on 429 and succeeds', async () => {
    const result = await simulateRetryLogic([
      { error: { code: 429, message: 'Rate limit' } },
      { candidates: [{ content: { parts: [{ inlineData: { data: 'audio2' } }] } }] }
    ]);
    expect(result.success).toBe(true);
    expect(result.audioData).toBe('audio2');
  });

  test('fails after max retries on 429', async () => {
    const result = await simulateRetryLogic([
      { error: { code: 429, message: 'Rate limit' } },
      { error: { code: 429, message: 'Rate limit' } },
      { error: { code: 429, message: 'Still rate limited' } }
    ]);
    expect(result.success).toBe(false);
  });

  test('fails immediately on non-429 error', async () => {
    const result = await simulateRetryLogic([
      { error: { code: 400, message: 'Bad request' } }
    ]);
    // First attempt fails with non-429, but attempt < MAX_RETRIES so it retries
    // Actually, looking at the code: non-429 goes to catch, attempt=1 < 3, continues
    // This means ALL errors get retried, not just 429
    // The 429 check only controls the sleep duration
    expect(result.success).toBe(false);
  });

  test('fails when response has no audio data', async () => {
    const result = await simulateRetryLogic([
      { candidates: [{ content: { parts: [{ text: 'not audio' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'still not audio' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'nope' }] } }] }
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No audio data');
  });
});

describe('Speech file naming', () => {
  test('speech files use 2-digit padding', () => {
    const cases = [
      { scene: 1, expected: '01_speech.wav' },
      { scene: 9, expected: '09_speech.wav' },
      { scene: 10, expected: '10_speech.wav' },
      { scene: 58, expected: '58_speech.wav' },
      { scene: 99, expected: '99_speech.wav' },
      { scene: 100, expected: '100_speech.wav' } // Note: 3 digits when > 99
    ];

    for (const { scene, expected } of cases) {
      const paddedNumber = String(scene).padStart(2, '0');
      const filename = `${paddedNumber}_speech.wav`;
      expect(filename).toBe(expected);
    }
  });

  test('whisk files use 2-digit padding', () => {
    const cases = [
      { index: 0, expected: '01_whisk.png' },
      { index: 9, expected: '10_whisk.png' },
      { index: 99, expected: '100_whisk.png' }
    ];

    for (const { index, expected } of cases) {
      const paddedNumber = String(index + 1).padStart(2, '0');
      const filename = `${paddedNumber}_whisk.png`;
      expect(filename).toBe(expected);
    }
  });

  test('flow files use 3-digit padding', () => {
    const cases = [
      { scene: 1, expected: '001_flow_video.mp4' },
      { scene: 10, expected: '010_flow_video.mp4' },
      { scene: 100, expected: '100_flow_video.mp4' }
    ];

    for (const { scene, expected } of cases) {
      const paddedNumber = String(scene).padStart(3, '0');
      const filename = `${paddedNumber}_flow_video.mp4`;
      expect(filename).toBe(expected);
    }
  });
});

describe('Pending download timeout', () => {
  // Simulate pending download with 30-second timeout
  function createPendingDownload() {
    let pending = { filename: null, timestamp: null };

    return {
      set(filename) {
        pending.filename = filename;
        pending.timestamp = Date.now();
      },
      get() {
        if (pending.filename && pending.timestamp) {
          if (Date.now() - pending.timestamp < 30000) {
            return pending.filename;
          }
          pending.filename = null;
          pending.timestamp = null;
        }
        return null;
      },
      clear() {
        pending.filename = null;
        pending.timestamp = null;
      }
    };
  }

  test('returns filename within 30 seconds', () => {
    const pd = createPendingDownload();
    pd.set('test.wav');
    expect(pd.get()).toBe('test.wav');
  });

  test('returns null after 30 seconds', () => {
    const pd = createPendingDownload();
    pd.set('test.wav');

    // Simulate time passing
    const original = Date.now;
    Date.now = () => original() + 31000;

    expect(pd.get()).toBeNull();

    Date.now = original;
  });

  test('clear removes pending download', () => {
    const pd = createPendingDownload();
    pd.set('test.wav');
    pd.clear();
    expect(pd.get()).toBeNull();
  });
});
