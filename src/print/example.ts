import { sheetGrid, type Sheet } from './sheet'

/**
 * The worked example in the "How to give a grid reference" box.
 *
 * - `off`: instructions only.
 * - `center`: the map centre, marked on the sheet.
 * - `custom`: a user-chosen point with a user-given name, marked on the sheet.
 */
export interface ExampleSetting {
  mode: 'off' | 'center' | 'custom'
  /** Custom point, [lon, lat]. */
  point: [number, number] | null
  /** Custom name. */
  name: string
}

export interface ResolvedExample {
  name: string
  point: [number, number]
}

export const DEFAULT_EXAMPLE: ExampleSetting = { mode: 'off', point: null, name: '' }

export function isOnSheet(sheet: Sheet, point: [number, number]) {
  const g = sheetGrid(sheet)
  const [e, n] = g.conv.forward(point)
  return e >= g.minE && e <= g.maxE && n >= g.minN && n <= g.maxN
}

/** The example point for a sheet, or null when there is none to print. */
export function resolveExample(sheet: Sheet, setting: ExampleSetting): ResolvedExample | null {
  if (setting.mode === 'center') return { name: 'Map centre', point: sheet.center }
  if (setting.mode === 'custom' && setting.point && isOnSheet(sheet, setting.point)) {
    return { name: setting.name.trim() || 'Sample point', point: setting.point }
  }
  return null
}

// URL hash: `ex=center`, `ex=c,<lat>,<lon>,<base64url name>` (`ex=c` without a point), or nothing for off (default).

export function encodeExample(setting: ExampleSetting, encodeText: (s: string) => string): string | null {
  if (setting.mode === 'off') return null
  if (setting.mode === 'center') return 'center'
  const parts = ['c']
  if (setting.point) parts.push(setting.point[1].toFixed(5), setting.point[0].toFixed(5))
  else parts.push('', '')
  if (setting.name) parts.push(encodeText(setting.name))
  return parts.join(',')
}

export function decodeExample(value: string | null, decodeText: (s: string) => string | null): ExampleSetting {
  if (value === 'center') return { mode: 'center', point: null, name: '' }
  const [kind, lat, lon, name] = (value ?? '').split(',')
  if (kind !== 'c') return { ...DEFAULT_EXAMPLE }
  const point: [number, number] | null = lat && lon && Number.isFinite(+lat) && Number.isFinite(+lon) ? [+lon, +lat] : null
  return { mode: 'custom', point, name: (name && decodeText(name)) || '' }
}
