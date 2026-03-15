# VidFlow

**Chrome extension that automates video creation with [Google Flow](https://labs.google/fx/es/tools/video-fx/) (Veo) and Gemini TTS.**

Generate images, animate them into videos, add AI narration — all from a single sidepanel. Built for creators who need to produce video content at scale.

---

## What it does

VidFlow turns a list of prompts into a full video pipeline:

1. **Image Generation** — Sends prompts to Google Flow to generate images (Imagen 4 / Nano)
2. **Image-to-Video** — Animates each image into a video clip (Veo 2 / Veo 3)
3. **TTS Narration** — Generates voiceover audio via Gemini API
4. **Auto-Download** — Downloads videos progressively as they complete

Each step can run independently or as a full pipeline (sequential or parallel).

## Key Features

- **Sidepanel UI** for scene management, prompt editing, and pipeline config
- **Slate editor integration** — injects prompts directly into Flow's rich-text editor
- **Progressive downloads** — videos download as they finish, not all at once
- **Smart retry** — detects failed generations and retries automatically
- **Deadlock detection** — monitors for stuck states and recovers
- **Parallel mode** — run Flow + Speech generation simultaneously
- **Batch mode** — queue multiple projects back-to-back

## Requirements

- Google Chrome (latest)
- A Google account with access to [Google Flow](https://labs.google/fx/es/tools/video-fx/)
- A [Gemini API key](https://aistudio.google.com/apikey) (for TTS narration, optional)

## Installation

1. Clone this repo:
   ```bash
   git clone https://github.com/Nachx639/VidFlow.git
   ```

2. Open Chrome and go to `chrome://extensions/`

3. Enable **Developer mode** (top right)

4. Click **Load unpacked** and select the `VidFlow` folder

5. Pin VidFlow from the extensions menu and open the sidepanel

## Configuration

### Gemini API Key (for TTS)

1. Get your free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Open VidFlow sidepanel > **Config** tab
3. Paste your key in the **Gemini API Key** field
4. The key is stored locally in your browser — never sent anywhere except Google's API

### Video Settings

In the sidepanel Config tab you can set:
- **Model**: Veo 2 Fast, Veo 3.1 Fast, Veo 3.1 Quality
- **Aspect ratio**: Landscape, Portrait, Square
- **Results per prompt**: 1-4

## Usage

### Quick Start

1. Open [Google Flow](https://labs.google/fx/es/tools/video-fx/) in a tab
2. Open VidFlow sidepanel
3. Paste your prompts in the **Scenes** tab (one per line, numbered):
   ```
   1. A vast desert landscape at golden hour
   2. A lone astronaut walking on Mars
   3. Underwater coral reef with tropical fish
   ```
4. (Optional) Add narration text for each scene
5. Click **Start Pipeline**

### Pipeline Modes

| Mode | Description |
|------|-------------|
| **Image → Video** | Generates image, animates to video, downloads |
| **Flow only** | Video generation without narration |
| **Speech only** | TTS narration only |
| **Parallel** | Flow + Speech run simultaneously |

## Project Structure

```
VidFlow/
├── background.js              # Service worker loader (importScripts)
├── background/
│   ├── bg-constants.js        # State, keepalive, config
│   ├── bg-downloads.js        # Download management
│   ├── bg-utils.js            # Tab management, utilities
│   ├── bg-tts.js              # Gemini TTS API, WAV conversion
│   ├── bg-flow-workflow.js    # Flow workflow orchestration
│   ├── bg-pipeline.js         # Pipeline (sequential + parallel)
│   └── bg-speech.js           # Speech step processing
├── content/
│   ├── bridge.js              # Content script bridge
│   └── flow/
│       ├── main.js            # Entry point, message listener
│       ├── generation.js      # Prompt input, generate, download
│       ├── generation-type.js # Type selection (image/video)
│       ├── generation-image.js# Image upload logic
│       ├── detect.js          # Video card detection
│       ├── monitor.js         # Download monitor + retry
│       ├── video.js           # Video project helpers
│       ├── pipeline.js        # Content-side pipeline
│       ├── resilience.js      # Error recovery
│       ├── slate-bridge.js    # Slate editor API bridge
│       ├── utils.js           # DOM utilities
│       ├── log.js             # Visual log panel
│       ├── selectors.js       # DOM selectors
│       └── settings.js        # Flow settings automation
├── sidepanel/
│   ├── panel.html             # Sidepanel UI
│   ├── panel.css              # Dark theme styles
│   ├── panel.js               # Init, state, messages
│   ├── panel-state.js         # State declarations
│   ├── panel-utils.js         # UI utilities
│   ├── panel-scenes.js        # Scene management
│   └── panel-pipeline.js      # Pipeline config + execution
├── manifest.json              # Chrome extension manifest (MV3)
└── tests/                     # Jest test suite
```

## Technical Notes

- **Manifest V3** service worker with `importScripts()` for modular code
- **Slate editor injection** — uses React fiber tree traversal to access Flow's Slate editor instance, since standard DOM APIs don't trigger Slate's internal state updates
- **Progressive downloading** — polls for completed video tiles and downloads via `fetch()` + `chrome.downloads` API as they finish
- **Anti-throttle** — uses AudioContext to prevent Chrome from throttling the background service worker during long operations

## Tests

```bash
npm install
npm test
```

## License

MIT

## Disclaimer

This extension automates interaction with Google Labs experimental tools. These tools may change without notice, which could break functionality. Use at your own risk. This project is not affiliated with or endorsed by Google.
