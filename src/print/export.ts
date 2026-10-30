import type { Palette } from '../map/style'
import { mgrsAt } from '../mgrs/grid'
import { renderMapImage } from './render-map'
import { renderSheetSvg } from './sheet-svg'
import { sheetLayout, type Sheet } from './sheet'

export const EXPORT_DPI = 300

export type ExportProgress = (message: string) => void

function mapProgress(onProgress?: ExportProgress) {
  return (done: number, total: number) =>
    onProgress?.(total > 1 ? `Rendering map at ${EXPORT_DPI} DPI (part ${done} of ${total})…` : `Rendering map at ${EXPORT_DPI} DPI…`)
}

/** "sodertalje-exercise-north_33V-XF-513-653_25k" */
export function exportFileName(sheet: Sheet, ext: 'pdf' | 'png' | 'json') {
  const slug =
    sheet.title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'mgrs-sheet'
  const ref = (mgrsAt(sheet.center, 6) ?? '').replace(/\s+/g, '-')
  return `${slug}_${ref}_${sheet.scale / 1000}k.${ext}`
}

/**
 * PDF at exact scale: the page is the paper size in mm, the map image is placed at its exact
 * frame size, and the grid, text and margin graphics are drawn on top as vectors.
 */
export async function exportPdf(sheet: Sheet, palette: Palette, onProgress?: ExportProgress): Promise<Blob> {
  const [{ jsPDF }, mapImage] = await Promise.all([
    import('jspdf'),
    renderMapImage(sheet, palette, { dpi: EXPORT_DPI, format: 'image/jpeg', onProgress: mapProgress(onProgress) }),
  ])
  await import('svg2pdf.js')
  onProgress?.('Building PDF…')

  const { paper, frame } = sheetLayout(sheet)
  const doc = new jsPDF({
    unit: 'mm',
    format: [paper.width, paper.height],
    orientation: paper.width > paper.height ? 'landscape' : 'portrait',
    compress: true,
  })
  doc.setProperties({
    title: sheet.title || 'MGRS sheet',
    subject: `Scale 1:${sheet.scale}, centre ${mgrsAt(sheet.center, 6) ?? ''}`,
    creator: 'MGRS Map Generator',
  })
  doc.addImage(mapImage, 'JPEG', frame.x, frame.y, frame.width, frame.height, undefined, 'NONE')

  // svg2pdf needs a parsed SVG element; it does not have to be attached to the page.
  const svg = new DOMParser().parseFromString(renderSheetSvg({ sheet, palette, overlay: true }), 'image/svg+xml').documentElement
  await doc.svg(svg, { x: 0, y: 0, width: paper.width, height: paper.height })
  return doc.output('blob')
}

/** The whole sheet as a PNG at EXPORT_DPI, tagged with its resolution so it prints at the right size. */
export async function exportPng(sheet: Sheet, palette: Palette, onProgress?: ExportProgress): Promise<Blob> {
  // JPEG keeps the embedded map small; a lossless A3 map at 300 DPI is tens of MB as a data URL.
  const mapImage = await renderMapImage(sheet, palette, { dpi: EXPORT_DPI, format: 'image/jpeg', onProgress: mapProgress(onProgress) })
  onProgress?.('Building PNG…')

  const { paper } = sheetLayout(sheet)
  const svgText = renderSheetSvg({ sheet, palette, mapImage })
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = Math.round((paper.width / 25.4) * EXPORT_DPI)
    canvas.height = Math.round((paper.height / 25.4) * EXPORT_DPI)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
    )
    return withPngDpi(blob, EXPORT_DPI)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// PNG resolution metadata: a pHYs chunk inserted right after IHDR.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function withPngDpi(png: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer())
  const ihdrEnd = 8 + 4 + 4 + 13 + 4 // signature + length + type + IHDR data + CRC
  const pxPerMetre = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // "pHYs"
  view.setUint32(8, pxPerMetre)
  view.setUint32(12, pxPerMetre)
  chunk[16] = 1 // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)))
  return new Blob([bytes.subarray(0, ihdrEnd), chunk, bytes.subarray(ihdrEnd)], { type: 'image/png' })
}
