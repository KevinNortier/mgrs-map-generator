import { Map } from 'maplibre-gl'
import { buildStyle, marshPattern, type Palette } from '../map/style'
import { mercator } from './north'
import { CONTOUR_INTERVAL, sheetGrid, sheetLayout, type Sheet } from './sheet'

/** CSS pixels per mm at the browser's reference 96 DPI. Line widths in the style are tuned for this. */
const CSS_PX_PER_MM = 96 / 25.4
const TIMEOUT_MS = 90_000
/** Upper bound for one WebGL canvas side, to keep memory use reasonable even on capable GPUs. */
const MAX_TILE_PX = 4096

export interface RenderOptions {
  /** Output resolution in dots per inch. */
  dpi: number
  /** JPEG keeps large renders small; PNG is lossless. */
  format?: 'image/jpeg' | 'image/png'
  /** Called after each rendered tile. */
  onProgress?: (done: number, total: number) => void
}

/** Largest canvas side this device's WebGL can render, capped at MAX_TILE_PX. */
function maxTileSize(): number {
  const canvas = document.createElement('canvas')
  const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
  if (!gl) return 2048
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
  const size = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), viewport[0], viewport[1])
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return Math.min(size, MAX_TILE_PX)
}

function waitForIdle(map: Map): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Map rendering timed out')), TIMEOUT_MS)
    map.once('idle', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Renders the sheet's map frame off-screen and returns it as a data URL.
 *
 * The map is laid out at 96 DPI (so symbol sizes match the screen style) and rendered with
 * pixelRatio = dpi / 96. Zoom and bearing are chosen so the image covers exactly the sheet's
 * UTM rectangle with grid north up. Frames larger than the GPU can render in one go are
 * rendered as tiles, by panning one tile-sized map across the frame, and stitched together.
 */
export async function renderMapImage(
  sheet: Sheet,
  palette: Palette,
  { dpi, format = 'image/jpeg', onProgress }: RenderOptions,
): Promise<string> {
  const { frame } = sheetLayout(sheet)
  const cssWidth = Math.round(frame.width * CSS_PX_PER_MM)
  const cssHeight = Math.round(frame.height * CSS_PX_PER_MM)
  const pixelRatio = dpi / 96

  const { conv, minE, maxE, minN, maxN } = sheetGrid(sheet)
  const cE = (minE + maxE) / 2
  const cN = (minN + maxN) / 2
  const west = mercator(conv.inverse([minE, cN]))
  const east = mercator(conv.inverse([maxE, cN]))
  const south = mercator(conv.inverse([cE, minN]))
  const north = mercator(conv.inverse([cE, maxN]))
  // Mercator world units across the frame width → zoom (world = 512 * 2^zoom CSS px)
  const widthWorld = Math.hypot(east[0] - west[0], east[1] - west[1])
  const zoom = Math.log2(cssWidth / (widthWorld * 512))
  // Compass direction of grid north, which should point up
  const bearing = (Math.atan2(north[0] - south[0], south[1] - north[1]) * 180) / Math.PI
  const center = conv.inverse([cE, cN]) as [number, number]

  const limit = maxTileSize()
  const tileCssMax = Math.floor(limit / pixelRatio)
  const cols = Math.ceil(cssWidth / tileCssMax)
  const rows = Math.ceil(cssHeight / tileCssMax)
  const tileWidth = Math.ceil(cssWidth / cols)
  const tileHeight = Math.ceil(cssHeight / rows)

  const output = document.createElement('canvas')
  output.width = Math.round(cssWidth * pixelRatio)
  output.height = Math.round(cssHeight * pixelRatio)
  const ctx = output.getContext('2d')
  if (!ctx) throw new Error('Could not create a canvas for the map image')
  ctx.fillStyle = palette.paper
  ctx.fillRect(0, 0, output.width, output.height)

  const container = document.createElement('div')
  Object.assign(container.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${tileWidth}px`,
    height: `${tileHeight}px`,
  })
  document.body.appendChild(container)

  const map = new Map({
    container,
    style: buildStyle(palette, { print: { contourInterval: CONTOUR_INTERVAL[sheet.scale] } }),
    center,
    zoom,
    bearing,
    pixelRatio,
    maxCanvasSize: [limit, limit],
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  })
  map.setMissingStyleImageResolver((id) => {
    if (id === 'marsh') map.addImage('marsh', marshPattern(palette.waterway))
  })
  map.on('error', (e) => console.warn('Print map:', e.error?.message ?? e))

  try {
    await waitForIdle(map)
    const total = cols * rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * tileWidth
        const y = r * tileHeight
        if (total > 1) {
          const idle = waitForIdle(map)
          map.jumpTo({ center })
          // Offset of this tile's centre from the frame centre, in (rotated) screen pixels
          map.panBy([x + tileWidth / 2 - cssWidth / 2, y + tileHeight / 2 - cssHeight / 2], { animate: false })
          map.triggerRepaint()
          await idle
        }
        // Snap tile edges to whole output pixels and overlap by one, so joins leave no anti-aliased seam.
        const dx = Math.round(x * pixelRatio)
        const dy = Math.round(y * pixelRatio)
        const dw = Math.round((x + tileWidth) * pixelRatio) - dx + (c < cols - 1 ? 1 : 0)
        const dh = Math.round((y + tileHeight) * pixelRatio) - dy + (r < rows - 1 ? 1 : 0)
        ctx.drawImage(map.getCanvas(), dx, dy, dw, dh)
        onProgress?.(r * cols + c + 1, total)
      }
    }
    return output.toDataURL(format, 0.9)
  } finally {
    map.remove()
    container.remove()
  }
}
