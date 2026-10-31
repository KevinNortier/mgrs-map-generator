import type { FeatureCollection, Position } from 'geojson'
import { utm, zoneFor } from '../mgrs/grid'
import { decodeExample, encodeExample, type ExampleSetting } from './example'
import { SHEET_LAYER_GROUPS, type MapStyleId, type SheetLayers } from '../map/style'

export type Paper = 'a4' | 'a3'
export type Orientation = 'portrait' | 'landscape'
export type Scale = 10_000 | 25_000 | 50_000

export interface Sheet {
  title: string
  paper: Paper
  orientation: Orientation
  scale: Scale
  /** Centre of the map frame, [lon, lat]. */
  center: [number, number]
  /** Worked example in the grid reference box. */
  example: ExampleSetting
  /** Map style, on screen and in print. */
  style: MapStyleId
  /** Hillshade, contours and grid on or off, on screen and in print. */
  layers: SheetLayers
  /** Scale bars in the margin. */
  scaleBars: ScaleBars
}

/** Metric bar (metres or kilometres), imperial bar (yards or statute miles), or both. */
export type ScaleBars = 'metric' | 'imperial' | 'both'
export const SCALE_BARS: ScaleBars[] = ['metric', 'imperial', 'both']

export const PAPERS: Record<Paper, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 },
}

export const SCALES: Scale[] = [10_000, 25_000, 50_000]

/** Contour interval in metres per scale. */
export const CONTOUR_INTERVAL: Record<Scale, number> = { 10_000: 5, 25_000: 10, 50_000: 20 }

/** Printed grid spacing in metres per scale. */
export const GRID_SPACING: Record<Scale, number> = { 10_000: 100, 25_000: 1_000, 50_000: 1_000 }

/** Marginal information blocks below the map frame, in layout order. Sizes in mm. */
export type BlockId = 'legend' | 'scale' | 'north' | 'squares' | 'gridref'
const BLOCKS: { id: BlockId; width: number }[] = [
  { id: 'legend', width: 56 },
  { id: 'scale', width: 64 },
  { id: 'north', width: 48 },
  { id: 'squares', width: 34 },
  { id: 'gridref', width: 56 },
]
export const BLOCK_HEIGHT = 34
const BLOCK_GAP = 4
const ROW_GAP = 4
/** Room for grid labels outside the neatline. */
export const LABEL_BAND = 5
/** Attribution line at the very bottom of the sheet. */
export const FOOTER_BAND = 6
const SIDE = 10
const TOP = 16

export interface SheetLayout {
  paper: { width: number; height: number }
  /** Map frame (neatline) position and size on the paper, in mm. */
  frame: { x: number; y: number; width: number; height: number }
  blocks: { id: BlockId; x: number; y: number; width: number; height: number }[]
}

export function paperSizeMm(sheet: Pick<Sheet, 'paper' | 'orientation'>) {
  const { width, height } = PAPERS[sheet.paper]
  return sheet.orientation === 'portrait' ? { width, height } : { width: height, height: width }
}

/**
 * Lays out the sheet: blocks are packed into rows below the frame (one row on A4 landscape and A3,
 * two on A4 portrait), and the frame takes the remaining space.
 */
export function sheetLayout(sheet: Pick<Sheet, 'paper' | 'orientation'>): SheetLayout {
  const paper = paperSizeMm(sheet)
  const available = paper.width - 2 * SIDE
  const rows: (typeof BLOCKS)[] = [[]]
  let used = 0
  for (const block of BLOCKS) {
    const row = rows[rows.length - 1]
    const needed = (row.length ? BLOCK_GAP : 0) + block.width
    if (row.length && used + needed > available) {
      rows.push([block])
      used = block.width
    } else {
      row.push(block)
      used += needed
    }
  }
  const bottom = LABEL_BAND + rows.length * BLOCK_HEIGHT + (rows.length - 1) * ROW_GAP + FOOTER_BAND
  const frame = { x: SIDE, y: TOP, width: available, height: paper.height - TOP - bottom }

  const blocks: SheetLayout['blocks'] = []
  rows.forEach((row, r) => {
    const y = frame.y + frame.height + LABEL_BAND + r * (BLOCK_HEIGHT + ROW_GAP)
    // Spread a full row over the whole width; a row with a single block stays left-aligned.
    const total = row.reduce((sum, b) => sum + b.width, 0)
    const gap = row.length > 1 ? (available - total) / (row.length - 1) : 0
    let x = SIDE
    for (const b of row) {
      blocks.push({ id: b.id, x, y, width: b.width, height: BLOCK_HEIGHT })
      x += b.width + gap
    }
  })
  return { paper, frame, blocks }
}

/** Map frame size in mm, i.e. the paper minus the margins. */
export function frameSizeMm(sheet: Pick<Sheet, 'paper' | 'orientation'>) {
  const { width, height } = sheetLayout(sheet).frame
  return { width, height }
}

/** Ground extent of the map frame in grid metres. */
export function groundSizeM(sheet: Sheet) {
  const frame = frameSizeMm(sheet)
  return { width: (frame.width * sheet.scale) / 1000, height: (frame.height * sheet.scale) / 1000 }
}

/**
 * The map frame is a rectangle in the UTM grid of the zone containing the sheet centre,
 * so grid lines run parallel to the sheet edges as on NATO topographic maps.
 */
export function sheetGrid(sheet: Sheet) {
  const { zone, south } = zoneFor(sheet.center[0], sheet.center[1])
  const conv = utm(zone, south)
  const [e, n] = conv.forward(sheet.center)
  const { width, height } = groundSizeM(sheet)
  return { zone, south, conv, minE: e - width / 2, maxE: e + width / 2, minN: n - height / 2, maxN: n + height / 2 }
}

/** Frame outline in lon/lat, densified so it follows the grid on a Web Mercator map. */
export function sheetOutline(sheet: Sheet): Position[] {
  const g = sheetGrid(sheet)
  const corners: [number, number][] = [
    [g.minE, g.minN],
    [g.maxE, g.minN],
    [g.maxE, g.maxN],
    [g.minE, g.maxN],
  ]
  const steps = 8
  const ring: Position[] = []
  for (let i = 0; i < 4; i++) {
    const [e0, n0] = corners[i]
    const [e1, n1] = corners[(i + 1) % 4]
    for (let s = 0; s < steps; s++) ring.push(g.conv.inverse([e0 + ((e1 - e0) * s) / steps, n0 + ((n1 - n0) * s) / steps]))
  }
  ring.push(ring[0])
  return ring
}

export function sheetGeoJSON(sheet: Sheet): FeatureCollection {
  const outline = sheetOutline(sheet)
  const world: Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'mask' }, geometry: { type: 'Polygon', coordinates: [world, [...outline].reverse()] } },
      { type: 'Feature', properties: { kind: 'frame' }, geometry: { type: 'Polygon', coordinates: [outline] } },
    ],
  }
}

// URL hash state: `#map=…&sheet=a4-landscape-25000&at=59.33,18.07&title=…&ex=…&style=…` (the map position is managed by MapLibre).
// Free text is base64url-encoded because MapLibre rewrites the hash with decodeURIComponent,
// which would break text containing & or =.

function encodeText(title: string) {
  const bytes = new TextEncoder().encode(title)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeText(encoded: string) {
  try {
    const bin = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/** `hide=hillshade,contours` → layers with those groups off. */
function decodeHidden(value: string): SheetLayers {
  const hidden = value.split(',')
  return Object.fromEntries(SHEET_LAYER_GROUPS.map((g) => [g, !hidden.includes(g)])) as SheetLayers
}

export function readSheetFromHash(fallback: Sheet): Sheet {
  const params = new URLSearchParams(location.hash.slice(1))
  const [paper, orientation, scale] = (params.get('sheet') ?? '').split('-')
  const [lat, lon] = (params.get('at') ?? '').split(',').map(Number)
  const title = params.has('title') ? decodeText(params.get('title')!) : null
  return {
    title: title ?? fallback.title,
    paper: paper in PAPERS ? (paper as Paper) : fallback.paper,
    orientation: orientation === 'portrait' || orientation === 'landscape' ? orientation : fallback.orientation,
    scale: SCALES.includes(Number(scale) as Scale) ? (Number(scale) as Scale) : fallback.scale,
    center: Number.isFinite(lat) && Number.isFinite(lon) && params.has('at') ? [lon, lat] : fallback.center,
    example: params.has('ex') ? decodeExample(params.get('ex'), decodeText) : fallback.example,
    style: params.get('style') === 'orienteering' ? 'orienteering' : fallback.style,
    layers: params.has('hide') ? decodeHidden(params.get('hide')!) : fallback.layers,
    scaleBars: SCALE_BARS.includes(params.get('bars') as ScaleBars) ? (params.get('bars') as ScaleBars) : fallback.scaleBars,
  }
}

export function writeSheetToHash(sheet: Sheet) {
  const params = new URLSearchParams(location.hash.slice(1))
  params.set('sheet', `${sheet.paper}-${sheet.orientation}-${sheet.scale}`)
  params.set('at', `${sheet.center[1].toFixed(5)},${sheet.center[0].toFixed(5)}`)
  if (sheet.title) params.set('title', encodeText(sheet.title))
  else params.delete('title')
  const ex = encodeExample(sheet.example, encodeText)
  if (ex) params.set('ex', ex)
  else params.delete('ex')
  if (sheet.style !== 'military') params.set('style', sheet.style)
  else params.delete('style')
  const hidden = SHEET_LAYER_GROUPS.filter((g) => !sheet.layers[g])
  if (hidden.length) params.set('hide', hidden.join(','))
  else params.delete('hide')
  if (sheet.scaleBars !== 'metric') params.set('bars', sheet.scaleBars)
  else params.delete('bars')
  // Keep the hash readable: MapLibre's own entry uses literal slashes.
  history.replaceState(history.state, '', `#${decodeURIComponent(params.toString())}`)
}
