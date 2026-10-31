import { VECTOR_TILES_URL } from './style'

let cached: Promise<string | null> | null = null

/**
 * Date of the map data, e.g. "2026-10-25", from the OpenFreeMap build the vector tiles come from: its
 * TileJSON points at versioned tiles such as …/planet/20261025_080012_pt/{z}/{x}/{y}.pbf. Null when it
 * can't be read (offline, or the URL format changes); fetched once per page load.
 */
export function mapDataDate(): Promise<string | null> {
  cached ??= fetch(VECTOR_TILES_URL)
    .then((res) => (res.ok ? res.json() : null))
    .then((tilejson: { tiles?: string[] } | null) => {
      const m = /\/(\d{4})(\d{2})(\d{2})_\d{6}/.exec(tilejson?.tiles?.[0] ?? '')
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null
    })
    .catch(() => null)
  return cached
}
