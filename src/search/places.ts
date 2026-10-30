import { toPoint } from 'mgrs'
import { formatMgrs, mgrsAt } from '../mgrs/grid'

/** A search result: a place from the geocoder, or a coordinate typed into the box. */
export interface SearchResult {
  label: string
  detail: string
  lngLat: [number, number]
  /** [west, south, east, north] for areas (towns, lakes, municipalities). */
  bounds?: [number, number, number, number]
  kind: 'place' | 'coordinate'
}

// Photon (Komoot): free OpenStreetMap geocoder that allows search-as-you-type. No API key.
const PHOTON_URL = 'https://photon.komoot.io/api/'

/**
 * Reads a typed coordinate: a full MGRS reference ("33V XF 513 653"), one without the grid
 * zone ("XF 513 653", taken in the zone at `near`), or decimal "lat, lon".
 */
export function parseCoordinate(query: string, near: [number, number]): SearchResult | null {
  const q = query.trim().toUpperCase()

  const latLon = /^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(q)
  if (latLon) {
    const lat = Number(latLon[1])
    const lon = Number(latLon[2])
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { label: `${lat}, ${lon}`, detail: mgrsAt([lon, lat], 10) ?? 'Latitude, longitude', lngLat: [lon, lat], kind: 'coordinate' }
    }
  }

  const compact = q.replace(/\s+/g, '')
  const mgrs = /^(\d{1,2}[C-HJ-NP-X])?([A-HJ-NP-Z][A-HJ-NP-V])(\d{2}|\d{4}|\d{6}|\d{8}|\d{10})?$/.exec(compact)
  if (!mgrs || (!mgrs[1] && !mgrs[3])) return null // two letters alone are more likely a place name
  const gzd = mgrs[1] ?? /^\d{1,2}[A-Z]/.exec(mgrsAt(near, 4)?.replace(/\s+/g, '') ?? '')?.[0]
  if (!gzd) return null
  const ref = `${gzd}${mgrs[2]}${mgrs[3] ?? ''}`
  try {
    const [lon, lat] = toPoint(ref)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
    return {
      label: formatMgrs(ref),
      detail: mgrs[1] ? 'MGRS reference' : `MGRS reference, zone ${gzd} from the map centre`,
      lngLat: [lon, lat],
      kind: 'coordinate',
    }
  } catch {
    return null
  }
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    street?: string
    housenumber?: string
    city?: string
    county?: string
    state?: string
    country?: string
    osm_value?: string
    extent?: [number, number, number, number] // [west, north, east, south]
  }
}

/** Places matching `query`, ranked with a bias towards `near` (the map centre). */
export async function searchPlaces(query: string, near: [number, number], signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: '8', lat: near[1].toFixed(4), lon: near[0].toFixed(4) })
  const res = await fetch(`${PHOTON_URL}?${params}`, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = (await res.json()) as { features?: PhotonFeature[] }
  const seen = new Set<string>()
  return (data.features ?? []).flatMap((f) => {
    const p = f.properties
    const label = p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ')
    if (!label) return []
    const type = p.osm_value ? p.osm_value.replace(/_/g, ' ') : ''
    const detail = [type, p.city !== label ? p.city : null, p.county ?? p.state, p.country].filter(Boolean).join(', ')
    const key = `${label}|${detail}`
    if (seen.has(key)) return []
    seen.add(key)
    const e = p.extent
    return [{ label, detail, lngLat: f.geometry.coordinates, bounds: e ? [e[0], e[3], e[2], e[1]] : undefined, kind: 'place' as const }]
  })
}
