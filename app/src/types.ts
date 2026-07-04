// Shared data model for the LCD layout editor.

export const PANEL_W = 1920
export const PANEL_H = 480

export interface Sensors {
  cpuTemp: number | null
  cpuLoad: number | null
  cpuPower: number | null
  cpuClock: number | null
  gpuTemp: number | null
  gpuLoad: number | null
  gpuPower: number | null
  ramLoad: number | null
  netUp: number | null   // MB/s
  netDown: number | null // MB/s
  diskLoad: number | null // %
}

export const EMPTY_SENSORS: Sensors = {
  cpuTemp: null, cpuLoad: null, cpuPower: null, cpuClock: null,
  gpuTemp: null, gpuLoad: null, gpuPower: null, ramLoad: null,
  netUp: null, netDown: null, diskLoad: null,
}

export type SensorMetric = keyof Sensors

// LCD widget font choices (bundled via @fontsource, preloaded in App).
export type WidgetFont = 'orbitron' | 'rajdhani' | 'inter'

interface Base {
  id: string
  x: number
  y: number
  opacity?: number // 0..1, default 1
  // Editor-only flags (LayerPanel toggles). Hidden widgets are not painted;
  // locked widgets paint but resist stage-side drag / click-select.
  hidden?: boolean
  locked?: boolean
}

export interface TextWidget extends Base {
  type: 'text'
  text: string
  fontSize: number
  color: string
  bold: boolean
  font?: WidgetFont // default rajdhani
}

export interface ClockWidget extends Base {
  type: 'clock'
  withDate: boolean
  fontSize: number
  color: string
  bold: boolean
  font?: WidgetFont      // default orbitron
  twelveHour?: boolean   // default false (24h)
  showSeconds?: boolean  // default true
}

export interface SensorWidget extends Base {
  type: 'sensor'
  metric: SensorMetric
  label: string
  unit: string
  fontSize: number
  color: string
  bold: boolean
  font?: WidgetFont // default orbitron
}

export interface BarWidget extends Base {
  type: 'bar'
  metric: SensorMetric
  width: number
  height: number
  max: number
  color: string
  label?: string // optional caption row (label left, live value right) above the bar
  panelBlur?: number // frosted-glass backdrop blur px (0/undefined = plain tint)
  // Threshold coloring: fill switches to warnColor at warnAt, critColor at critAt.
  warnAt?: number
  critAt?: number
  warnColor?: string // default '#ffb74d'
  critColor?: string // default '#ff5252'
}

export interface ImageWidget extends Base {
  type: 'image'
  src: string // data URL
  width: number
  height: number
}

export interface GaugeWidget extends Base {
  type: 'gauge'
  metric: SensorMetric
  max: number
  size: number
  color: string
  label: string
  panelBlur?: number // frosted-glass backdrop blur px on the disc
}

export interface GraphWidget extends Base {
  type: 'graph'
  metric: SensorMetric
  width: number
  height: number
  max: number
  color: string
  label: string
  panelBlur?: number // frosted-glass backdrop blur px on the card
  // Threshold zones drawn as tinted bands from the top of the plot down to the
  // threshold (values above are in the "warn" or "crit" zone).
  warnAt?: number
  critAt?: number
  warnColor?: string // default '#ffb74d'
  critColor?: string // default '#ff5252'
}

export interface MediaWidget extends Base {
  type: 'media'
  width: number
  height: number
  color: string // accent (progress bar, placeholder art)
  panelBlur?: number // frosted-glass backdrop blur px on the card
}

export interface WeatherWidget extends Base {
  type: 'weather'
  place: string // display name (resolved via Open-Meteo geocoding)
  lat: number
  lon: number
  width: number
  height: number
  color: string // temperature accent
  panelBlur?: number
}

export interface VisualizerWidget extends Base {
  type: 'visualizer'
  width: number
  height: number
  bars: number
  color: string
  color2?: string // gradient top color (defaults to color)
  centered?: boolean // bars grow from the vertical center (default) vs bottom
}

export type Widget =
  | TextWidget | ClockWidget | SensorWidget | BarWidget | ImageWidget | GaugeWidget
  | GraphWidget | MediaWidget | WeatherWidget | VisualizerWidget

// Now-playing state pushed by the backend (Windows.Media.Control session).
export interface MediaState {
  hasMedia: boolean
  app: string
  title: string
  artist: string
  album: string
  playing: boolean
  pos: number // seconds at receivedAt — extrapolate client-side while playing
  dur: number // seconds (0 = app doesn't report a timeline)
  thumb: string | null // album art data URL
  receivedAt: number // client clock ms when this state arrived
}

export interface Layout {
  v?: number // layout schema/design version — bump LAYOUT_VERSION to retire stale saved layouts
  bgColor: string
  bgImage: string | null // data URL or IDB sentinel ('idb:bg' / 'idb:bg-video')
  // The panel is mounted upside-down in the case — outgoing frames are rotated
  // 180° (editor view stays upright). Undefined means true (the common mounting).
  rotate180?: boolean
  // Physical panel orientation on the case: 0/90/180/270°. Rotation is applied
  // to the outgoing frame only (editor stays in native 1920x480). If set,
  // takes precedence over rotate180.
  panelRotate?: 0 | 90 | 180 | 270
  bgDim?: number  // 0..1 black overlay over the background (default 0)
  bgBlur?: number // px gaussian blur on the background image (default 0)
  // Background media transform — applied when painting the bgImage/video onto
  // the panel. Zoom / offset / rotation / flip / crop. All optional and default
  // to a "cover the panel" fit (scale=1 at that fit).
  bgScale?: number      // 0.1..4, default 1
  bgOffsetX?: number    // %, default 0 (0 = centered)
  bgOffsetY?: number    // %, default 0
  bgRotate?: number     // deg, 0..359, default 0
  bgFlipX?: boolean
  bgFlipY?: boolean
  // Crop insets — % of the source image trimmed from each edge (0..90).
  bgCropT?: number
  bgCropR?: number
  bgCropB?: number
  bgCropL?: number
  // LCD compensation: canvas ctx.filter multipliers applied to the outgoing
  // frame. 1.0 = neutral. The physical panel is fairly dim; boosting contrast
  // and saturation makes midtones read punchier (the peak brightness itself is
  // capped by the panel — brightness > 1 just clips highlights sooner).
  lcdContrast?: number
  lcdSaturation?: number
  lcdBrightness?: number
  widgets: Widget[]
}

export const LAYOUT_VERSION = 5

export const METRIC_LABELS: Record<SensorMetric, { label: string; unit: string }> = {
  cpuTemp: { label: 'CPU', unit: '°C' },
  cpuLoad: { label: 'CPU', unit: '%' },
  cpuPower: { label: 'CPU', unit: 'W' },
  cpuClock: { label: 'CPU', unit: 'MHz' },
  gpuTemp: { label: 'GPU', unit: '°C' },
  gpuLoad: { label: 'GPU', unit: '%' },
  gpuPower: { label: 'GPU', unit: 'W' },
  ramLoad: { label: 'RAM', unit: '%' },
  netUp: { label: 'NET UP', unit: 'MB/s' },
  netDown: { label: 'NET DOWN', unit: 'MB/s' },
  diskLoad: { label: 'DISK', unit: '%' },
}

// Designed default: mirrored CPU/GPU gauges on the flanks, clock + history graph
// in the middle column, load bars tucked under each gauge. No background media —
// the user picks their own (stored in IndexedDB, see bgStore.ts).
export function defaultLayout(): Layout {
  return {
    v: LAYOUT_VERSION,
    bgColor: '#0a0a0e',
    rotate180: true,
    bgImage: null,
    bgDim: 0.25, // sensible readability default once the user sets a background
    bgBlur: 0,
    widgets: [
      { id: 'cpu-g', type: 'gauge', metric: 'cpuTemp', max: 100, size: 330,
        color: '#00ffd0', label: 'CPU', x: 70, y: 38, panelBlur: 14 },
      { id: 'gpu-g', type: 'gauge', metric: 'gpuTemp', max: 100, size: 330,
        color: '#4da6ff', label: 'GPU', x: 1520, y: 38, panelBlur: 14 },
      { id: 'cpu-b', type: 'bar', metric: 'cpuLoad', label: 'CPU LOAD',
        x: 70, y: 432, width: 330, height: 18, max: 100, color: '#00ffd0' },
      { id: 'gpu-b', type: 'bar', metric: 'gpuLoad', label: 'GPU LOAD',
        x: 1520, y: 432, width: 330, height: 18, max: 100, color: '#4da6ff' },
      // x calibrated by measuring the rendered frame: the clock's fixed-width
      // box (see DashboardStage clock case) lands centered on the 1920px panel
      { id: 'clock', type: 'clock', withDate: false, x: 775, y: 26, fontSize: 64,
        color: '#ffffff', bold: false },
      // low, wide strip so the background art's focal area stays visible
      { id: 'graph', type: 'graph', metric: 'gpuLoad', label: 'GPU LOAD', max: 100,
        x: 560, y: 288, width: 800, height: 168, color: '#b18cff', panelBlur: 14 },
    ],
  }
}
