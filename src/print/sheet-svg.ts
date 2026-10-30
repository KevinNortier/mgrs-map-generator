import { forward as toMgrs } from 'mgrs'
import type { Palette } from '../map/style'
import { formatMgrs } from '../mgrs/grid'
import { formatAngle, northInfo, type NorthInfo } from './north'
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

export function renderSheetSvg({ sheet, palette, mapImage, overlay = false, date = new Date() }: SheetSvgOptions): string {
  const layout = sheetLayout(sheet)
  const { paper, frame } = layout
  const grid = sheetGrid(sheet)
  const north = northInfo(sheet, date)
  const example = resolveExample(sheet, sheet.example)
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

  parts.push(renderGrid(sheet, layout, grid))
  if (example) parts.push(renderExampleMarker(example, sheet, layout, grid))
  parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="none" stroke="${INK}" stroke-width="0.35"/>`)

  parts.push(renderHeader(sheet, layout, grid))
  for (const box of layout.blocks) {
    if (box.id === 'legend') parts.push(renderLegend(box, palette))
    if (box.id === 'scale') parts.push(renderScaleBlock(box, sheet, grid.zone, grid.south))
    if (box.id === 'north') parts.push(renderNorth(box, north))
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

function renderGrid(sheet: Sheet, layout: SheetLayout, grid: Grid) {
  const { frame } = layout
  const spacing = GRID_SPACING[sheet.scale]
  const out: string[] = ['<g>']
  const bottom = frame.y + frame.height

  const eastings: number[] = []
  for (let e = Math.ceil(grid.minE / spacing) * spacing; e <= grid.maxE; e += spacing) eastings.push(e)
  const northings: number[] = []
  for (let n = Math.ceil(grid.minN / spacing) * spacing; n <= grid.maxN; n += spacing) northings.push(n)

  const isKm = (v: number) => Math.round(v) % 1000 === 0
  // Full values go on the km lines nearest the corners: the first and last along each edge.
  const kmEastings = eastings.filter(isKm)
  const kmNorthings = northings.filter(isKm)
  const fullEastings = new Set([kmEastings[0], kmEastings[kmEastings.length - 1]])
  const fullNorthings = { south: kmNorthings[0], north: kmNorthings[kmNorthings.length - 1] }

  for (const e of eastings) {
    const [x] = toPaper(layout, grid, sheet.scale, e, grid.minN)
    out.push(line(x, frame.y, x, bottom, isKm(e) ? 0.15 : 0.08))
    const d = splitDigits(e)
    if (!isKm(e)) {
      out.push(text(x, frame.y - 1.2, d.hundreds, LABEL_SMALL, 'text-anchor="middle"'))
      out.push(text(x, bottom + 2.6, d.hundreds, LABEL_SMALL, 'text-anchor="middle"'))
    } else if (fullEastings.has(e)) {
      // Large digits centred on the line, as for the other km lines
      const start = x - textWidth(d.principal, LABEL_BIG) / 2
      out.push(fullValue(start, frame.y - 1.2, e, 'E').svg)
      out.push(fullValue(start, bottom + 3.2, e, 'E').svg)
    } else {
      out.push(text(x, frame.y - 1.2, d.principal, LABEL_BIG, 'text-anchor="middle" font-weight="bold"'))
      out.push(text(x, bottom + 3.2, d.principal, LABEL_BIG, 'text-anchor="middle" font-weight="bold"'))
    }
  }

  // Full northings are written vertically in the narrow side margin, reading upwards, clear of the
  // small 100 m digits next to the frame: above the line near the bottom corner, below it near the top.
  const verticalX = frame.x - 3.4
  for (const n of northings) {
    const [, y] = toPaper(layout, grid, sheet.scale, grid.minE, n)
    out.push(line(frame.x, y, frame.x + frame.width, y, isKm(n) ? 0.15 : 0.08))
    const d = splitDigits(n)
    if (!isKm(n)) {
      out.push(text(frame.x - 1, y + 0.6, d.hundreds, LABEL_SMALL, 'text-anchor="end"'))
      out.push(text(frame.x + frame.width + 1, y + 0.6, d.hundreds, LABEL_SMALL))
      continue
    }
    out.push(text(frame.x - 1, y + 0.9, d.principal, LABEL_BIG, 'text-anchor="end" font-weight="bold"'))
    out.push(text(frame.x + frame.width + 1, y + 0.9, d.principal, LABEL_BIG, 'font-weight="bold"'))
    const atSouth = n === fullNorthings.south
    const atNorth = n === fullNorthings.north && !atSouth
    if (atSouth || atNorth) {
      // In rotated coordinates, +x runs up the page. Start 2 mm above the line, or end 2 mm below it.
      const probe = fullValue(0, 0, n, 'N')
      const along = atSouth ? -(y - 2) : -(y + 2) - probe.width
      const label = fullValue(along + probe.leadingWidth, 0, n, 'N')
      out.push(`<g transform="translate(${f(verticalX)} 0) rotate(-90)">${label.svg}</g>`)
    }
  }

  out.push('</g>')
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

function renderHeader(sheet: Sheet, layout: SheetLayout, grid: Grid) {
  const { frame } = layout
  const right = frame.x + frame.width
  const squares = new Set<string>()
  for (const [e, n] of [
    [grid.minE, grid.minN],
    [grid.maxE, grid.minN],
    [grid.minE, grid.maxN],
    [grid.maxE, grid.maxN],
  ]) {
    try {
      squares.add(formatMgrs(toMgrs(grid.conv.inverse([e, n]) as [number, number], 0)))
    } catch {
      // outside MGRS coverage
    }
  }
  const title = sheet.title.trim() || 'Untitled sheet'
  return (
    text(frame.x, 8.5, esc(title.toUpperCase()), 5.5, 'font-weight="bold"') +
    text(frame.x, 12.2, `SCALE ${formatScale(sheet.scale)}`, 2.6) +
    text(right, 8.5, [...squares].join(' · '), 3.4, 'text-anchor="end" font-weight="bold"') +
    text(right, 12.2, `WGS 84 · UTM ZONE ${grid.zone}${grid.south ? 'S' : 'N'} · MGRS`, 2.4, 'text-anchor="end"')
  )
}

function blockTitle(box: Box, label: string) {
  return text(box.x, box.y + 2.6, label, 2.4, 'font-weight="bold" letter-spacing="0.15"')
}

function renderLegend(box: Box, p: Palette) {
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
    { label: 'Contour', draw: stroke(p.contour, 0.15) },
    { label: 'Index contour', draw: stroke(p.contour, 0.35) },
    { label: 'Grid line (MGRS)', draw: stroke(INK, 0.15) },
  ]

  const out = [blockTitle(box, 'LEGEND')]
  const rows = Math.ceil(items.length / 2)
  const colWidth = box.width / 2
  const rowHeight = (box.height - 4.5) / rows
  items.forEach((item, i) => {
    const col = Math.floor(i / rows)
    const row = i % rows
    const x = box.x + col * colWidth
    const y = box.y + 4.5 + row * rowHeight
    const swatchH = Math.min(2.4, rowHeight - 0.8)
    out.push(item.draw(x, y, 6, swatchH))
    out.push(text(x + 7.5, y + swatchH - 0.4, item.label, 2))
  })
  return out.join('')
}

function renderScaleBlock(box: Box, sheet: Sheet, zone: number, south: boolean) {
  const out = [text(box.x + box.width / 2, box.y + 3.2, `SCALE ${formatScale(sheet.scale)}`, 3.4, 'text-anchor="middle" font-weight="bold"')]

  // Scale bar: one subdivided unit to the left of zero, two whole units to the right. 1 unit = 20 mm.
  const unit = sheet.scale / 50 // metres per 20 mm
  const unitMm = 20
  const barH = 1.4
  const x0 = box.x + (box.width - 3 * unitMm) / 2
  const y0 = box.y + 7.5
  const km = unit >= 1000
  const fmt = (m: number) => (km ? String(m / 1000) : String(m))
  for (let i = 0; i < 5; i++) {
    out.push(`<rect x="${f(x0 + (i * unitMm) / 5)}" y="${f(y0)}" width="${unitMm / 5}" height="${barH}" fill="${i % 2 ? '#fff' : INK}" stroke="${INK}" stroke-width="0.1"/>`)
  }
  for (let i = 0; i < 2; i++) {
    out.push(`<rect x="${f(x0 + unitMm * (i + 1))}" y="${f(y0)}" width="${unitMm}" height="${barH}" fill="${i % 2 ? INK : '#fff'}" stroke="${INK}" stroke-width="0.1"/>`)
  }
  const labels: [number, string][] = [
    [x0, fmt(unit)],
    [x0 + unitMm, '0'],
    [x0 + 2 * unitMm, fmt(unit)],
    [x0 + 3 * unitMm, fmt(2 * unit)],
  ]
  for (const [x, l] of labels) out.push(text(x, y0 + barH + 2.4, l, 2, 'text-anchor="middle"'))
  out.push(text(box.x + box.width / 2, y0 + barH + 5.2, km ? 'KILOMETRES' : 'METRES', 1.9, 'text-anchor="middle" letter-spacing="0.2"'))

  const notes = [
    `CONTOUR INTERVAL ${CONTOUR_INTERVAL[sheet.scale]} METRES`,
    'Elevations in metres above mean sea level',
    'Horizontal datum: World Geodetic System 1984 (WGS 84)',
    `Projection: Universal Transverse Mercator, zone ${zone}${south ? 'S' : 'N'}`,
    `Grid: ${GRID_SPACING[sheet.scale] >= 1000 ? '1 kilometre' : '100 metre'} UTM grid, MGRS references`,
  ]
  notes.forEach((n, i) => out.push(text(box.x + box.width / 2, y0 + barH + 10 + i * 2.9, n, i === 0 ? 2.2 : 1.9, `text-anchor="middle"${i === 0 ? ' font-weight="bold"' : ''}`)))
  return out.join('')
}

function renderNorth(box: Box, info: NorthInfo) {
  const out = [blockTitle(box, 'NORTH POINTS')]
  const cx = box.x + box.width / 2
  const baseY = box.y + 22
  const len = 15
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
  const exaggerated = Math.abs(tnAngle - tnTrue) > 0.05 || Math.abs(mnAngle - mnTrue) > 0.05
  const tip = (deg: number, l = len): [number, number] => [cx + Math.sin((deg * Math.PI) / 180) * l, baseY - Math.cos((deg * Math.PI) / 180) * l]

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

  const lines = [
    `Convergence: ${formatAngle(info.convergence)}`,
    `Declination: ${formatAngle(info.declination)}`,
    `G–M angle: ${formatAngle(info.gridMagnetic)}`,
    `Annual change ${Math.abs(info.annualChange).toFixed(2)}° ${info.annualChange >= 0 ? 'E' : 'W'} · ${info.year}`,
  ]
  lines.forEach((l, i) => out.push(text(box.x, baseY + 3 + i * 2.3, l, 1.6)))
  if (exaggerated) out.push(text(box.x, box.y + 5, 'Angles not to scale', 1.4, 'font-style="italic"'))
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

  const [e, n] = grid.conv.forward(example.point)
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
