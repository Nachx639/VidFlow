# VidFlow - Arquitectura del Proyecto

## Descripción
Extensión de Chrome para automatizar la creación de videos en Google Flow (VEO).

## Estructura de Archivos

```
vidflow/
├── manifest.json           # Configuración de la extensión Chrome MV3
├── background.js           # Service worker para comunicación
├── ARCHITECTURE.md         # Este archivo (documentación)
│
├── sidepanel/              # Panel lateral de la extensión
│   ├── panel.html          # UI del panel (~200 líneas)
│   ├── panel.css           # Estilos del panel
│   └── panel.js            # Lógica del panel (~768 líneas)
│
└── content/                # Scripts inyectados en las páginas
    ├── flow.js             # [BACKUP] Archivo original monolítico
    └── flow/               # Módulos refactorizados
        ├── utils.js        # 219 líneas - Utilidades compartidas
        ├── log.js          # 233 líneas - Sistema de logs visual
        ├── selectors.js    # 77 líneas - Selectores DOM constantes
        ├── settings.js     # 182 líneas - Configuración de ajustes
        ├── generation.js   # 701 líneas - Tipo, imagen, prompt
        ├── video.js        # 452 líneas - Proyecto, espera, descarga
        ├── pipeline.js     # 559 líneas - Modo pipeline (5 paralelo)
        └── main.js         # 292 líneas - Entry point
```

**Total refactorizado:** 2715 líneas distribuidas en 8 archivos manejables
**Archivo original:** flow.js (~2757 líneas) mantenido como backup

## Componentes Principales

### 1. Sidepanel (`sidepanel/`)
Panel lateral que permite:
- Pegar y analizar prompts
- Configurar categorías de referencia con imágenes
- Modo batch (una imagen por prompt)
- Configurar modelo Veo, orientación, resultados
- Iniciar/detener automatización

**Archivos:**
- `panel.html`: UI con tabs (Prompts, Referencias, Config)
- `panel.css`: Estilos dark theme
- `panel.js`: Estado, análisis de prompts, comunicación con background

### 2. Content Scripts (`content/flow/`)
Scripts inyectados en `labs.google/*` para automatizar Flow.

#### utils.js
Funciones de utilidad:
- `sleep(ms)`: Pausa async
- `base64ToBlob(base64)`: Conversión de imágenes
- `findElement(texts, tagFilter)`: Búsqueda de elementos DOM
- `findElementInSettings(texts)`: Búsqueda en panel de ajustes
- `selectOptionInListbox(texts)`: Selección en dropdowns
- `waitForPageReady()`: Esperar carga de página
- `showDebugBadge(text)`: Badge visual de debug

#### log.js
Sistema de logs visual:
- `initLogPanel()`: Crear panel de logs flotante
- `vfLog(msg, type)`: Log con timestamp y tipo (info/success/warn/error/step)
- `makeDraggable(el, handle)`: Hacer panel arrastrable
- `saveLogsToStorage()`: Persistir logs
- `clearLogs()`: Limpiar logs

#### selectors.js
Constantes con selectores DOM para Google Flow.

#### settings.js
Configuración de ajustes:
- `configureSettings(config)`: Configurar todos los ajustes
- `setAspectRatio(ratio)`: 16:9 o 9:16
- `setResultsPerRequest(count)`: 1-4 videos
- `setModel(modelId)`: Veo 2/3.1

#### generation.js
Preparación de generación:
- `selectGenerationType(type)`: Texto/Imagen/Ingredientes a video
- `getCurrentGenerationType()`: Detectar tipo actual
- `uploadImage(imageData)`: Subir imagen de referencia
- `handleCropDialog()`: Manejar diálogo de recorte
- `waitForImageReady()`: Verificar imagen cargada
- `enterPrompt(text)`: Escribir prompt
- `clickGenerate()`: Iniciar generación
- `verifyImageBeforeSend()`: Verificar imagen antes de enviar

#### video.js
Manejo de videos:
- `goToHomeAndCreateProject()`: Crear nuevo proyecto
- `dismissPreviousResult()`: Cerrar resultado anterior
- `clearPromptArea()`: Limpiar prompt
- `removeCurrentImage()`: Eliminar imagen actual
- `waitForVideoGeneration()`: Esperar generación (max 5 min)
- `downloadVideo(index)`: Descargar video 720p
- `downloadVideoByPrompt(prompt, filename)`: Descarga por prompt

#### pipeline.js
Modo pipeline (5 videos en paralelo):
- `findPromptButton(text)`: Encontrar botón de prompt
- `findVideoCardByPrompt(text)`: Encontrar card de video
- `getVideoStatusByPrompt(text)`: Estado (COMPLETED/GENERATING/FAILED/PENDING)
- `countVideoStatuses(prompts)`: Contar estados
- `submitPromptToQueue(text)`: Enviar a cola
- `findRetryButton(text)`: Encontrar botón reutilizar
- `retryFailedVideo(text)`: Reintentar video fallido
- `runPipelineMode(prompts, config)`: Ejecutar pipeline completo

#### main.js
Entry point:
- Estado global (`isAutomating`, `currentConfig`, etc.)
- Message listener para comunicación con background
- `setupFlow(data)`: Inicializar automatización
- `generateVideo(data)`: Generar un video completo
- `stopAutomation()`: Detener automatización

### 3. Background (`background.js`)
Service worker que:
- Recibe mensajes del sidepanel
- Envía comandos al content script
- Maneja descargas

## Flujo de Datos

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Sidepanel  │────>│ Background  │────>│Content Script│
│  (panel.js) │     │ (bg.js)     │     │ (flow/*.js) │
└─────────────┘     └─────────────┘     └─────────────┘
      │                                        │
      │         chrome.runtime.sendMessage     │
      └───────────────────────────────────────┘
```

## Modos de Operación

### Modo Secuencial (Antiguo)
1. Crear proyecto
2. Configurar ajustes
3. Subir imagen (si aplica)
4. Escribir prompt
5. Generar y esperar
6. Descargar
7. Siguiente video

### Modo Pipeline (Nuevo)
1. Enviar hasta 5 prompts a la cola
2. Monitorear estados cada 10s
3. Cuando uno completa: descargar y enviar siguiente
4. Si falla: reintentar automáticamente (max 3 veces)
5. Continuar hasta completar todos

## Detección de Estados

| Estado | Indicador |
|--------|-----------|
| COMPLETED | Tiene video/thumbnail visible |
| GENERATING | Muestra porcentaje (XX%) |
| FAILED | Texto "No se ha podido generar" |
| PENDING | Sin indicadores |
| NOT_FOUND | Prompt no encontrado en DOM |

## Key Internal Mechanisms

### Google Flow UI Layout (IMPORTANTE)
- **Orden de escenas: de ABAJO arriba**. La escena 1 está al fondo de la página, la más reciente arriba.
- Cada tarjeta de video: `<video>` arriba, prompt text abajo. El prompt está más cerca del video de la tarjeta SIGUIENTE que del suyo.
- Contenedor por tarjeta (`sc-20145656-0`) está a ~10 niveles DOM desde el `<video>`. Contiene exactamente 1 video + 1 prompt.
- El contenedor general de la galería (nivel ~14) contiene TODOS los videos y prompts.
- `findCompletedVideoCards()` usa `maxLevels=15` para asegurar que alcanza el contenedor por tarjeta.
- El fallback de proximidad solo busca prompts DEBAJO del video (`rect.top > videoRect.top`) para evitar confundir con la tarjeta anterior.

### Download Tracking (Triple-Map)
- `downloadSceneMap`: downloadId → sceneNumber (code-initiated downloads)
- `pendingVideoUrlMap`: videoUrlId → sceneNumber (URL-based matching, más fiable)
- `pendingPromptSceneMap`: promptKey → sceneNumber (FIFO fallback, último recurso)
- `vidflowDownloadIds`: Set of VidFlow download IDs, capped at 200
- El listener `onDeterminingFilename` solo se registra durante pipelines activos para no interferir con AutoFlow u otras extensiones.

### Service Worker Keepalive
- `chrome.alarms` at 24s intervals + `chrome.storage.local` writes
- Auto-stops when no workflow is running

### Memory Caps
- `MAX_TRACKED_DOWNLOADS = 200` (download Set)
- `MAX_LOG_ENTRIES = 500` (all 3 log modules)
- `MAX_PROMPT_LENGTH = 5000` (panel input)

### Security
- `escapeHtml()` on all dynamic innerHTML in panel.js
- `sanitizeFolderName()` strips path-unsafe chars
- Input validation on speech API functions

## Changelog

### v0.4.1-qa (2026-02-08)
- 16 rounds of QA, 14 bugs fixed, 871 tests
- See CHANGELOG.md for details

### v0.2.0
- Refactorización en módulos
- Modo pipeline (5 en paralelo)
- Sistema de reintentos automáticos
- Triple verificación de prompts

### v0.1.0
- Versión inicial
- Automatización secuencial
- Panel lateral con configuración
