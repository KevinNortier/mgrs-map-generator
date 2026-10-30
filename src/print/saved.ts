import { DEFAULT_EXAMPLE, type ExampleSetting } from './example'
import { PAPERS, SCALES, type Orientation, type Paper, type Scale, type Sheet } from './sheet'

/** A sheet saved in this browser ("My maps"). */
export interface SavedMap {
  id: string
  savedAt: string
  sheet: Sheet
}

/** The .json file format. */
interface SheetFile {
  app: 'mgrs-map-generator'
  version: 1
  sheet: Sheet
}

const STORAGE_KEY = 'mgrs-map:saved-maps:v1'

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parsePoint(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2 || !isNumber(v[0]) || !isNumber(v[1])) return null
  const [lon, lat] = v
  return lon >= -180 && lon <= 180 && lat >= -80 && lat <= 84 ? [lon, lat] : null
}

function parseExample(v: unknown): ExampleSetting {
  if (typeof v !== 'object' || v === null) return { ...DEFAULT_EXAMPLE }
  const o = v as Record<string, unknown>
  const mode = o.mode === 'center' || o.mode === 'custom' ? o.mode : 'off'
  return { mode, point: parsePoint(o.point), name: typeof o.name === 'string' ? o.name.slice(0, 40) : '' }
}

/**
 * Validates a sheet from storage or a file, field by field. Returns null when the
 * essentials (paper, scale, centre) are unusable; optional fields fall back to defaults.
 */
export function parseSheet(v: unknown): Sheet | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const center = parsePoint(o.center)
  if (!center || typeof o.paper !== 'string' || !(o.paper in PAPERS) || !SCALES.includes(o.scale as Scale)) return null
  return {
    title: typeof o.title === 'string' ? o.title.slice(0, 60) : '',
    paper: o.paper as Paper,
    orientation: (o.orientation === 'portrait' ? 'portrait' : 'landscape') as Orientation,
    scale: o.scale as Scale,
    center,
    example: parseExample(o.example),
    style: o.style === 'orienteering' ? 'orienteering' : 'military',
  }
}

/** Deep copy without Vue proxies. */
export function cloneSheet(sheet: Sheet): Sheet {
  return JSON.parse(JSON.stringify(sheet))
}

// My maps (localStorage). Storage can be unavailable (private mode, blocked site data), so every
// access is guarded; callers check `storageAvailable()` to tell the user.

export function storageAvailable(): boolean {
  try {
    const probe = `${STORAGE_KEY}:probe`
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function loadSavedMaps(): SavedMap[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.flatMap((entry) => {
      const sheet = parseSheet(entry?.sheet)
      if (!sheet || typeof entry.id !== 'string') return []
      return [{ id: entry.id, savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : '', sheet }]
    })
  } catch {
    return []
  }
}

/** Writes the list; returns false when storage is unavailable or full. */
export function storeSavedMaps(maps: SavedMap[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps))
    return true
  } catch {
    return false
  }
}

export function newMapId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// .json files

export function sheetToFile(sheet: Sheet): Blob {
  const file: SheetFile = { app: 'mgrs-map-generator', version: 1, sheet: cloneSheet(sheet) }
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
}

export async function sheetFromFile(file: File): Promise<Sheet> {
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const o = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  if (o.app !== 'mgrs-map-generator') throw new Error('This is not an MGRS Map Generator sheet file.')
  const sheet = parseSheet(o.sheet)
  if (!sheet) throw new Error('The sheet in this file is incomplete or damaged.')
  return sheet
}
