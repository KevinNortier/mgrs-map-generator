<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, shallowRef, computed, watch } from 'vue'
import { LngLatBounds, Map, Marker, NavigationControl, ScaleControl, type GeoJSONSource } from 'maplibre-gl'
import { applyPalette, buildStyle, marshPattern, LAYER_GROUPS, MAP_STYLES, type LayerGroup, type MapStyleId } from './map/style'
import { buildGrid, mgrsAt, spacingForZoom } from './mgrs/grid'
import SheetPreview from './ui/SheetPreview.vue'
import PanelSection from './ui/PanelSection.vue'
import { DEFAULT_EXAMPLE, isOnSheet, type ExampleSetting } from './print/example'
import { download, exportFileName } from './print/export'
import {
  cloneSheet,
  loadSavedMaps,
  newMapId,
  sheetFromFile,
  sheetToFile,
  storageAvailable,
  storeSavedMaps,
  type SavedMap,
} from './print/saved'
import {
  CONTOUR_INTERVAL,
  GRID_SPACING,
  SCALES,
  frameSizeMm,
  groundSizeM,
  readSheetFromHash,
  sheetGeoJSON,
  sheetOutline,
  writeSheetToHash,
  type Orientation,
  type Paper,
  type Sheet,
} from './print/sheet'

type Digits = 4 | 6 | 8 | 10

const DEFAULT_CENTER: [number, number] = [18.07, 59.33]

const mapEl = ref<HTMLDivElement>()
const map = shallowRef<Map>()
let mapLoaded = false
const marker = new Marker({ color: '#c8352a' })

const layers = reactive<Record<LayerGroup, boolean>>({ hillshade: true, contours: true, grid: true, sheet: true })
const cursor = ref<string | null>(null)
const picked = ref<[number, number] | null>(null)
const digits = ref<Digits>(8)
const gridSpacing = ref(1000)
const copied = ref(false)
const previewOpen = ref(false)

const hadSheetInHash = new URLSearchParams(location.hash.slice(1)).has('at')
const sheet = reactive<Sheet>(
  readSheetFromHash({
    title: '',
    paper: 'a4',
    orientation: 'landscape',
    scale: 25_000,
    center: DEFAULT_CENTER,
    example: { ...DEFAULT_EXAMPLE },
    style: 'military',
  }),
)

const palette = computed(() => MAP_STYLES[sheet.style].palette)
watch(
  () => sheet.style,
  () => {
    if (map.value && mapLoaded) applyPalette(map.value, palette.value)
  },
)

const pickedRef = computed(() => (picked.value ? mgrsAt(picked.value, digits.value) : null))
const frame = computed(() => frameSizeMm(sheet))
const ground = computed(() => groundSizeM(sheet))
const sheetCenterRef = computed(() => mgrsAt(sheet.center, 6))

const EXAMPLE_MODES: { mode: ExampleSetting['mode']; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: 'center', label: 'Map centre' },
  { mode: 'custom', label: 'Custom' },
]
const pickingExample = ref(false)
const exampleHint = computed(() => {
  const ex = sheet.example
  if (ex.mode === 'off') return 'Instructions only, no worked example.'
  if (ex.mode === 'center') return `${mgrsAt(sheet.center, 8)} · marked on the sheet as "Map centre".`
  if (!ex.point) return 'Pick a point on the map and give it a name.'
  if (!isOnSheet(sheet, ex.point)) return 'The point is outside the sheet, so no example is printed.'
  return `${mgrsAt(ex.point, 8)} · marked on the sheet. Drag the marker to adjust.`
})

// Custom example point: draggable marker, shown while the custom mode has a point
const exampleMarker = new Marker({ element: createExampleElement(), draggable: true })
exampleMarker.on('dragend', () => {
  const { lng, lat } = exampleMarker.getLngLat()
  sheet.example.point = [lng, lat]
})

function createExampleElement() {
  const el = document.createElement('div')
  el.className = 'example-marker'
  el.title = 'Grid reference example point'
  return el
}

function updateExampleMarker() {
  const m = map.value
  const { mode, point } = sheet.example
  if (m && mode === 'custom' && point && layers.sheet) exampleMarker.setLngLat(point).addTo(m)
  else exampleMarker.remove()
}

function setExampleMode(mode: ExampleSetting['mode']) {
  sheet.example.mode = mode
  pickingExample.value = mode === 'custom' && !sheet.example.point
}

watch(pickingExample, (on) => {
  const canvas = map.value?.getCanvas()
  if (canvas) canvas.style.cursor = on ? 'crosshair' : ''
})

// Drag handle at the centre of the print area. Dragging the whole frame would block panning,
// since at typical zoom levels the sheet is larger than the screen.
const handle = new Marker({ element: createHandleElement(), draggable: true })
handle.on('drag', () => {
  const { lng, lat } = handle.getLngLat()
  sheet.center = [lng, lat]
})

function createHandleElement() {
  const el = document.createElement('div')
  el.className = 'sheet-handle'
  el.title = 'Drag to move the print area'
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg>'
  return el
}

function updateGrid() {
  const m = map.value
  if (!m) return
  const b = m.getBounds()
  const zoom = m.getZoom()
  gridSpacing.value = spacingForZoom(zoom)
  ;(m.getSource('grid') as GeoJSONSource).setData(
    buildGrid({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, zoom),
  )
}

function updateSheet() {
  const m = map.value
  if (!m || !mapLoaded) return
  ;(m.getSource('sheet') as GeoJSONSource).setData(sheetGeoJSON(sheet))
  handle.setLngLat(sheet.center)
  updateExampleMarker()
  writeSheetToHash(sheet)
}

watch(sheet, updateSheet, { deep: true })

function setLayerGroup(group: LayerGroup, visible: boolean) {
  layers[group] = visible
  for (const id of LAYER_GROUPS[group]) map.value?.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
  if (group === 'sheet' && map.value) {
    if (visible) handle.addTo(map.value)
    else handle.remove()
    updateExampleMarker()
  }
}

function layerLabel(group: LayerGroup) {
  switch (group) {
    case 'grid':
      return `MGRS grid (${formatSpacing(gridSpacing.value)})`
    case 'sheet':
      return 'Print area'
    default:
      return group[0].toUpperCase() + group.slice(1)
  }
}

function centerSheetOnView() {
  const c = map.value?.getCenter()
  if (c) sheet.center = [c.lng, c.lat]
}

function zoomToSheet() {
  const bounds = new LngLatBounds()
  for (const p of sheetOutline(sheet)) bounds.extend(p as [number, number])
  map.value?.fitBounds(bounds, { padding: 40 })
}

// Status lines shown next to collapsed panel section titles
const sheetSummary = computed(() => `${sheet.paper.toUpperCase()} ${sheet.orientation} · ${formatScale(sheet.scale)}`)
const exampleSummary = computed(() => EXAMPLE_MODES.find((o) => o.mode === sheet.example.mode)?.label ?? null)
const layersSummary = computed(() => {
  const on = (Object.keys(layers) as LayerGroup[]).filter((g) => layers[g]).length
  return `${MAP_STYLES[sheet.style].label} · ${on} of ${Object.keys(layers).length} on`
})

const pickedOnSheet = computed(() => !!picked.value && isOnSheet(sheet, picked.value))

/** Turns the read-out point into the sheet's custom grid reference example. */
function usePickedAsExample() {
  if (!picked.value) return
  sheet.example.mode = 'custom'
  sheet.example.point = [...picked.value]
  pickingExample.value = false
}

// Save & share: link, My maps (this browser) and .json files
const canStore = storageAvailable()
const savedMaps = ref<SavedMap[]>(loadSavedMaps())
/** The saved map the current sheet came from, if any; Save then updates it. */
const activeMapId = ref<string | null>(null)
const activeMap = computed(() => savedMaps.value.find((m) => m.id === activeMapId.value) ?? null)
const isDirty = computed(() => !!activeMap.value && JSON.stringify(activeMap.value.sheet) !== JSON.stringify(sheet))
const saveMessage = ref('')
const fileInput = ref<HTMLInputElement>()
const saveSummary = computed(() => (canStore ? `${savedMaps.value.length} saved` : null))

function flash(message: string) {
  saveMessage.value = message
  setTimeout(() => {
    if (saveMessage.value === message) saveMessage.value = ''
  }, 3000)
}

function mapName(s: Sheet) {
  return s.title.trim() || `Untitled · ${mgrsAt(s.center, 4) ?? ''}`
}

function mapMeta(m: SavedMap) {
  const date = m.savedAt ? new Date(m.savedAt).toLocaleDateString() : ''
  return `${m.sheet.paper.toUpperCase()} ${m.sheet.orientation} · 1:${m.sheet.scale / 1000}k${date ? ` · ${date}` : ''}`
}

function persist(maps: SavedMap[]) {
  if (!storeSavedMaps(maps)) {
    flash('Could not save: browser storage is unavailable or full.')
    return false
  }
  savedMaps.value = maps
  return true
}

function saveMap(asNew = false) {
  const updating = !asNew && !!activeMap.value
  const entry: SavedMap = { id: updating ? activeMapId.value! : newMapId(), savedAt: new Date().toISOString(), sheet: cloneSheet(sheet) }
  if (persist([entry, ...savedMaps.value.filter((m) => m.id !== entry.id)])) {
    activeMapId.value = entry.id
    flash(updating ? 'Saved map updated.' : 'Saved to My maps.')
  }
}

/** Replaces the current sheet (from My maps or a file) and shows it. */
function applySheet(next: Sheet) {
  Object.assign(sheet, cloneSheet(next))
  pickingExample.value = false
  zoomToSheet()
}

function openMap(m: SavedMap) {
  applySheet(m.sheet)
  activeMapId.value = m.id
}

function deleteMap(m: SavedMap) {
  if (!confirm(`Delete "${mapName(m.sheet)}" from My maps?`)) return
  if (persist(savedMaps.value.filter((x) => x.id !== m.id)) && activeMapId.value === m.id) activeMapId.value = null
}

async function copyLink() {
  writeSheetToHash(sheet)
  try {
    await navigator.clipboard.writeText(location.href)
    flash('Link copied. It opens this exact sheet.')
  } catch {
    flash('Could not copy; copy the address bar instead.')
  }
}

function downloadJson() {
  download(sheetToFile(sheet), exportFileName(sheet, 'json'))
}

async function openJson(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    applySheet(await sheetFromFile(file))
    activeMapId.value = null
    flash(`Opened ${file.name}.`)
  } catch (err) {
    flash(err instanceof Error ? err.message : String(err))
  }
}

async function copyPicked() {
  if (!pickedRef.value) return
  await navigator.clipboard.writeText(pickedRef.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

function formatSpacing(m: number) {
  if (m === 0) return 'zones only'
  return m >= 1000 ? `${m / 1000} km` : `${m} m`
}

function formatScale(scale: number) {
  return `1:${scale.toLocaleString('en-US').replace(/,/g, ' ')}`
}

onMounted(() => {
  const hadMapInHash = new URLSearchParams(location.hash.slice(1)).has('map')
  const m = new Map({
    container: mapEl.value!,
    style: buildStyle(palette.value),
    center: sheet.center,
    zoom: 12,
    hash: 'map',
    maxPitch: 0,
  })
  m.dragRotate.disable()
  m.touchZoomRotate.disableRotation()
  m.addControl(new NavigationControl({ showCompass: false }))
  m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

  m.setMissingStyleImageResolver((id) => {
    if (id === 'marsh') m.addImage('marsh', marshPattern(palette.value.waterway))
  })
  m.on('load', () => {
    mapLoaded = true
    if (!hadSheetInHash) centerSheetOnView()
    updateGrid()
    updateSheet()
    handle.setLngLat(sheet.center).addTo(m)
    if (hadSheetInHash && !hadMapInHash) zoomToSheet()
  })
  m.on('moveend', updateGrid)
  m.on('mousemove', (e) => (cursor.value = mgrsAt([e.lngLat.lng, e.lngLat.lat], 10)))
  m.on('mouseout', () => (cursor.value = null))
  m.on('click', (e) => {
    if (pickingExample.value) {
      sheet.example.point = [e.lngLat.lng, e.lngLat.lat]
      pickingExample.value = false
      return
    }
    picked.value = [e.lngLat.lng, e.lngLat.lat]
    marker.setLngLat(e.lngLat).addTo(m)
  })
  map.value = m
})

onBeforeUnmount(() => map.value?.remove())
</script>

<template>
  <div class="layout">
    <aside class="panel">
      <h1>MGRS Map Generator</h1>

      <PanelSection id="print" title="Print area" :summary="sheetSummary">
        <div class="field">
          <label class="label" for="sheet-title">Title</label>
          <input id="sheet-title" v-model.trim="sheet.title" type="text" placeholder="Untitled sheet" maxlength="60" />
        </div>
        <div class="field">
          <span class="label">Paper</span>
          <div class="segmented">
            <button v-for="p in ['a4', 'a3'] as Paper[]" :key="p" :class="{ active: sheet.paper === p }" @click="sheet.paper = p">
              {{ p.toUpperCase() }}
            </button>
          </div>
        </div>
        <div class="field">
          <span class="label">Orientation</span>
          <div class="segmented">
            <button
              v-for="o in ['portrait', 'landscape'] as Orientation[]"
              :key="o"
              :class="{ active: sheet.orientation === o }"
              @click="sheet.orientation = o"
            >
              {{ o[0].toUpperCase() + o.slice(1) }}
            </button>
          </div>
        </div>
        <div class="field">
          <span class="label">Scale</span>
          <div class="segmented">
            <button v-for="s in SCALES" :key="s" :class="{ active: sheet.scale === s }" @click="sheet.scale = s">
              {{ formatScale(s) }}
            </button>
          </div>
        </div>
        <dl class="facts">
          <dt>Map frame</dt>
          <dd>{{ frame.width }} × {{ frame.height }} mm</dd>
          <dt>Ground</dt>
          <dd>{{ (ground.width / 1000).toFixed(2) }} × {{ (ground.height / 1000).toFixed(2) }} km</dd>
          <dt>Grid</dt>
          <dd>{{ formatSpacing(GRID_SPACING[sheet.scale]) }}</dd>
          <dt>Contours</dt>
          <dd>{{ CONTOUR_INTERVAL[sheet.scale] }} m</dd>
          <dt>Centre</dt>
          <dd class="mono">{{ sheetCenterRef ?? '—' }}</dd>
        </dl>
        <div class="actions">
          <button @click="centerSheetOnView">Centre on view</button>
          <button @click="zoomToSheet">Zoom to sheet</button>
          <button class="primary" @click="previewOpen = true">Preview sheet</button>
        </div>
      </PanelSection>

      <PanelSection id="example" title="Grid reference example" :summary="exampleSummary">
        <div class="field">
          <div class="segmented">
            <button
              v-for="opt in EXAMPLE_MODES"
              :key="opt.mode"
              :class="{ active: sheet.example.mode === opt.mode }"
              @click="setExampleMode(opt.mode)"
            >
              {{ opt.label }}
            </button>
          </div>
          <template v-if="sheet.example.mode === 'custom'">
            <input v-model.trim="sheet.example.name" type="text" placeholder="Name, e.g. Old barn" maxlength="40" />
            <div class="actions">
              <button :class="{ active: pickingExample }" @click="pickingExample = !pickingExample">
                {{ pickingExample ? 'Click the map…' : sheet.example.point ? 'Pick again' : 'Pick on map' }}
              </button>
            </div>
          </template>
          <p class="hint">{{ exampleHint }}</p>
        </div>
      </PanelSection>

      <PanelSection id="save" title="Save &amp; share" :summary="saveSummary">
        <div class="actions">
          <button @click="copyLink">Copy link</button>
          <button @click="downloadJson">Download .json</button>
          <button @click="fileInput?.click()">Open .json…</button>
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="openJson" />
        </div>
        <p v-if="saveMessage" class="hint" role="status">{{ saveMessage }}</p>

        <h3 class="subheading">My maps</h3>
        <template v-if="canStore">
          <div class="actions">
            <button @click="saveMap()">{{ activeMap ? 'Update saved map' : 'Save to My maps' }}</button>
            <button v-if="activeMap" @click="saveMap(true)">Save as new</button>
          </div>
          <p v-if="activeMap" class="hint">
            Editing “{{ mapName(activeMap.sheet) }}”<template v-if="isDirty"> · unsaved changes</template>
          </p>
          <ul v-if="savedMaps.length" class="saved-list">
            <li v-for="m in savedMaps" :key="m.id" :class="{ active: m.id === activeMapId }">
              <button class="saved-open" :title="`Open ${mapName(m.sheet)}`" @click="openMap(m)">
                <span class="saved-name">{{ mapName(m.sheet) }}</span>
                <span class="saved-meta">{{ mapMeta(m) }}</span>
              </button>
              <button class="saved-delete" :aria-label="`Delete ${mapName(m.sheet)}`" title="Delete" @click="deleteMap(m)">×</button>
            </li>
          </ul>
          <p v-else class="hint">No saved maps yet.</p>
        </template>
        <p v-else class="hint">This browser blocks storage (e.g. private mode), so My maps is unavailable. Use links or .json files instead.</p>
      </PanelSection>

      <PanelSection id="layers" title="Layers" :summary="layersSummary">
        <div class="field">
          <span class="label">Map style</span>
          <div class="segmented">
            <button
              v-for="(def, id) in MAP_STYLES"
              :key="id"
              :class="{ active: sheet.style === id }"
              @click="sheet.style = id as MapStyleId"
            >
              {{ def.label }}
            </button>
          </div>
        </div>
        <label v-for="(on, group) in layers" :key="group" class="toggle">
          <input type="checkbox" :checked="on" @change="setLayerGroup(group, ($event.target as HTMLInputElement).checked)" />
          {{ layerLabel(group) }}
        </label>
      </PanelSection>

      <PanelSection id="cursor" title="Cursor" :summary="cursor">
        <p class="coord">{{ cursor ?? '—' }}</p>
      </PanelSection>

      <PanelSection id="read" title="Read coordinate" :summary="pickedRef">
        <div class="segmented digits">
          <button v-for="d in [4, 6, 8, 10] as Digits[]" :key="d" :class="{ active: digits === d }" @click="digits = d">
            {{ d }}
          </button>
        </div>
        <p class="coord">{{ pickedRef ?? '—' }}</p>
        <p v-if="!pickedRef" class="hint">Click the map to read a coordinate.</p>
        <div v-else class="actions copy">
          <button @click="copyPicked">{{ copied ? 'Copied' : 'Copy' }}</button>
          <button
            :disabled="!pickedOnSheet"
            :title="pickedOnSheet ? 'Print this point as the worked example' : 'The point is outside the print area'"
            @click="usePickedAsExample"
          >
            Use as grid ref example
          </button>
        </div>
        <p v-if="pickedRef && !pickedOnSheet" class="hint">Outside the print area.</p>
      </PanelSection>

      <footer>WGS 84 · UTM/MGRS</footer>
    </aside>
    <div ref="mapEl" class="map"></div>
    <SheetPreview v-if="previewOpen" :sheet="sheet" :palette="palette" @close="previewOpen = false" />
  </div>
</template>
