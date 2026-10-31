import { forward as toMgrs } from 'mgrs'
import type { Palette, SheetLayers } from '../map/style'
import { formatMgrs, utm, zoneFor } from '../mgrs/grid'
import { convergenceAt, formatAngle, northInfo, toMils, type NorthInfo } from './north'
import { sheetZones, type Pt, type SheetZones, type SquareRegion } from './sheet-zones'
import { resolveExample, type ResolvedExample } from './example'
import { CONTOUR_INTERVAL, GRID_SPACING, sheetGrid, sheetLayout, type Sheet, type SheetLayout } from './sheet'

// All coordinates are in millimetres on the paper. Font sizes are in mm too (1 mm ≈ 2.83 pt).

const FONT = "Arial, Helvetica, 'Liberation Sans', sans-serif"
const INK = '#000000'

type Box = SheetLayout['blocks'][number]

export interface SheetSvgOptions {
  sheet: Sheet
  palette: Palette
  /** Rendered map for the frame, as a data URL. Without it, the frame shows a placeholder. */
  mapImage?: string
  /** Only the vector overlay (no paper background or map image), for drawing on top of a separately placed map. */
  overlay?: boolean
  date?: Date
  /** Date of the map data ("2026-10-25"), printed under the legend title when known. */
  dataDate?: string | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const f = (n: number) => +n.toFixed(3)

function text(x: number, y: number, content: string, size: number, attrs = '') {
  return `<text x="${f(x)}" y="${f(y)}" font-size="${size}" ${attrs}>${content}</text>`
}

function line(x1: number, y1: number, x2: number, y2: number, width: number, attrs = '') {
  return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${INK}" stroke-width="${width}" ${attrs}/>`
}

function formatScale(scale: number) {
  return `1:${scale.toLocaleString('en-US').replace(/,/g, ' ')}`
}

export function renderSheetSvg({ sheet, palette, mapImage, overlay = false, date = new Date(), dataDate }: SheetSvgOptions): string {
  const layout = sheetLayout(sheet)
  const { paper, frame } = layout
  const grid = sheetGrid(sheet)
  const north = northInfo(sheet, date)
  const example = resolveExample(sheet, sheet.example)
  const zones = sheetZones(sheet)
  // Switched-off layers are left out: the grid and its labels, contour legend entries and notes.
  const { layers } = sheet
  const parts: string[] = []

  // Map image, clipped to the neatline
  if (overlay) {
    // Drawn by the caller underneath this overlay
  } else if (mapImage) {
    parts.push(`<rect width="${paper.width}" height="${paper.height}" fill="#ffffff"/>`)
    parts.push(`<clipPath id="frame-clip"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/></clipPath>`)
    parts.push(
      `<image href="${mapImage}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="none" clip-path="url(#frame-clip)"/>`,
    )
  } else {
    parts.push(`<rect width="${paper.width}" height="${paper.height}" fill="#ffffff"/>`)
    parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="#ecece8"/>`)
    parts.push(text(frame.x + frame.width / 2, frame.y + frame.height / 2, 'Rendering map…', 4, `text-anchor="middle" fill="#888"`))
  }

  if (layers.grid) parts.push(renderGrid(layout, zones), renderFaceDigits(sheet, layout, zones), renderSquareLabels(zones))
  // The junction is shown even without the grid: it tells which zone's references apply where.
  parts.push(renderJunctions(zones))
  if (example) parts.push(renderExampleMarker(example, sheet, layout, grid))
  parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="none" stroke="${INK}" stroke-width="0.35"/>`)

  // Each zone's grid has its own convergence, so its own grid–magnetic angle
  const gridMagnetic = zones.zones
    .map((z) => ({ zone: z.zone, angle: north.declination - convergenceAt(z.conv, sheet.center) }))
    .sort((a, b) => a.zone - b.zone)
  const zoneNames = zones.zones.map((z) => z.zone).sort((a, b) => a - b).map((z) => `${z}${grid.south ? 'S' : 'N'}`)
  parts.push(renderHeader(sheet, layout, zones, zoneNames))
  for (const box of layout.blocks) {
    if (box.id === 'legend') parts.push(renderLegend(box, palette, layers, dataDate))
    if (box.id === 'scale') parts.push(renderScaleBlock(box, sheet, zoneNames, layers.contours))
    if (box.id === 'north') parts.push(renderNorth(box, north, gridMagnetic))
    if (box.id === 'squares') parts.push(renderSquaresBlock(box, layout, zones, gridMagnetic))
    if (box.id === 'gridref') parts.push(renderGridRef(box, sheet, grid, example))
  }
  parts.push(renderFooter(layout, date))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${paper.width}mm" height="${paper.height}mm" viewBox="0 0 ${paper.width} ${paper.height}" font-family="${FONT}" fill="${INK}">${parts.join('')}</svg>`
}

type Grid = ReturnType<typeof sheetGrid>

/** Paper position of a grid coordinate. */
function toPaper(layout: SheetLayout, grid: Grid, scale: number, e: number, n: number): [number, number] {
  const k = 1000 / scale
  return [layout.frame.x + (e - grid.minE) * k, layout.frame.y + (grid.maxN - n) * k]
}

/** Splits a grid value into small leading digits, large principal (km) digits and small trailing digits. */
function splitDigits(value: number) {
  const s = String(Math.round(value))
  return { leading: s.slice(0, -5), principal: s.slice(-5, -3), hundreds: s.slice(-3, -2), trailing: s.slice(-3) }
}

/** Approximate Helvetica advance widths (em), enough to lay out the pieces of a grid label. */
function textWidth(s: string, size: number) {
  let em = 0
  for (const ch of s) em += /\d/.test(ch) ? 0.556 : ch === 'm' ? 0.833 : ch === 'E' ? 0.667 : ch === 'N' ? 0.722 : ch === ' ' || ch === '.' ? 0.278 : 0.6
  return em * size
}

const LABEL_BIG = 2.6
const LABEL_SMALL = 1.7
/** Raise of the small figures, so their tops line up with the large digits (cap height ≈ 0.72 em). */
const RAISE = 0.72 * (LABEL_BIG - LABEL_SMALL)

/**
 * A full grid value in NATO style, e.g. ⁶75⁰⁰⁰ᵐE.: small raised leading figures, large principal digits,
 * small raised trailing figures. Drawn as three pieces with explicit positions (no tspan offsets), so
 * svg2pdf lays it out like the browser. `x` is where the large digits start.
 */
function fullValue(x: number, y: number, value: number, suffix: string) {
  const d = splitDigits(value)
  const principalWidth = textWidth(d.principal, LABEL_BIG)
  return {
    principalWidth,
    width: textWidth(d.leading, LABEL_SMALL) + principalWidth + textWidth(`${d.trailing}m ${suffix}.`, LABEL_SMALL),
    leadingWidth: textWidth(d.leading, LABEL_SMALL),
    svg:
      text(x, y - RAISE, d.leading, LABEL_SMALL, 'text-anchor="end"') +
      text(x, y, d.principal, LABEL_BIG, 'font-weight="bold"') +
      text(x + principalWidth, y - RAISE, `${d.trailing}m ${suffix}.`, LABEL_SMALL),
  }
}

type Edge = 'top' | 'bottom' | 'left' | 'right'

/** A grid line end on the frame edge, to be labelled. `pos` runs along the edge (x on top/bottom, y on left/right). */
interface EdgeLabel {
  edge: Edge
  pos: number
  value: number
}

/** SVG path for a polyline; straight runs only need their ends. */
function polyline(pts: Pt[], straight: boolean, width: number, attrs = '') {
  const p = straight ? [pts[0], pts[pts.length - 1]] : pts
  return `<path d="M${p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}" fill="none" stroke="${INK}" stroke-width="${width}" ${attrs}/>`
}

/**
 * The grid of each zone on the sheet, clipped to that zone, with edge labels where its lines meet the
 * frame. Full values (small leading and trailing figures) go on the km lines nearest the ends of each
 * zone's stretch of an edge; vertically along the side margin for northings. Labels that would
 * collide, e.g. on both sides of a zone junction, give way to those of the primary zone.
 */
function renderGrid(layout: SheetLayout, zones: SheetZones) {
  const { frame } = layout
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height
  const isKm = (v: number) => Math.round(v) % 1000 === 0
  const out: string[] = ['<g>']

  const edgeOf = ([x, y]: Pt): Edge | null => {
    const tol = 0.01
    if (Math.abs(y - frame.y) < tol) return 'top'
    if (Math.abs(y - bottom) < tol) return 'bottom'
    if (Math.abs(x - frame.x) < tol) return 'left'
    if (Math.abs(x - right) < tol) return 'right'
    return null
  }

  // Occupied intervals along each label band, to keep labels apart
  const placed = new Map<string, [number, number][]>()
  const GAP = 0.6
  const tryPlace = (band: string, a: number, b: number) => {
    const list = placed.get(band) ?? []
    if (list.some(([c, d]) => a < d + GAP && b > c - GAP)) return false
    list.push([a, b])
    placed.set(band, list)
    return true
  }

  const capBig = 0.72 * LABEL_BIG
  // On a 100 m grid, vertical full northings are centred on their line (see below)
  const centred = zones.zones.some((z) => z.lines.some((l) => !isKm(l.value)))
  // Horizontal full value: where the large digits start, and its extent along the edge
  const fullE = (pos: number, value: number) => {
    const probe = fullValue(0, 0, value, 'E')
    const start = pos - probe.principalWidth / 2
    return { start, a: start - probe.leadingWidth, b: start - probe.leadingWidth + probe.width }
  }
  // Vertical full northing beside the line: above it (south end of the side) or below it (north end)
  const fullN = (pos: number, value: number, above: boolean) => {
    const probe = fullValue(0, 0, value, 'N')
    return above ? { a: pos - 2 - probe.width, b: pos - 2, probe } : { a: pos + 2, b: pos + 2 + probe.width, probe }
  }

  for (const z of zones.zones) {
    const labels: EdgeLabel[] = []
    for (const l of z.lines) {
      for (const run of l.runs) {
        out.push(polyline(run, l.straight, isKm(l.value) ? 0.15 : 0.08))
        for (const p of [run[0], run[run.length - 1]]) {
          const edge = edgeOf(p)
          if (l.axis === 'e' && (edge === 'top' || edge === 'bottom')) labels.push({ edge, pos: p[0], value: l.value })
          if (l.axis === 'n' && (edge === 'left' || edge === 'right')) labels.push({ edge, pos: p[1], value: l.value })
        }
      }
    }

    // Eastings along the top and bottom
    for (const edge of ['top', 'bottom'] as const) {
      const onEdge = labels.filter((l) => l.edge === edge).sort((a, b) => a.pos - b.pos)
      const y = edge === 'top' ? frame.y - 1.2 : bottom + 3.2
      const km = onEdge.filter((l) => isKm(l.value))
      const full = new Set<EdgeLabel>()
      for (const candidates of [km, [...km].reverse()]) {
        for (const l of candidates) {
          if (full.has(l)) break
          const { start, a, b } = fullE(l.pos, l.value)
          if (tryPlace(edge, a, b)) {
            out.push(fullValue(start, y, l.value, 'E').svg)
            full.add(l)
            break
          }
        }
      }
      // A stretch without a km line, e.g. a narrow strip of another zone on a 100 m grid, still needs a
      // full value, or its 100 m figures can't be read: put it on the first line with room.
      if (!full.size) {
        for (const l of onEdge) {
          const { start, a, b } = fullE(l.pos, l.value)
          if (tryPlace(edge, a, b)) {
            out.push(fullValue(start, y, l.value, 'E').svg)
            full.add(l)
            break
          }
        }
      }
      // 100 m figures west of a 100 km line belong to the previous 100 km square (…99 km), which no line on
      // the edge shows: give the nearest of them a full value too.
      if (km[0] && Math.round(km[0].value) % 100_000 === 0) {
        for (const l of onEdge.filter((l) => l.pos < km[0].pos).reverse()) {
          const { start, a, b } = fullE(l.pos, l.value)
          if (tryPlace(edge, a, b)) {
            out.push(fullValue(start, y, l.value, 'E').svg)
            full.add(l)
            break
          }
        }
      }
      for (const l of onEdge) {
        if (full.has(l)) continue
        const d = splitDigits(l.value)
        if (isKm(l.value)) {
          const w = textWidth(d.principal, LABEL_BIG) / 2
          if (tryPlace(edge, l.pos - w, l.pos + w)) out.push(text(l.pos, y, d.principal, LABEL_BIG, 'text-anchor="middle" font-weight="bold"'))
        } else {
          const w = textWidth(d.hundreds, LABEL_SMALL) / 2
          if (tryPlace(edge, l.pos - w, l.pos + w)) out.push(text(l.pos, edge === 'top' ? y : bottom + 2.6, d.hundreds, LABEL_SMALL, 'text-anchor="middle"'))
        }
      }
    }

    // Northings along the sides; large digits are about 2 mm tall
    for (const edge of ['left', 'right'] as const) {
      for (const l of labels.filter((l) => l.edge === edge)) {
        const d = splitDigits(l.value)
        const km = isKm(l.value)
        if (!tryPlace(edge, l.pos - (km ? 1.2 : 0.8), l.pos + (km ? 1.2 : 0.8))) continue
        const attrs = edge === 'left' ? 'text-anchor="end"' : ''
        const x = edge === 'left' ? frame.x - 1 : right + 1
        if (km) out.push(text(x, l.pos + 0.9, d.principal, LABEL_BIG, `${attrs} font-weight="bold"`))
        else out.push(text(x, l.pos + 0.6, d.hundreds, LABEL_SMALL, attrs))
      }
    }

    // Full northings written vertically in the side margin, reading upwards. On a 100 m grid they are
    // centred on their line, in a column clear of the figures beside the frame, so the large figures are
    // level with the line they belong to. On a 1 km grid the large figures beside the frame fill that
    // column, so they go beside the line instead: above it near the bottom corner, below it near the top.
    // On the left side when the zone reaches it, otherwise on the right. As for eastings, a stretch
    // without a km line gets its full value on a 100 m line, and so do the figures below a 100 km line.
    const side: Edge = labels.some((l) => l.edge === 'left') ? 'left' : 'right'
    const kmN = labels.filter((l) => l.edge === side && isKm(l.value)).sort((a, b) => b.pos - a.pos) // south first
    // In rotated coordinates +x runs up the page; glyphs sit left of the baseline.
    const offset = centred ? 5 : 3.4
    const verticalX = side === 'left' ? frame.x - offset : right + offset + capBig
    const placeN = (l: EdgeLabel, above: boolean) => {
      const probe = fullValue(0, 0, l.value, 'N')
      const half = probe.principalWidth / 2
      const { a, b } = centred
        ? { a: l.pos - half - (probe.width - probe.leadingWidth - probe.principalWidth), b: l.pos + half + probe.leadingWidth }
        : fullN(l.pos, l.value, above)
      if (!tryPlace(`${side}-vertical`, a, b)) return false
      const label = fullValue(-b + probe.leadingWidth, 0, l.value, 'N')
      out.push(`<g transform="translate(${f(verticalX)} 0) rotate(-90)">${label.svg}</g>`)
      return true
    }
    const done = new Set<EdgeLabel>()
    for (const [candidates, above] of [
      [kmN, true],
      [[...kmN].reverse(), false],
    ] as const) {
      for (const l of candidates) {
        if (done.has(l)) break
        if (placeN(l, above)) {
          done.add(l)
          break
        }
      }
    }
    const below = kmN[0] && Math.round(kmN[0].value) % 100_000 === 0 ? labels.filter((l) => l.edge === side && l.pos > kmN[0].pos).sort((a, b) => a.pos - b.pos) : []
    const fallback = done.size ? below : labels.filter((l) => l.edge === side).sort((a, b) => b.pos - a.pos)
    place: for (const l of fallback) {
      for (const above of done.size ? [false, true] : [true, false]) {
        if (placeN(l, above)) break place
      }
    }
  }

  out.push('</g>')
  return out.join('')
}

/** Approximate width of bold capitals and digits. */
const boldWidth = (s: string, size: number) => s.length * 0.68 * size

/** Text with a white backing box, for labels on the map face. */
function boxedText(x: number, y: number, s: string, size: number, anchor: 'start' | 'middle' | 'end', attrs = '') {
  const w = boldWidth(s, size)
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w
  return (
    `<rect x="${f(left - 0.5)}" y="${f(y - size * 0.8)}" width="${f(w + 1)}" height="${f(size * 1.05)}" fill="#ffffff" fill-opacity="0.85"/>` +
    text(x, y, esc(s), size, `text-anchor="${anchor}" ${attrs}`)
  )
}

/** Points spread along a polyline (by length), with the direction there. */
function pointsAlong(run: Pt[], fractions: number[]) {
  const seg = run.slice(1).map((p, i) => Math.hypot(p[0] - run[i][0], p[1] - run[i][1]))
  const total = seg.reduce((s, l) => s + l, 0)
  return fractions.map((t) => {
    let d = t * total
    let i = 0
    while (i < seg.length - 1 && d > seg[i]) d -= seg[i++]
    const [a, b] = [run[i], run[i + 1]]
    const len = seg[i] || 1
    const u = d / len
    return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] as Pt, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] as Pt, total }
  })
}

/**
 * 100 km square letters on the map face, on both sides of each 100 km line and of a zone junction
 * (with the grid zone there), repeated along long lines.
 */
function renderSquareLabels(zones: SheetZones) {
  const lines: { run: Pt[]; junction: boolean }[] = [
    ...zones.zones.flatMap((z) =>
      z.lines.filter((l) => Math.round(l.value) % 100_000 === 0).flatMap((l) => l.runs.map((run) => ({ run, junction: false }))),
    ),
    ...zones.junctions.map((run) => ({ run, junction: true })),
  ]
  const out: string[] = []
  const SIZE = 2.8
  for (const { run, junction } of lines) {
    const total = pointsAlong(run, [0])[0].total
    const count = Math.max(1, Math.round(total / 100))
    const fractions = Array.from({ length: count }, (_, i) => (i + 0.5) / count)
    for (const { p, dir } of pointsAlong(run, fractions)) {
      const normal: Pt = [-dir[1], dir[0]]
      const sideA: Pt = [p[0] + normal[0] * 4, p[1] + normal[1] * 4]
      const sideB: Pt = [p[0] - normal[0] * 4, p[1] - normal[1] * 4]
      if (!zones.inFrame(sideA) || !zones.inFrame(sideB)) continue
      const a = zones.squareAt(sideA)
      const b = zones.squareAt(sideB)
      if (!a || !b || a === b) continue
      const label = (id: string) => (junction ? id : id.split(' ')[1])
      const vertical = Math.abs(dir[1]) > Math.abs(dir[0])
      // Order the two sides: left then right, or above then below
      const [first, second] = (vertical ? sideA[0] < sideB[0] : sideA[1] < sideB[1]) ? [a, b] : [b, a]
      if (vertical) {
        out.push(boxedText(p[0] - 1.5, p[1] + 1, label(first), SIZE, 'end', 'font-weight="bold"'))
        out.push(boxedText(p[0] + 1.5, p[1] + 1, label(second), SIZE, 'start', 'font-weight="bold"'))
      } else {
        out.push(boxedText(p[0], p[1] - 1.5, label(first), SIZE, 'middle', 'font-weight="bold"'))
        out.push(boxedText(p[0], p[1] + 1.5 + SIZE * 0.72, label(second), SIZE, 'middle', 'font-weight="bold"'))
      }
    }
  }
  return out.join('')
}

/**
 * Principal digits repeated along the km lines on the map face, so the grid can be read away from the
 * margin (e.g. on a folded sheet): eastings in a few rows across the sheet, northings in a few columns.
 * Each sits midway between two lines of the other direction, never on a crossing, on a white patch
 * that breaks its line. Lines of each zone are labelled in that zone's grid and kept clear of junctions.
 * 100 km lines are left out: the square letters on both sides already mark them.
 */
function renderFaceDigits(sheet: Sheet, layout: SheetLayout, zones: SheetZones) {
  const { frame } = layout
  const spacing = GRID_SPACING[sheet.scale]
  const SIZE = 2.2
  const EVERY = 90 // mm between rows (and columns) of digits
  const EDGE = 6 // keep clear of the edge labels
  const spread = (start: number, length: number) => {
    const count = Math.max(1, Math.round(length / EVERY))
    return Array.from({ length: count }, (_, i) => start + (length * (i + 0.5)) / count)
  }
  const rows = spread(frame.y, frame.height)
  const cols = spread(frame.x, frame.width)
  const midway = (v: number) => (Math.floor(v / spacing) + 0.5) * spacing
  const out: string[] = []

  for (const z of zones.zones) {
    // Grid coordinates of the paper point nearest to `target` on a line
    const nearest = (run: Pt[], target: number, axis: 0 | 1) => run.reduce((best, p) => (Math.abs(p[axis] - target) < Math.abs(best[axis] - target) ? p : best))
    const own = (p: Pt) => z.conv.forward(zones.toLonLat(p)) as Pt
    const place = (e: number, n: number, value: number) => {
      const [x, y] = zones.toPaper(z.conv.inverse([e, n]) as Pt)
      const digits = splitDigits(value).principal
      const w = textWidth(digits, SIZE) + 0.8
      const h = SIZE * 0.95
      // Corners with room around them, so digits stay a few mm clear of a zone junction
      const PAD = 3
      const corners: Pt[] = [
        [x - w / 2 - PAD, y - h / 2 - PAD],
        [x + w / 2 + PAD, y - h / 2 - PAD],
        [x - w / 2 - PAD, y + h / 2 + PAD],
        [x + w / 2 + PAD, y + h / 2 + PAD],
      ]
      const clear = corners.every(
        ([cx, cy]) =>
          cx > frame.x + EDGE && cx < frame.x + frame.width - EDGE && cy > frame.y + EDGE && cy < frame.y + frame.height - EDGE && zones.zoneAt([cx, cy]) === z.zone,
      )
      if (!clear) return
      out.push(`<rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" fill="#ffffff"/>`)
      out.push(text(x, y + SIZE * 0.36, digits, SIZE, 'text-anchor="middle" font-weight="bold"'))
    }
    for (const l of z.lines) {
      if (Math.round(l.value) % 1000 !== 0 || Math.round(l.value) % 100_000 === 0) continue
      for (const run of l.runs) {
        if (l.axis === 'e') for (const y of rows) place(l.value, midway(own(nearest(run, y, 1))[1]), l.value)
        else for (const x of cols) place(midway(own(nearest(run, x, 0))[0]), l.value, l.value)
      }
    }
  }
  return out.join('')
}

/** Grid zone junctions: a heavy line, named along its length. */
function renderJunctions(zones: SheetZones) {
  const out: string[] = []
  for (const run of zones.junctions) {
    out.push(polyline(run, false, 0.4))
    const [{ p, dir, total }] = pointsAlong(run, [0.1])
    if (total < 40) continue
    let angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI
    // Keep the text upright: reading upwards or rightwards
    if (angle > 90) angle -= 180
    if (angle <= -90) angle += 180
    out.push(
      `<g transform="translate(${f(p[0])} ${f(p[1])}) rotate(${f(angle)})">` +
        boxedText(0, -0.9, 'GRID ZONE JUNCTION', 1.8, 'middle', 'font-style="italic"') +
        '</g>',
    )
  }
  return out.join('')
}

/** Marks the example point: a small ringed dot with its name. */
function renderExampleMarker(example: ResolvedExample, sheet: Sheet, layout: SheetLayout, grid: Grid) {
  const [e, n] = grid.conv.forward(example.point)
  const [x, y] = toPaper(layout, grid, sheet.scale, e, n)
  const size = 2
  // Approximate label width (Helvetica averages ~0.55 em) for a white backing box; svg2pdf has no paint-order halos.
  const width = example.name.length * size * 0.55 + 1
  return (
    `<circle cx="${f(x)}" cy="${f(y)}" r="1.1" fill="none" stroke="${INK}" stroke-width="0.3"/>` +
    `<circle cx="${f(x)}" cy="${f(y)}" r="0.25" fill="${INK}"/>` +
    `<rect x="${f(x + 1.5)}" y="${f(y - 1.7)}" width="${f(width)}" height="2.6" fill="#ffffff" fill-opacity="0.85"/>` +
    text(x + 2, y + 0.3, esc(example.name), size, 'font-style="italic"')
  )
}

function renderHeader(sheet: Sheet, layout: SheetLayout, zones: SheetZones, zoneNames: string[]) {
  const { frame } = layout
  const right = frame.x + frame.width
  const squares = zones.regions.map((r) => r.id).sort()
  const title = sheet.title.trim() || 'Untitled sheet'
  const utmZones = zoneNames.length > 1 ? `UTM ZONES ${zoneNames.join(' / ')}` : `UTM ZONE ${zoneNames[0]}`
  return (
    text(frame.x, 8.5, esc(title.toUpperCase()), 5.5, 'font-weight="bold"') +
    text(frame.x, 12.2, `SCALE ${formatScale(sheet.scale)}`, 2.6) +
    text(right, 8.5, squares.join(' · '), 3.4, 'text-anchor="end" font-weight="bold"') +
    text(right, 12.2, `WGS 84 · ${utmZones} · MGRS`, 2.4, 'text-anchor="end"')
  )
}

function blockTitle(box: Box, label: string) {
  return text(box.x, box.y + 2.6, label, 2.4, 'font-weight="bold" letter-spacing="0.15"')
}

function renderLegend(box: Box, p: Palette, layers: SheetLayers, dataDate?: string | null) {
  type Item = { label: string; draw: (x: number, y: number, w: number, h: number) => string }
  const area = (fill: string, stroke = 'none') => (x: number, y: number, w: number, h: number) =>
    `<rect x="${f(x)}" y="${f(y)}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke === 'none' ? '#999' : stroke}" stroke-width="0.1"/>`
  const stroke = (color: string, width: number, extra = '') => (x: number, y: number, w: number, h: number) =>
    `<line x1="${f(x)}" y1="${f(y + h / 2)}" x2="${f(x + w)}" y2="${f(y + h / 2)}" stroke="${color}" stroke-width="${width}" ${extra}/>`
  const road = (fill: string, casing: string, width: number) => (x: number, y: number, w: number, h: number) =>
    stroke(casing, width + 0.3, 'stroke-linecap="butt"')(x, y, w, h) + stroke(fill, width, 'stroke-linecap="butt"')(x, y, w, h)

  const items: Item[] = [
    { label: 'Forest', draw: area(p.forest) },
    { label: 'Open ground', draw: area(p.open) },
    { label: 'Farmland', draw: area(p.farmland) },
    {
      label: 'Marsh',
      draw: (x, y, w, h) =>
        area(p.wetland)(x, y, w, h) +
        [
          [0.6, 0.35],
          [3.4, 0.35],
          [2, 0.75],
        ]
          .map(([dx, t]) => `<line x1="${f(x + dx)}" y1="${f(y + h * t)}" x2="${f(x + dx + 1.8)}" y2="${f(y + h * t)}" stroke="${p.waterway}" stroke-width="0.2"/>`)
          .join(''),
    },
    { label: 'Water', draw: area(p.water, p.waterway) },
    { label: 'Built-up area', draw: area(p.builtUp) },
    { label: 'Building', draw: area(p.building, p.building) },
    { label: 'Watercourse', draw: stroke(p.waterway, 0.35) },
    { label: 'Main road', draw: road(p.roadMajor, p.roadMajorCasing, 0.8) },
    { label: 'Minor road', draw: road(p.roadMinor, p.roadMinorCasing, 0.5) },
    { label: 'Track', draw: stroke(p.track, 0.25, 'stroke-dasharray="1.2 0.6"') },
    { label: 'Path', draw: stroke(p.track, 0.2, 'stroke-dasharray="0.3 0.6"') },
    { label: 'Railway', draw: stroke(p.track, 0.4) },
    ...(layers.contours
      ? [
          { label: 'Contour', draw: stroke(p.contour, 0.15) },
          { label: 'Index contour', draw: stroke(p.contour, 0.35) },
        ]
      : []),
    ...(layers.grid ? [{ label: 'Grid line (MGRS)', draw: stroke(INK, 0.15) }] : []),
  ]

  const out = [blockTitle(box, 'LEGEND')]
  // The map information date: how current the mapped features are, as opposed to the print date
  const top = dataDate ? 6.4 : 4.5
  if (dataDate) out.push(text(box.x, box.y + 4.9, `Map information as of ${dataDate} (OpenStreetMap)`, 1.5, 'font-style="italic"'))
  const rows = Math.ceil(items.length / 2)
  const colWidth = box.width / 2
  const rowHeight = (box.height - top) / rows
  items.forEach((item, i) => {
    const col = Math.floor(i / rows)
    const row = i % rows
    const x = box.x + col * colWidth
    const y = box.y + top + row * rowHeight
    const swatchH = Math.min(2.4, rowHeight - 0.8)
    out.push(item.draw(x, y, 6, swatchH))
    out.push(text(x + 7.5, y + swatchH - 0.4, item.label, 2))
  })
  return out.join('')
}

/** Metres per yard and per statute mile. */
const YARD = 0.9144
const MILE = 1609.344

/**
 * Scale bars as chosen for the sheet: metric, imperial, or both with the imperial bar below and the zero
 * points aligned. Imperial is in yards where the metric bar is in metres, in statute miles where it is in
 * kilometres. Each has one subdivided unit left of zero and whole units to the right, and stays within
 * the metric bar's 60 mm. A single bar gets the roomier spacing.
 */
function renderScaleBlock(box: Box, sheet: Sheet, zoneNames: string[], contours: boolean) {
  const out = [text(box.x + box.width / 2, box.y + 3.2, `SCALE ${formatScale(sheet.scale)}`, 3.4, 'text-anchor="middle" font-weight="bold"')]
  const mmPerMetre = 1000 / sheet.scale
  const both = sheet.scaleBars === 'both'
  const barH = both ? 1.2 : 1.4
  const zeroX = box.x + box.width / 2 - 10 // metric bar: 20 mm left of zero, 40 mm right
  const cx = box.x + box.width / 2

  /** One bar: `unit` in metres, labelled with `fmt`; the left unit is split in five. */
  const bar = (y: number, unit: number, right: number, fmt: (units: number) => string, name: string) => {
    const unitMm = unit * mmPerMetre
    const left = zeroX - unitMm
    for (let i = 0; i < 5; i++) {
      out.push(`<rect x="${f(left + (i * unitMm) / 5)}" y="${f(y)}" width="${f(unitMm / 5)}" height="${barH}" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width="0.1"/>`)
    }
    for (let i = 0; i < right; i++) {
      out.push(`<rect x="${f(zeroX + unitMm * i)}" y="${f(y)}" width="${f(unitMm)}" height="${barH}" fill="${i % 2 ? INK : '#fff'}" stroke="${INK}" stroke-width="0.1"/>`)
    }
    const labelY = y + barH + (both ? 2.2 : 2.4)
    const size = both ? 1.8 : 2
    out.push(text(left, labelY, fmt(1), size, 'text-anchor="middle"'))
    for (let i = 0; i <= right; i++) out.push(text(zeroX + unitMm * i, labelY, fmt(i), size, 'text-anchor="middle"'))
    out.push(text(cx, labelY + (both ? 2.3 : 2.8), name, both ? 1.6 : 1.9, 'text-anchor="middle" letter-spacing="0.2"'))
  }

  const unit = sheet.scale / 50 // metres per 20 mm
  const km = unit >= 1000
  const imperial =
    sheet.scale <= 10_000
      ? { unit: 100 * YARD, right: 4, fmt: (i: number) => String(i * 100), name: 'YARDS' }
      : km
        ? { unit: 0.5 * MILE, right: 2, fmt: (i: number) => String(i * 0.5), name: 'STATUTE MILES' }
        : { unit: 500 * YARD, right: 2, fmt: (i: number) => String(i * 500), name: 'YARDS' }
  if (sheet.scaleBars !== 'imperial') bar(both ? box.y + 5.6 : box.y + 7.5, unit, 2, (i) => String((i * unit) / (km ? 1000 : 1)), km ? 'KILOMETRES' : 'METRES')
  if (sheet.scaleBars !== 'metric') bar(both ? box.y + 12.6 : box.y + 7.5, imperial.unit, imperial.right, imperial.fmt, imperial.name)

  // The contour lines (first one bold) are left out when contours are switched off.
  const contourNotes = contours ? [`CONTOUR INTERVAL ${CONTOUR_INTERVAL[sheet.scale]} METRES`, 'Elevations in metres above mean sea level'] : []
  const notes = [
    ...contourNotes,
    'Horizontal datum: World Geodetic System 1984 (WGS 84)',
    `Projection: Universal Transverse Mercator, zone${zoneNames.length > 1 ? 's' : ''} ${zoneNames.join(' and ')}`,
    `Grid: ${GRID_SPACING[sheet.scale] >= 1000 ? '1 kilometre' : '100 metre'} UTM grid, MGRS references`,
  ]
  notes.forEach((n, i) => {
    const bold = contours && i === 0
    const y = both ? box.y + 22.6 + i * 2.5 : box.y + 18.9 + i * 2.9
    const size = both ? (bold ? 2.1 : 1.8) : bold ? 2.2 : 1.9
    out.push(text(cx, y, n, size, `text-anchor="middle"${bold ? ' font-weight="bold"' : ''}`))
  })
  return out.join('')
}

/** Grid–magnetic angle of one zone's grid at the sheet centre, degrees, east positive. */
interface ZoneAngle {
  zone: number
  angle: number
}

function renderNorth(box: Box, info: NorthInfo, gridMagnetic: ZoneAngle[]) {
  const out = [blockTitle(box, 'NORTH POINTS')]
  const cx = box.x + 10
  const baseY = box.y + 20
  const len = 13
  // Small angles are drawn exaggerated so the three norths can be told apart.
  const MIN = 12
  const show = (a: number) => (Math.abs(a) < 0.05 ? 0 : Math.sign(a) * Math.max(Math.abs(a), MIN))
  const tnTrue = -info.convergence // true north relative to grid north
  const mnTrue = info.gridMagnetic // magnetic north relative to grid north
  let tnAngle = show(tnTrue)
  let mnAngle = show(mnTrue)
  // Keep TN and MN apart too, preserving their order; the one further from GN moves outwards.
  if (Math.abs(mnAngle - tnAngle) < MIN) {
    if (Math.abs(mnTrue) >= Math.abs(tnTrue)) mnAngle = tnAngle + (Math.sign(mnTrue - tnTrue) || 1) * MIN
    else tnAngle = mnAngle + (Math.sign(tnTrue - mnTrue) || 1) * MIN
  }
  const tip = (deg: number, l = len): [number, number] => [cx + Math.sin((deg * Math.PI) / 180) * l, baseY - Math.cos((deg * Math.PI) / 180) * l]

  // Dashed arcs between the prongs: grid–magnetic angle (GN–MN) outside, convergence (TN–GN) inside
  const arc = (from: number, to: number, r: number) => {
    if (Math.abs(to - from) < 0.05) return ''
    const [x0, y0] = tip(from, r)
    const [x1, y1] = tip(to, r)
    // Angles run clockwise from grid north, which is the positive sweep direction with y down
    return `<path d="M${f(x0)} ${f(y0)} A${r} ${r} 0 0 ${to > from ? 1 : 0} ${f(x1)} ${f(y1)}" fill="none" stroke="${INK}" stroke-width="0.15" stroke-dasharray="0.8 0.5"/>`
  }
  out.push(arc(0, mnAngle, 11), arc(tnAngle, 0, 8))

  // Grid north: vertical line labelled GN
  out.push(line(cx, baseY, cx, baseY - len, 0.25))
  out.push(text(cx, baseY - len - 0.8, 'GN', 2, 'text-anchor="middle" font-weight="bold"'))
  // True north: line with a star
  const [tx, ty] = tip(tnAngle)
  out.push(line(cx, baseY, tx, ty, 0.25))
  out.push(star(tx, ty - 0.8, 1.1))
  // Magnetic north: line with a half arrowhead
  const [mx, my] = tip(mnAngle)
  out.push(line(cx, baseY, mx, my, 0.25))
  const [hx, hy] = tip(mnAngle, len - 2.5)
  const side = mnAngle >= 0 ? 1 : -1
  const perp = ((mnAngle + 90 * side) * Math.PI) / 180
  out.push(`<path d="M${f(mx)} ${f(my)} L${f(hx)} ${f(hy)} L${f(hx + Math.sin(perp) * 1)} ${f(hy - Math.cos(perp) * 1)} Z" fill="${INK}"/>`)
  // MN label beside the arrow tip, on the outside
  out.push(text(mx + side * 1.2, my + 1.6, 'MN', 2, `text-anchor="${side > 0 ? 'start' : 'end'}" font-weight="bold"`))
  // TN label beside the star, on the other side
  const tnSide = tnAngle > 0 ? 1 : -1
  out.push(text(tx + tnSide * 1.6, ty + 0.2, 'TN', 1.6, `text-anchor="${tnSide > 0 ? 'start' : 'end'}"`))

  // Key under the diagram
  const key = ['GN grid north', 'TN true north', 'MN magnetic north']
  key.forEach((k, i) => out.push(text(box.x, baseY + 2.8 + i * 2, k, 1.4, 'font-style="italic"')))
  // The prongs are not to scale (small angles are exaggerated): the values beside the diagram count
  const caution = ['Use diagram only to obtain', 'numerical values']
  caution.forEach((c, i) => out.push(text(box.x, baseY + 3.2 + (key.length + i) * 2, c, 1.4, 'font-weight="bold" font-style="italic"')))

  // Values, then how to convert azimuths with the grid–magnetic angle: with magnetic north east of grid
  // north, a magnetic azimuth is smaller than the grid azimuth, so grid to magnetic subtracts.
  const x = box.x + 21
  const values = [
    `Convergence: ${formatAngle(info.convergence)}`,
    `Declination: ${formatAngle(info.declination)}`,
    `G–M angle: ${formatAngle(info.gridMagnetic)}`,
    `Annual change ${Math.abs(info.annualChange).toFixed(2)}° ${info.annualChange >= 0 ? 'E' : 'W'} · ${info.year}`,
  ]
  values.forEach((v, i) => out.push(text(x, box.y + 5.5 + i * 2.2, esc(v), 1.6)))
  const amount = (a: number) => `${Math.abs(a).toFixed(1)}° (${Math.abs(toMils(a))} mils)`
  const perZone = gridMagnetic.length > 1
  const conversion = (title: string, eastOp: string, westOp: string) => [
    title,
    ...gridMagnetic.map((z) => `${perZone ? `zone ${z.zone}: ` : ''}${z.angle >= 0 ? eastOp : westOp} ${amount(z.angle)}`),
  ]
  const notes = [...conversion('Grid to magnetic azimuth:', 'subtract', 'add'), ...conversion('Magnetic to grid azimuth:', 'add', 'subtract')]
  notes.forEach((n, i) => {
    const heading = n.endsWith(':')
    out.push(text(heading ? x : x + 1.5, box.y + 15.2 + i * 2.2, esc(n), 1.6, heading ? 'font-weight="bold"' : ''))
  })
  return out.join('')
}

function star(cx: number, cy: number, r: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2
    const rr = i % 2 ? r * 0.45 : r
    pts.push(`${f(cx + Math.cos(a) * rr)},${f(cy + Math.sin(a) * rr)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${INK}"/>`
}

/**
 * The grid zone designation and 100 km square identification: a small diagram of the sheet divided
 * into its 100 km squares (and grid zones), and the grid–magnetic angle of each zone's grid.
 */
function renderSquaresBlock(box: Box, layout: SheetLayout, zones: SheetZones, gridMagnetic: ZoneAngle[]) {
  const { frame } = layout
  const out = [blockTitle(box, '100 KM SQUARES')]
  const gzds = [...new Set(zones.regions.map((r) => r.gzd))].sort()
  const twoLine = gzds.length > 1
  // Label size in the diagram: the grid zone above the square letters when the sheet has several
  const LW = 3.2
  const LH = twoLine ? 3.4 : 1.8
  const oy = box.y + 4.5

  // Squares too small for their label get it beside the diagram, with a leader line. Room for those
  // labels is reserved on that side, which can shrink the diagram, so the fit is checked again.
  type Side = 'left' | 'right'
  let reserve: Record<Side, number> = { left: 0, right: 0 }
  let s = 0
  let ox = 0
  let outside: { r: SquareRegion; side: Side }[] = []
  for (let pass = 0; pass < 3; pass++) {
    s = Math.min((box.width - 2 - reserve.left - reserve.right) / frame.width, 17 / frame.height)
    const w = frame.width * s
    ox = Math.min(Math.max(box.x + (box.width - w) / 2, box.x + 1 + reserve.left), box.x + box.width - 1 - reserve.right - w)
    const fits = (r: SquareRegion) => {
      const cx = ox + (r.x - frame.x) * s
      const cy = oy + (r.y - frame.y) * s
      const probes: Pt[] = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [cx + (i * (LW + 0.6)) / 2, cy + (j * (LH + 0.4)) / 2] as Pt))
      return probes.every(([x, y]) => {
        const p: Pt = [frame.x + (x - ox) / s, frame.y + (y - oy) / s]
        return zones.inFrame(p) && zones.squareAt(p) === r.id
      })
    }
    outside = zones.regions
      .filter((r) => !fits(r))
      .map((r) => {
        const right = frame.x + frame.width
        const side: Side =
          r.bounds[2] >= right - 0.01 && r.bounds[0] > frame.x + 0.01 ? 'right' : r.bounds[0] <= frame.x + 0.01 && r.bounds[2] < right - 0.01 ? 'left' : r.x > frame.x + frame.width / 2 ? 'right' : 'left'
        return { r, side }
      })
    const next: Record<Side, number> = {
      left: outside.some((o) => o.side === 'left') ? LW + 1.6 : 0,
      right: outside.some((o) => o.side === 'right') ? LW + 1.6 : 0,
    }
    if (next.left === reserve.left && next.right === reserve.right) break
    reserve = next
  }
  const w = frame.width * s
  const h = frame.height * s
  const tr = (run: Pt[]) => run.map(([x, y]) => [ox + (x - frame.x) * s, oy + (y - frame.y) * s] as Pt)

  out.push(`<rect x="${f(ox)}" y="${f(oy)}" width="${f(w)}" height="${f(h)}" fill="#ffffff" stroke="${INK}" stroke-width="0.2"/>`)
  for (const z of zones.zones) {
    for (const l of z.lines) {
      if (Math.round(l.value) % 100_000 !== 0) continue
      for (const run of l.runs) out.push(polyline(tr(run), l.straight, 0.15))
    }
  }
  for (const run of zones.bandEdges) out.push(polyline(tr(run), false, 0.15, 'stroke-dasharray="0.6 0.4"'))
  for (const run of zones.junctions) out.push(polyline(tr(run), false, 0.35))

  // A label centred on (x, y)
  const label = (r: SquareRegion, x: number, y: number) =>
    twoLine
      ? text(x, y - 0.4, r.gzd, 1.3, 'text-anchor="middle"') + text(x, y + 1.6, r.square, 2, 'text-anchor="middle" font-weight="bold"')
      : text(x, y + 0.7, r.square, 2, 'text-anchor="middle" font-weight="bold"')

  for (const r of zones.regions) {
    if (outside.some((o) => o.r === r)) continue
    const [[x, y]] = tr([[r.x, r.y]])
    out.push(label(r, x, y))
  }

  // Outside labels: level with their square where possible, stacked without overlapping
  for (const side of ['left', 'right'] as const) {
    const list = outside
      .filter((o) => o.side === side)
      .map((o) => ({ r: o.r, anchor: tr([[o.r.x, o.r.y]])[0], y: 0 }))
      .sort((a, b) => a.anchor[1] - b.anchor[1])
    const top = oy + LH / 2
    const bottom = oy + h - LH / 2
    list.forEach((o, i) => (o.y = Math.max(Math.min(Math.max(o.anchor[1], top), bottom), i ? list[i - 1].y + LH + 0.6 : -Infinity)))
    for (let i = list.length - 1; i >= 0; i--) {
      list[i].y = Math.min(list[i].y, i < list.length - 1 ? list[i + 1].y - LH - 0.6 : Math.max(bottom, list[i].y))
    }
    for (const o of list) {
      const x = side === 'right' ? ox + w + 1.2 + LW / 2 : ox - 1.2 - LW / 2
      const edge = side === 'right' ? x - LW / 2 - 0.2 : x + LW / 2 + 0.2
      out.push(line(edge, o.y, o.anchor[0], o.anchor[1], 0.1))
      out.push(`<circle cx="${f(o.anchor[0])}" cy="${f(o.anchor[1])}" r="0.25" fill="${INK}"/>`)
      out.push(label(o.r, x, o.y))
    }
  }

  const notes = [`Grid zone designation: ${gzds.join(', ')}`]
  if (gridMagnetic.length > 1) for (const z of gridMagnetic) notes.push(`G–M zone ${z.zone}: ${formatAngle(z.angle)}`)
  notes.forEach((n, i) => out.push(text(box.x, oy + h + 2.8 + i * 2.3, esc(n), 1.6)))
  return out.join('')
}

function renderGridRef(box: Box, sheet: Sheet, grid: Grid, example: ResolvedExample | null) {
  const spacing = GRID_SPACING[sheet.scale]
  const figures = spacing === 100 ? 4 : 3 // digits per axis: 6-figure reference on 1 km grids, 8-figure on 100 m grids
  const out = [blockTitle(box, 'HOW TO GIVE A GRID REFERENCE')]
  const footer = text(box.x, box.y + box.height - 0.6, 'Read RIGHT, then UP. Ignore the small figures.', 1.6, 'font-style="italic"')

  if (!example) {
    const steps = [
      '1. EASTING: find the vertical grid line',
      '   WEST of the point and read its large',
      `   figures; estimate tenths eastward (${figures} figures).`,
      '2. NORTHING: find the horizontal grid line',
      '   SOUTH of the point and read its large',
      `   figures; estimate tenths northward (${figures} figures).`,
      '3. Write easting then northing, preceded',
      '   by the 100 km square letters and, for a',
      '   full MGRS reference, the grid zone.',
    ]
    steps.forEach((l, i) => out.push(text(box.x, box.y + 6 + i * 2.75, esc(l).replace(/ /g, '&#160;'), 1.9)))
    out.push(footer)
    return out.join('')
  }

  // Read in the grid of the zone the point lies in, which is the grid printed around it
  const conv = utm(zoneFor(example.point[0], example.point[1]).zone, grid.south)
  const [e, n] = conv.forward(example.point)
  const lineDigits = figures - 1
  const axis = (v: number) => {
    const lineValue = Math.floor(v / spacing)
    const lineLabel = String(lineValue % 10 ** lineDigits).padStart(lineDigits, '0')
    const tenth = Math.floor((v - lineValue * spacing) / (spacing / 10))
    return { lineLabel, tenth, ref: `${lineLabel}${tenth}` }
  }
  const E = axis(e)
  const N = axis(n)
  let gzdSquare = ''
  try {
    gzdSquare = formatMgrs(toMgrs(example.point, 0))
  } catch {
    gzdSquare = '—'
  }
  const square = gzdSquare.split(' ')[1] ?? ''

  const rows: [string, string][] = [
    ['Sample point', example.name],
    ['1. Read EASTING first:', ''],
    ['   line WEST of the point', E.lineLabel],
    ['   tenths eastward', String(E.tenth)],
    ['2. Then NORTHING:', ''],
    ['   line SOUTH of the point', N.lineLabel],
    ['   tenths northward', String(N.tenth)],
    ['Grid reference', `${square} ${E.ref} ${N.ref}`.trim()],
    ['Full MGRS reference', `${gzdSquare} ${E.ref} ${N.ref}`],
  ]
  // The sample grid square, between the steps and their values: its lines labelled as on the map,
  // tenths ticked along the bottom and left, and the point with dashed lines to the ticks it reads.
  // The point is drawn in the middle of its tenth, so the dashed lines land between the two ticks.
  const S = 12
  const sx = box.x + 29
  const sy = box.y + 8.5
  const next = (label: string) => String((Number(label) + 1) % 10 ** lineDigits).padStart(lineDigits, '0')
  const px = sx + ((E.tenth + 0.5) / 10) * S
  const py = sy + S - ((N.tenth + 0.5) / 10) * S
  out.push(`<rect x="${f(sx)}" y="${f(sy)}" width="${S}" height="${S}" fill="none" stroke="${INK}" stroke-width="0.25"/>`)
  for (let i = 1; i < 10; i++) {
    const t = (i * S) / 10
    const len = i === 5 ? 1 : 0.6
    out.push(line(sx + t, sy + S, sx + t, sy + S - len, 0.12), line(sx, sy + S - t, sx + len, sy + S - t, 0.12))
  }
  const dash = 'stroke-dasharray="0.5 0.35"'
  out.push(line(px, py, px, sy + S, 0.12, dash), line(px, py, sx, py, 0.12, dash))
  out.push(`<circle cx="${f(px)}" cy="${f(py)}" r="0.55" fill="none" stroke="${INK}" stroke-width="0.2"/><circle cx="${f(px)}" cy="${f(py)}" r="0.15" fill="${INK}"/>`)
  out.push(text(sx, sy + S + 2.6, E.lineLabel, 1.7, 'text-anchor="middle" font-weight="bold"'))
  out.push(text(sx + S, sy + S + 2.6, next(E.lineLabel), 1.7, 'text-anchor="middle" font-weight="bold"'))
  out.push(text(sx - 1.2, sy + S + 0.3, N.lineLabel, 1.7, 'text-anchor="end" font-weight="bold"'))
  out.push(text(sx - 1.2, sy + 0.6, next(N.lineLabel), 1.7, 'text-anchor="end" font-weight="bold"'))

  const valueX = box.x + box.width
  rows.forEach(([label, value], i) => {
    const y = box.y + 6 + i * 2.75
    const strong = i === 0 || i >= 7
    out.push(text(box.x, y, esc(label).replace(/ /g, '&#160;'), 1.9, strong ? 'font-weight="bold"' : ''))
    if (value) out.push(text(valueX, y, esc(value), i >= 7 ? 2.2 : 1.9, `text-anchor="end" font-weight="bold"${i === 0 ? ' font-style="italic"' : ''}`))
  })
  out.push(footer)
  return out.join('')
}

function renderFooter(layout: SheetLayout, date: Date) {
  const y = layout.paper.height - 3.5
  const left = layout.frame.x
  const right = layout.frame.x + layout.frame.width
  const attribution =
    'Map data © OpenStreetMap contributors (ODbL) · Vector tiles: OpenFreeMap / OpenMapTiles · Elevation: AWS Terrain Tiles (Mapzen) · Magnetic model: NOAA WMM2025'
  return (
    text(left, y, esc(attribution), 1.6) +
    text(right, y, `Created ${date.toISOString().slice(0, 10)} · MGRS Map Generator`, 1.6, 'text-anchor="end"')
  )
}
