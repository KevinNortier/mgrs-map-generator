import { addProtocol } from 'maplibre-gl'
import mlcontour from 'maplibre-contour'

// AWS Open Data terrain tiles (Terrarium encoding), global coverage, no API key.
const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

export const demSource = new mlcontour.DemSource({
  url: TERRARIUM_URL,
  encoding: 'terrarium',
  maxzoom: 13,
  worker: true,
})

// Registers the contour and shared-DEM protocols with MapLibre. Must run before the map is created.
demSource.setupMaplibre({ addProtocol })

// Screen contour intervals in metres per zoom: [minor, index]. The index contour is every 5th line.
// Print intervals are fixed per scale instead (see CONTOUR_INTERVAL in ../print/sheet.ts).
const SCREEN_THRESHOLDS = {
  9: [100, 500],
  11: [50, 250],
  12: [20, 100],
  13: [10, 50],
  15: [5, 25],
}

/** Contour tile URL; `interval` fixes one interval at all zooms (print), otherwise screen intervals apply. */
export function contourTilesUrl(interval?: number) {
  return demSource.contourProtocolUrl({
    thresholds: interval ? { 0: [interval, interval * 5] } : SCREEN_THRESHOLDS,
    multiplier: 1,
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: 'contours',
    overzoom: 1,
  })
}
