import type { Map, StyleSpecification, ExpressionSpecification } from 'maplibre-gl'
import { demSource, contourTilesUrl } from '../terrain/dem'

export interface Palette {
  paper: string
  forest: string
  open: string
  farmland: string
  wetland: string
  builtUp: string
  water: string
  waterway: string
  contour: string
  roadMajor: string
  roadMajorCasing: string
  roadMinor: string
  roadMinorCasing: string
  track: string
  building: string
  text: string
  grid: string
}

// Military topo palette, loosely following DGIWG print colours.
export const militaryPalette: Palette = {
  paper: '#ffffff',
  forest: '#bfe0a3',
  open: '#ffffff',
  farmland: '#f7f2df',
  wetland: '#e6f2fa',
  builtUp: '#f0d6c8',
  water: '#9fd0ee',
  waterway: '#3d8fd1',
  contour: '#b5763a',
  roadMajor: '#c8352a',
  roadMajorCasing: '#5a1a12',
  roadMinor: '#ffffff',
  roadMinorCasing: '#222222',
  track: '#222222',
  building: '#3a3a3a',
  text: '#111111',
  grid: '#000000',
}

// Orienteering palette, loosely following ISOM: white is runnable forest, yellow is open land.
export const orienteeringPalette: Palette = {
  paper: '#ffffff',
  forest: '#ffffff',
  open: '#ffcc55',
  farmland: '#ffe4a3',
  wetland: '#ffffff',
  builtUp: '#e6d2b5',
  water: '#5cc3f0',
  waterway: '#1e90d6',
  contour: '#c8641e',
  roadMajor: '#d9a066',
  roadMajorCasing: '#000000',
  roadMinor: '#ffffff',
  roadMinorCasing: '#000000',
  track: '#000000',
  building: '#5a5a5a',
  text: '#000000',
  grid: '#000000',
}

export type MapStyleId = 'military' | 'orienteering'

export const MAP_STYLES: Record<MapStyleId, { label: string; palette: Palette }> = {
  military: { label: 'Military topo', palette: militaryPalette },
  orienteering: { label: 'Orienteering', palette: orienteeringPalette },
}

const FONT_REGULAR = ['Noto Sans Regular']
const FONT_ITALIC = ['Noto Sans Italic']
const FONT_BOLD = ['Noto Sans Bold']

const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:latin'], ['get', 'name']]

const MAJOR_ROADS = ['motorway', 'trunk', 'primary', 'secondary']
const MINOR_ROADS = ['tertiary', 'minor', 'service']

function baseStyle(p: Palette, contourInterval?: number): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution:
          '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      dem: {
        type: 'raster-dem',
        tiles: [demSource.sharedDemProtocolUrl],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 13,
        attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>',
      },
      contours: {
        type: 'vector',
        tiles: [contourTilesUrl(contourInterval)],
        maxzoom: 15,
      },
      grid: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
      sheet: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': p.paper } },

      // Land cover
      {
        id: 'landcover-farmland',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'farmland'],
        paint: { 'fill-color': p.farmland },
      },
      {
        id: 'landcover-open',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'sand', 'rock']]],
        paint: { 'fill-color': p.open },
      },
      {
        id: 'landuse-builtup',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'commercial', 'industrial', 'retail']]],
        paint: { 'fill-color': p.builtUp },
      },
      {
        id: 'landcover-forest',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': p.forest },
      },
      {
        id: 'landcover-wetland',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wetland'],
        paint: { 'fill-color': p.wetland },
      },
      {
        id: 'landcover-wetland-pattern',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'class'], 'wetland'],
        paint: { 'fill-pattern': 'marsh' },
      },

      // Relief
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': 0.25,
          'hillshade-shadow-color': 'rgba(0,0,0,0.35)',
          'hillshade-highlight-color': 'rgba(255,255,255,0)',
          'hillshade-accent-color': 'rgba(0,0,0,0)',
        },
      },
      {
        id: 'contour-minor',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['==', ['get', 'level'], 0],
        paint: { 'line-color': p.contour, 'line-width': 0.6 },
      },
      {
        id: 'contour-index',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['>', ['get', 'level'], 0],
        paint: { 'line-color': p.contour, 'line-width': 1.3 },
      },

      // Water
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': p.water, 'fill-outline-color': p.waterway },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: {
          'line-color': p.waterway,
          'line-width': ['match', ['get', 'class'], 'river', 2, 'canal', 1.5, 1],
        },
      },

      // Buildings
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: { 'fill-color': p.building },
      },

      // Transport
      {
        id: 'road-path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'path'],
        paint: { 'line-color': p.track, 'line-width': 0.8, 'line-dasharray': [1, 2] },
      },
      {
        id: 'road-track',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'track'],
        paint: { 'line-color': p.track, 'line-width': 1, 'line-dasharray': [4, 2] },
      },
      {
        id: 'road-minor-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MINOR_ROADS]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadMinorCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 5] },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MINOR_ROADS]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadMinor, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 3] },
      },
      {
        id: 'road-major-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MAJOR_ROADS]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadMajorCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 15, 8] },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', MAJOR_ROADS]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadMajor, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 15, 6] },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        paint: { 'line-color': p.track, 'line-width': 1.5 },
      },

      // MGRS grid (data set at runtime by ../mgrs/grid.ts)
      {
        id: 'grid-lines',
        type: 'line',
        source: 'grid',
        filter: ['==', ['get', 'kind'], 'line'],
        paint: { 'line-color': p.grid, 'line-width': 0.8 },
      },
      {
        id: 'grid-zones',
        type: 'line',
        source: 'grid',
        filter: ['==', ['get', 'kind'], 'zone'],
        paint: { 'line-color': p.grid, 'line-width': 2.5 },
      },

      // Labels
      {
        id: 'contour-label',
        type: 'symbol',
        source: 'contours',
        'source-layer': 'contours',
        filter: ['>', ['get', 'level'], 0],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['to-string', ['get', 'ele']],
          'text-font': FONT_REGULAR,
          'text-size': 10,
        },
        paint: { 'text-color': p.contour, 'text-halo-color': p.paper, 'text-halo-width': 1.5 },
      },
      {
        id: 'water-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        layout: { 'text-field': NAME, 'text-font': FONT_ITALIC, 'text-size': 12 },
        paint: { 'text-color': p.waterway, 'text-halo-color': p.paper, 'text-halo-width': 1 },
      },
      {
        id: 'road-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT_REGULAR, 'text-size': 10 },
        paint: { 'text-color': p.text, 'text-halo-color': p.paper, 'text-halo-width': 1.5 },
      },
      {
        id: 'place-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        layout: {
          'text-field': NAME,
          'text-font': FONT_BOLD,
          'text-size': ['match', ['get', 'class'], 'city', 16, 'town', 14, 'village', 12, 11],
        },
        paint: { 'text-color': p.text, 'text-halo-color': p.paper, 'text-halo-width': 1.5 },
      },
      {
        id: 'grid-labels',
        type: 'symbol',
        source: 'grid',
        filter: ['==', ['get', 'kind'], 'line'],
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 400,
          'text-field': ['get', 'label'],
          'text-font': FONT_BOLD,
          'text-size': 12,
          'text-keep-upright': true,
        },
        paint: { 'text-color': p.grid, 'text-halo-color': p.paper, 'text-halo-width': 2 },
      },
      {
        id: 'grid-square-labels',
        type: 'symbol',
        source: 'grid',
        filter: ['in', ['get', 'kind'], ['literal', ['square', 'gzd']]],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': FONT_BOLD,
          'text-size': ['match', ['get', 'kind'], 'gzd', 22, 16],
          'text-allow-overlap': true,
        },
        paint: { 'text-color': p.grid, 'text-halo-color': p.paper, 'text-halo-width': 2, 'text-opacity': 0.6 },
      },

      // Print area (data set at runtime from ../print/sheet.ts)
      {
        id: 'sheet-mask',
        type: 'fill',
        source: 'sheet',
        filter: ['==', ['get', 'kind'], 'mask'],
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.25 },
      },
      {
        id: 'sheet-frame',
        type: 'line',
        source: 'sheet',
        filter: ['==', ['get', 'kind'], 'frame'],
        paint: { 'line-color': '#c8352a', 'line-width': 2.5 },
      },
    ],
  }
}

export interface StyleOptions {
  /**
   * Print rendering: fixed contour interval, and no screen-only layers. The grid and the sheet
   * frame are drawn as vector graphics on the printed sheet instead (see ../print/sheet-svg.ts).
   */
  print?: { contourInterval: number }
}

export function buildStyle(p: Palette, options: StyleOptions = {}): StyleSpecification {
  const style = baseStyle(p, options.print?.contourInterval)
  if (options.print) {
    const screenOnly = new Set<string>([...LAYER_GROUPS.grid, ...LAYER_GROUPS.sheet])
    style.layers = style.layers.filter((l) => !screenOnly.has(l.id))
  }
  return style
}

export const LAYER_GROUPS = {
  hillshade: ['hillshade'],
  contours: ['contour-minor', 'contour-index', 'contour-label'],
  grid: ['grid-lines', 'grid-zones', 'grid-labels', 'grid-square-labels'],
  sheet: ['sheet-mask', 'sheet-frame'],
} as const

export type LayerGroup = keyof typeof LAYER_GROUPS

/**
 * Recolours a live map to another palette. Only paint properties change, so runtime state
 * (grid and sheet data, layer visibility) is kept, which a full setStyle would reset.
 */
type PaintName = Parameters<Map['setPaintProperty']>[1]

export function applyPalette(map: Map, p: Palette) {
  for (const layer of buildStyle(p).layers) {
    if (!map.getLayer(layer.id) || !('paint' in layer) || !layer.paint) continue
    for (const [prop, value] of Object.entries(layer.paint)) {
      map.setPaintProperty(layer.id, prop as PaintName, value as Parameters<Map['setPaintProperty']>[2])
    }
  }
  if (map.hasImage('marsh')) map.updateImage('marsh', marshPattern(p.waterway))
}

/** Marsh symbol: short horizontal blue dashes, tiled as a fill pattern. */
export function marshPattern(color: string) {
  const width = 16
  const height = 8
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.fillRect(2, 3, 8, 1)
  return ctx.getImageData(0, 0, width, height)
}
