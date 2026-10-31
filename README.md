# MGRS Map Generator

A browser app for making printable, NATO-style topographic map sheets with an MGRS grid, for
orienteering and land navigation training. It is a static site: no backend, database or API keys.

## Features

**Map**
- Military topo style: forest, open ground, farmland, marsh, water, built-up areas, buildings, roads, tracks, railways and place names
- Contours (index contour every 5th line, labelled) and subtle hillshade
- Two map styles, on screen and in print: **Military topo** (green forest) and **Orienteering** (ISOM-like: white runnable forest, yellow open land)
- MGRS grid that adapts to zoom (100 km / 10 km / 1 km / 100 m), with zone boundaries and 100 km square IDs; correct across UTM zones, including the Norway (32V) and Svalbard exceptions
- Search for places (Photon geocoder, biased to the current view) or type a coordinate: MGRS (`33V XF 513 653`, or `XF 513 653` in the zone at the map centre) or decimal `lat, lon`
- Live cursor coordinate, and click to read a coordinate at 4, 6, 8 or 10 figures with copy

**Sheet**
- Print area on the map: A4 or A3, portrait or landscape, 1:10 000 / 1:25 000 / 1:50 000, moved with a drag handle
- The frame is a rectangle in the UTM grid of its zone, so the printed grid is square to the paper (grid north up)
- Margin information: title, 100 km square(s), datum and zone; MGRS grid labels with full values near the corners, and principal digits repeated along the grid lines on the map; legend with the date of the map data; scale bars: metric (default), imperial (yards, or statute miles at 1:50 000) or both; contour interval; north points diagram with grid convergence, magnetic declination (WMM2025), grid–magnetic angle and annual change in degrees and mils, and grid ↔ magnetic azimuth conversion notes; "How to give a grid reference" box with a drawing of the sample grid square; attribution
- Zone junctions and 100 km squares as on NATO sheets: where a grid zone junction crosses the sheet, each zone's grid is drawn only within its own zone (meeting at an angle at the labelled junction line, with its own edge figures), so every grid line gives a true MGRS reference; 100 km square letters on both sides of square boundaries; a "100 km squares" diagram with the grid zone designation and the grid–magnetic angle per zone
- Optional worked grid reference example: off (default), the map centre, or a custom named point

**Export**
- Sheet preview
- Print follows the Layers toggles: switching off hillshade, contours or the MGRS grid leaves them (and their legend entries and notes) off the sheet
- PDF at exact scale: the page is the paper size, the map is rendered at 300 DPI and placed at its exact frame size, and the grid and margin graphics are vectors on top
- PNG of the whole sheet at 300 DPI, tagged with its resolution
- Large sheets are rendered in parts when they exceed the graphics card's canvas limit

**Save and share**
- All sheet settings live in the URL, e.g. `#map=12/59.33/18.07&sheet=a4-landscape-25000&at=59.33,18.07`, so a link reproduces the sheet; **Copy link** copies it
- The sheet includes its map style and which of hillshade, contours and the grid are on (`hide=contours,grid` in the URL); the print area toggle is screen-only
- **My maps**: named sheets saved in this browser (open, update, save as new, delete)
- Download a sheet as a `.json` file and open it again, e.g. on another computer; files are validated on load

## Run

Requires Node.js 20.19+.

```sh
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # type-check and build static files into dist/
npm run preview   # serve dist/ locally
```

On Windows PowerShell, if `npm` is blocked by the execution policy, use `npm.cmd`, or run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

`dist/` can be uploaded as-is to any static host (GitHub Pages, Cloudflare Pages, Netlify).

Pushing to `master` deploys to GitHub Pages via `.github/workflows/deploy.yml` (repo Settings → Pages →
Source: **GitHub Actions**).

## Printing

Exports open from **Preview sheet**. Print the PDF at **100% / "Actual size"** (not "Fit to page");
the scale is then exact, e.g. 1 km grid squares measure 40 mm at 1:25 000.

The PDF uses the built-in PDF fonts (Helvetica), which cover Latin-1 only (å, ä, ö are fine).
Titles in other scripts would need an embedded font.

## Structure

| Path | Purpose |
|---|---|
| `src/map/style.ts` | Map style, military and orienteering palettes, live recolouring, layer groups |
| `src/terrain/dem.ts` | Elevation source; contours (maplibre-contour) and hillshade |
| `src/mgrs/grid.ts` | MGRS grid generation per UTM zone, zone lookup, reference formatting |
| `src/print/sheet.ts` | Sheet model: paper, scale, layout of frame and margin blocks, grid-aligned frame, URL-hash state |
| `src/print/sheet-zones.ts` | Grid zones and 100 km squares on a sheet: per-zone grid lines clipped at zone junctions, junction lines, square regions |
| `src/print/sheet-svg.ts` | The printed sheet as SVG in mm: grid and labels, header, legend, scale bar, north diagram, grid reference box, attribution |
| `src/print/render-map.ts` | Off-screen map render of the frame at a given DPI, tiled when needed |
| `src/print/export.ts` | PDF export (jsPDF + svg2pdf.js) and PNG export |
| `src/print/example.ts` | Grid reference example setting |
| `src/print/saved.ts` | My maps (browser storage), .json sheet files, sheet validation |
| `src/search/places.ts` | Place search (Photon) and typed MGRS / lat-lon coordinates |
| `src/print/north.ts` | Grid convergence, magnetic declination and mils |
| `src/ui/` | Sheet preview dialog, collapsible panel sections, search box |
| `src/App.vue` | Map, side panel, print-area handle, coordinate readout |

## Data and attribution

- Map data © OpenStreetMap contributors (ODbL), vector tiles from OpenFreeMap / OpenMapTiles
- Elevation: AWS Terrain Tiles (Mapzen and its sources)
- Place search: Photon by Komoot (OpenStreetMap data)
- Magnetic model: NOAA World Magnetic Model 2025
