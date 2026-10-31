import proj4 from 'proj4'
import { forward as toMgrs } from 'mgrs'
import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson'

/** A grid zone designator cell, e.g. 33V, in lon/lat degrees. */
interface ZoneCell {
  zone: number
  band: string
  west: number
  east: number
  south: number
  north: number
}

type Bounds = { west: number; south: number; east: number; north: number }

const BAND_LETTERS = 'CDEFGHJKLMNPQRSTUVWX'

/** All grid zone designator cells, including the Norway (V) and Svalbard (X) exceptions. */
const ZONE_CELLS: ZoneCell[] = (() => {
  const cells: ZoneCell[] = []
  for (let b = 0; b < BAND_LETTERS.length; b++) {
    const band = BAND_LETTERS[b]
    const south = -80 + b * 8
    const north = band === 'X' ? 84 : south + 8
    for (let zone = 1; zone <= 60; zone++) {
      let west = -180 + (zone - 1) * 6
      let east = west + 6
      if (band === 'V' && zone === 31) east = 3
      if (band === 'V' && zone === 32) west = 3
      if (band === 'X') {
        if (zone === 32 || zone === 34 || zone === 36) continue
        if (zone === 31) east = 9
        if (zone === 33) [west, east] = [9, 21]
        if (zone === 35) [west, east] = [21, 33]
        if (zone === 37) [west, east] = [33, 42]
      }
      cells.push({ zone, band, west, east, south, north })
    }
  }
  return cells
})()

function cellAt(lon: number, lat: number) {
  return ZONE_CELLS.find((c) => lon >= c.west && lon < c.east && lat >= c.south && lat < c.north)
}

/** UTM zone for a lon/lat, honouring the Norway and Svalbard exceptions. */
export function zoneFor(lon: number, lat: number): { zone: number; south: boolean } {
  const zone = cellAt(lon, lat)?.zone ?? Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1))
  return { zone, south: lat < 0 }
}

/** Grid zone designator for a lon/lat, e.g. "33V", or null outside MGRS's UTM area. */
export function gzdAt(lon: number, lat: number): string | null {
  const cell = cellAt(lon, lat)
  return cell ? `${cell.zone}${cell.band}` : null
}

/** A grid zone designator cell edge: part of a meridian (`value` = lon) or a parallel (`value` = lat). */
export interface GzdEdge {
  kind: 'meridian' | 'parallel'
  value: number
  /** Extent along the edge: latitudes for a meridian, longitudes for a parallel. */
  from: number
  to: number
}

/**
 * West and south edges of the GZD cells overlapping `b`, trimmed to `b`. Together they include every
 * boundary between cells in the area (each shared edge once); callers check which ones separate zones.
 */
export function gzdEdges(b: Bounds): GzdEdge[] {
  const edges: GzdEdge[] = []
  for (const c of ZONE_CELLS) {
    if (c.east <= b.west || c.west >= b.east || c.north <= b.south || c.south >= b.north) continue
    if (c.west > b.west) edges.push({ kind: 'meridian', value: c.west, from: Math.max(c.south, b.south), to: Math.min(c.north, b.north) })
    if (c.south > b.south) edges.push({ kind: 'parallel', value: c.south, from: Math.max(c.west, b.west), to: Math.min(c.east, b.east) })
  }
  return edges
}

const converters = new Map<string, proj4.Converter>()

export function utm(zone: number, south: boolean): proj4.Converter {
  const key = `${zone}${south ? 'S' : 'N'}`
  let c = converters.get(key)
  if (!c) {
    c = proj4('WGS84', `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`)
    converters.set(key, c)
  }
  return c
}

/** Grid spacing in metres suitable for the current zoom level; 0 means zone boundaries only. */
export function spacingForZoom(zoom: number): number {
  if (zoom < 5.5) return 0
  if (zoom < 7.5) return 100_000
  if (zoom < 10.5) return 10_000
  if (zoom < 13.5) return 1_000
  return 100
}

/** Margin-style short label for a grid line value. */
function lineLabel(value: number, spacing: number): string {
  switch (spacing) {
    case 100:
      return String(Math.floor(value / 100) % 1000).padStart(3, '0')
    case 1_000:
      return String(Math.floor(value / 1000) % 100).padStart(2, '0')
    case 10_000:
      return String(Math.floor(value / 10_000) % 10)
    default:
      return ''
  }
}

/** Clips a polyline to a lon/lat rectangle (Liang–Barsky per segment), returning the visible parts. */
function clipLine(points: Position[], b: Bounds): Position[][] {
  const parts: Position[][] = []
  let current: Position[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    let t0 = 0
    let t1 = 1
    const edges: [number, number][] = [
      [-dx, x0 - b.west],
      [dx, b.east - x0],
      [-dy, y0 - b.south],
      [dy, b.north - y0],
    ]
    let visible = true
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) visible = false
      } else {
        const t = q / p
        if (p < 0) t0 = Math.max(t0, t)
        else t1 = Math.min(t1, t)
      }
    }
    if (!visible || t0 > t1) {
      if (current.length > 1) parts.push(current)
      current = []
      continue
    }
    const start: Position = [x0 + t0 * dx, y0 + t0 * dy]
    const end: Position = [x0 + t1 * dx, y0 + t1 * dy]
    if (current.length === 0) current.push(start)
    current.push(end)
    if (t1 < 1) {
      parts.push(current)
      current = []
    }
  }
  if (current.length > 1) parts.push(current)
  return parts
}

function intersect(a: Bounds, b: Bounds): Bounds | null {
  const r = {
    west: Math.max(a.west, b.west),
    east: Math.min(a.east, b.east),
    south: Math.max(a.south, b.south),
    north: Math.min(a.north, b.north),
  }
  return r.west < r.east && r.south < r.north ? r : null
}

/** UTM extent of a lon/lat box, found by sampling its perimeter. */
function utmExtent(box: Bounds, conv: proj4.Converter) {
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
  const steps = 16
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const lon = box.west + t * (box.east - box.west)
    const lat = box.south + t * (box.north - box.south)
    for (const ll of [[lon, box.south], [lon, box.north], [box.west, lat], [box.east, lat]]) {
      const [e, n] = conv.forward(ll)
      minE = Math.min(minE, e); maxE = Math.max(maxE, e)
      minN = Math.min(minN, n); maxN = Math.max(maxN, n)
    }
  }
  return { minE, maxE, minN, maxN }
}

const MAX_LINES_PER_AXIS = 300
const SAMPLES_PER_LINE = 32

/** Builds MGRS grid lines, zone boundaries and square labels for the visible area. */
export function buildGrid(view: Bounds, zoom: number): FeatureCollection<LineString | Point> {
  const spacing = spacingForZoom(zoom)
  const features: Feature<LineString | Point>[] = []
  const clamped: Bounds = {
    west: Math.max(view.west, -180),
    east: Math.min(view.east, 180),
    south: Math.max(view.south, -80),
    north: Math.min(view.north, 84),
  }

  for (const cell of ZONE_CELLS) {
    const box = intersect(cell, clamped)
    if (!box) continue

    // Zone (GZD) boundary
    const outline: Position[] = [
      [cell.west, cell.south], [cell.east, cell.south], [cell.east, cell.north], [cell.west, cell.north], [cell.west, cell.south],
    ]
    for (const part of clipLine(outline, clamped)) {
      features.push({ type: 'Feature', properties: { kind: 'zone' }, geometry: { type: 'LineString', coordinates: part } })
    }
    if (spacing === 0 || spacing === 100_000) {
      features.push({
        type: 'Feature',
        properties: { kind: 'gzd', label: `${cell.zone}${cell.band}` },
        geometry: { type: 'Point', coordinates: [(box.west + box.east) / 2, (box.south + box.north) / 2] },
      })
    }

    if (spacing === 0) continue

    const conv = utm(cell.zone, cell.north <= 0)
    const { minE, maxE, minN, maxN } = utmExtent(box, conv)
    if ((maxE - minE) / spacing > MAX_LINES_PER_AXIS || (maxN - minN) / spacing > MAX_LINES_PER_AXIS) continue

    const firstE = Math.ceil(minE / spacing) * spacing
    const firstN = Math.ceil(minN / spacing) * spacing

    // Lines of constant easting
    for (let e = firstE; e <= maxE; e += spacing) {
      const pts: Position[] = []
      for (let i = 0; i <= SAMPLES_PER_LINE; i++) pts.push(conv.inverse([e, minN + (i / SAMPLES_PER_LINE) * (maxN - minN)]))
      for (const part of clipLine(pts, box)) {
        features.push({ type: 'Feature', properties: { kind: 'line', label: lineLabel(e, spacing) }, geometry: { type: 'LineString', coordinates: part } })
      }
    }
    // Lines of constant northing
    for (let n = firstN; n <= maxN; n += spacing) {
      const pts: Position[] = []
      for (let i = 0; i <= SAMPLES_PER_LINE; i++) pts.push(conv.inverse([minE + (i / SAMPLES_PER_LINE) * (maxE - minE), n]))
      for (const part of clipLine(pts, box)) {
        features.push({ type: 'Feature', properties: { kind: 'line', label: lineLabel(n, spacing) }, geometry: { type: 'LineString', coordinates: part } })
      }
    }

    // 100 km square IDs (e.g. "33V UE") at the centre of each square inside this zone
    if (spacing >= 10_000) {
      for (let e = Math.floor(minE / 100_000) * 100_000; e < maxE; e += 100_000) {
        for (let n = Math.floor(minN / 100_000) * 100_000; n < maxN; n += 100_000) {
          const [lon, lat] = conv.inverse([e + 50_000, n + 50_000])
          if (lon < box.west || lon > box.east || lat < box.south || lat > box.north) continue
          features.push({
            type: 'Feature',
            properties: { kind: 'square', label: formatMgrs(toMgrs([lon, lat], 0)) },
            geometry: { type: 'Point', coordinates: [lon, lat] },
          })
        }
      }
    }
  }

  return { type: 'FeatureCollection', features }
}

/** "33VUE1234567890" → "33V UE 12345 67890" */
export function formatMgrs(ref: string): string {
  const m = /^(\d{1,2}[C-X])([A-Z]{2})(\d*)$/.exec(ref.replace(/\s+/g, ''))
  if (!m) return ref
  const [, gzd, square, digits] = m
  if (!digits) return `${gzd} ${square}`
  const half = digits.length / 2
  return `${gzd} ${square} ${digits.slice(0, half)} ${digits.slice(half)}`
}

/** MGRS reference for a lon/lat at the given total digit count (4, 6, 8 or 10). */
export function mgrsAt(lngLat: [number, number], digits: 4 | 6 | 8 | 10 = 10): string | null {
  try {
    return formatMgrs(toMgrs(lngLat, digits / 2))
  } catch {
    return null // outside MGRS/UTM coverage (polar regions)
  }
}
