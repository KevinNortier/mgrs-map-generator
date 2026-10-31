import { forward as toMgrs } from 'mgrs'
import type proj4 from 'proj4'
import { formatMgrs, gzdAt, gzdEdges, utm, zoneFor } from '../mgrs/grid'
import { GRID_SPACING, sheetGrid, sheetLayout, type Sheet } from './sheet'

/**
 * Grid zones and 100 km squares on a sheet, in paper millimetres.
 *
 * The frame and map image follow the grid of the zone at the sheet centre (the primary zone). Where
 * a grid zone junction crosses the sheet, each zone's grid is drawn only within its own zone, as on
 * NATO sheets, so every printed grid line gives a true MGRS reference. Lines of other zones are
 * slightly curved and rotated on the paper; they are computed through lon/lat and clipped exactly
 * at the junction.
 */

export type Pt = [number, number]

export interface GridLine {
  axis: 'e' | 'n'
  /** Easting or northing in metres, in the line's own zone. */
  value: number
  /** Visible parts of the line on the paper. */
  runs: Pt[][]
  /** Straight on the paper (primary zone): each run can be drawn from its first to its last point. */
  straight: boolean
}

export interface ZoneGrid {
  zone: number
  conv: proj4.Converter
  primary: boolean
  lines: GridLine[]
}

/** A 100 km square on the sheet, e.g. "32V PJ". */
export interface SquareRegion {
  id: string
  gzd: string
  square: string
  /** Centroid on the paper. */
  x: number
  y: number
  /** Share of the frame area, 0–1. */
  share: number
  /** Extent on the paper: [left, top, right, bottom]. */
  bounds: [number, number, number, number]
}

export interface SheetZones {
  /** Primary zone first. */
  zones: ZoneGrid[]
  /** Grid zone junctions: lines where the UTM zone changes. */
  junctions: Pt[][]
  /** Latitude band boundaries within one zone (the GZD letter changes, the grid does not). */
  bandEdges: Pt[][]
  /** 100 km squares, largest first. */
  regions: SquareRegion[]
  /** Full GZD and square at a paper point, e.g. "32V PJ". */
  squareAt(p: Pt): string | null
  inFrame(p: Pt): boolean
}

/** Splits a polyline into the parts where `inside` holds, finding each crossing by bisection. */
function clipRuns(pts: Pt[], inside: (p: Pt) => boolean): Pt[][] {
  const crossing = (a: Pt, b: Pt): Pt => {
    // a inside, b outside
    let lo = a
    let hi = b
    for (let i = 0; i < 30; i++) {
      const mid: Pt = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]
      if (inside(mid)) lo = mid
      else hi = mid
    }
    return lo
  }
  const runs: Pt[][] = []
  let run: Pt[] | null = null
  let prev = pts[0]
  let prevIn = inside(prev)
  if (prevIn) run = [prev]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    const pIn = inside(p)
    if (pIn && !prevIn) run = [crossing(p, prev)]
    if (!pIn && prevIn && run) {
      run.push(crossing(prev, p))
      if (run.length > 1) runs.push(run)
      run = null
    }
    if (pIn) run!.push(p)
    prev = p
    prevIn = pIn
  }
  if (run && run.length > 1) runs.push(run)
  return runs
}

/** Points from a to b, at most `step` apart. */
function densify(a: Pt, b: Pt, step: number): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt)
}

/** Sample spacing along lines, in paper mm. */
const STEP = 2

export function sheetZones(sheet: Sheet): SheetZones {
  const { frame } = sheetLayout(sheet)
  const g = sheetGrid(sheet)
  const k = sheet.scale / 1000 // ground metres per paper mm
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height
  const spacing = GRID_SPACING[sheet.scale]

  const toLonLat = ([x, y]: Pt) => g.conv.inverse([g.minE + (x - frame.x) * k, g.maxN - (y - frame.y) * k]) as Pt
  const toPaper = (lonLat: Pt): Pt => {
    const [e, n] = g.conv.forward(lonLat)
    return [frame.x + (e - g.minE) / k, frame.y + (g.maxN - n) / k]
  }
  const EPS = 1e-6
  const inFrame = ([x, y]: Pt) => x >= frame.x - EPS && x <= right + EPS && y >= frame.y - EPS && y <= bottom + EPS
  const zoneAt = (p: Pt) => {
    const [lon, lat] = toLonLat(p)
    return zoneFor(lon, lat).zone
  }
  const squareAt = (p: Pt) => {
    try {
      return formatMgrs(toMgrs(toLonLat(p), 0))
    } catch {
      return null // outside MGRS coverage
    }
  }

  // The frame outline, finely sampled. A zone's area is always far larger than a sheet, so every
  // zone on the sheet reaches the frame edge.
  const outline: Pt[] = [
    ...densify([frame.x, frame.y], [right, frame.y], 0.5),
    ...densify([right, frame.y], [right, bottom], 0.5),
    ...densify([right, bottom], [frame.x, bottom], 0.5),
    ...densify([frame.x, bottom], [frame.x, frame.y], 0.5),
  ]
  const zoneNumbers = [g.zone, ...new Set(outline.map(zoneAt).filter((z) => z !== g.zone))]
  const single = zoneNumbers.length === 1

  const zones: ZoneGrid[] = zoneNumbers.map((zone) => {
    const primary = zone === g.zone
    const conv = primary ? g.conv : utm(zone, g.south)
    const inside = single ? inFrame : (p: Pt) => inFrame(p) && zoneAt(p) === zone
    const lines: GridLine[] = []
    if (primary) {
      for (let e = Math.ceil(g.minE / spacing) * spacing; e <= g.maxE; e += spacing) {
        const x = frame.x + (e - g.minE) / k
        lines.push({ axis: 'e', value: e, straight: true, runs: clipRuns(densify([x, frame.y], [x, bottom], STEP), inside) })
      }
      for (let n = Math.ceil(g.minN / spacing) * spacing; n <= g.maxN; n += spacing) {
        const y = frame.y + (g.maxN - n) / k
        lines.push({ axis: 'n', value: n, straight: true, runs: clipRuns(densify([frame.x, y], [right, y], STEP), inside) })
      }
    } else {
      // Extent of the frame in this zone's grid, with a margin
      const own = outline.filter((_, i) => i % 10 === 0).map((p) => conv.forward(toLonLat(p)))
      const minE = Math.min(...own.map((p) => p[0])) - spacing
      const maxE = Math.max(...own.map((p) => p[0])) + spacing
      const minN = Math.min(...own.map((p) => p[1])) - spacing
      const maxN = Math.max(...own.map((p) => p[1])) + spacing
      const step = STEP * k
      const trace = (from: Pt, to: Pt) =>
        densify(from, to, step).map((p) => toPaper(conv.inverse(p) as Pt))
      for (let e = Math.ceil(minE / spacing) * spacing; e <= maxE; e += spacing) {
        const runs = clipRuns(trace([e, minN], [e, maxN]), inside)
        if (runs.length) lines.push({ axis: 'e', value: e, straight: false, runs })
      }
      for (let n = Math.ceil(minN / spacing) * spacing; n <= maxN; n += spacing) {
        const runs = clipRuns(trace([minE, n], [maxE, n]), inside)
        if (runs.length) lines.push({ axis: 'n', value: n, straight: false, runs })
      }
    }
    return { zone, conv, primary, lines }
  })

  // Zone junctions and band boundaries, from the GZD cell edges around the sheet
  const junctions: Pt[][] = []
  const bandEdges: Pt[][] = []
  const lonLats = outline.map(toLonLat)
  const bounds = {
    west: Math.min(...lonLats.map((p) => p[0])),
    east: Math.max(...lonLats.map((p) => p[0])),
    south: Math.min(...lonLats.map((p) => p[1])),
    north: Math.max(...lonLats.map((p) => p[1])),
  }
  const D = 1e-7
  for (const edge of gzdEdges(bounds)) {
    const lonLatAt = (t: number): Pt => (edge.kind === 'meridian' ? [edge.value, t] : [t, edge.value])
    // The two sides of the edge at a paper point on it
    const sides = (p: Pt): [Pt, Pt] => {
      const [lon, lat] = toLonLat(p)
      return edge.kind === 'meridian'
        ? [[edge.value - D, lat], [edge.value + D, lat]]
        : [[lon, edge.value - D], [lon, edge.value + D]]
    }
    const zoneChange = (p: Pt) => {
      const [a, b] = sides(p)
      return zoneFor(a[0], a[1]).zone !== zoneFor(b[0], b[1]).zone
    }
    const bandChange = (p: Pt) => {
      const [a, b] = sides(p)
      return !zoneChange(p) && gzdAt(a[0], a[1]) !== gzdAt(b[0], b[1])
    }
    const n = 200
    const pts = Array.from({ length: n + 1 }, (_, i) => toPaper(lonLatAt(edge.from + ((edge.to - edge.from) * i) / n)))
    junctions.push(...clipRuns(pts, (p) => inFrame(p) && zoneChange(p)))
    bandEdges.push(...clipRuns(pts, (p) => inFrame(p) && bandChange(p)))
  }

  // 100 km squares: sample the frame on a raster
  const cols = 80
  const rows = Math.max(20, Math.round((cols * frame.height) / frame.width))
  const cellW = frame.width / cols
  const cellH = frame.height / rows
  const acc = new Map<string, { n: number; x: number; y: number; bounds: [number, number, number, number] }>()
  const add = (id: string, p: Pt, count: boolean, halfW: number, halfH: number) => {
    const a = acc.get(id) ?? { n: 0, x: 0, y: 0, bounds: [Infinity, Infinity, -Infinity, -Infinity] }
    if (count) {
      a.n++
      a.x += p[0]
      a.y += p[1]
    }
    const b = a.bounds
    a.bounds = [Math.min(b[0], p[0] - halfW), Math.min(b[1], p[1] - halfH), Math.max(b[2], p[0] + halfW), Math.max(b[3], p[1] + halfH)]
    acc.set(id, a)
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const p: Pt = [frame.x + cellW * (i + 0.5), frame.y + cellH * (j + 0.5)]
      const id = squareAt(p)
      if (id) add(id, p, true, cellW / 2, cellH / 2)
    }
  }
  // Squares only touching the frame edge, missed by the raster
  for (const p of outline) {
    const id = squareAt(p)
    if (id && !(acc.get(id)?.n)) add(id, p, false, 0, 0)
  }
  const regions: SquareRegion[] = [...acc]
    .map(([id, a]) => {
      const [gzd, square] = id.split(' ')
      const [l, t, r, b] = a.bounds
      const x = a.n ? a.x / a.n : (l + r) / 2
      const y = a.n ? a.y / a.n : (t + b) / 2
      return { id, gzd, square, x, y, share: a.n / (cols * rows), bounds: a.bounds }
    })
    .sort((a, b) => b.share - a.share)

  return { zones, junctions, bandEdges, regions, squareAt, inFrame }
}
