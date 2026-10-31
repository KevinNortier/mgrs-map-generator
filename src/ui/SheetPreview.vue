<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { mapDataDate } from '../map/data-date'
import type { Palette } from '../map/style'
import { renderMapImage } from '../print/render-map'
import { download, exportFileName, exportPdf, exportPng } from '../print/export'
import { renderSheetSvg } from '../print/sheet-svg'
import type { Sheet } from '../print/sheet'

const props = defineProps<{ sheet: Sheet; palette: Palette }>()
const emit = defineEmits<{ close: [] }>()

/** Screen preview resolution; print export renders at a higher DPI. */
const PREVIEW_DPI = 150

// Snapshot so edits made while the preview is open don't mix into this render.
const sheet: Sheet = JSON.parse(JSON.stringify(props.sheet))
const svg = ref(renderSheetSvg({ sheet, palette: props.palette }))
const status = ref<'rendering' | 'done' | 'error'>('rendering')
const error = ref('')
let closed = false

const exporting = ref<string | null>(null)
const exportError = ref('')

async function runExport(kind: 'pdf' | 'png') {
  if (exporting.value) return
  exportError.value = ''
  exporting.value = 'Starting…'
  try {
    const onProgress = (msg: string) => (exporting.value = msg)
    const blob = kind === 'pdf' ? await exportPdf(sheet, props.palette, onProgress) : await exportPng(sheet, props.palette, onProgress)
    if (!closed) download(blob, exportFileName(sheet, kind))
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    exporting.value = null
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    const [mapImage, dataDate] = await Promise.all([renderMapImage(sheet, props.palette, { dpi: PREVIEW_DPI }), mapDataDate()])
    if (closed) return
    svg.value = renderSheetSvg({ sheet, palette: props.palette, mapImage, dataDate })
    status.value = 'done'
  } catch (e) {
    status.value = 'error'
    error.value = e instanceof Error ? e.message : String(e)
  }
})

onBeforeUnmount(() => {
  closed = true
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="preview-backdrop" @click.self="emit('close')">
    <div class="preview-dialog" role="dialog" aria-label="Sheet preview">
      <header>
        <strong>Sheet preview</strong>
        <span class="status">
          <template v-if="exporting">{{ exporting }}</template>
          <template v-else-if="exportError">Export failed: {{ exportError }}</template>
          <template v-else-if="status === 'rendering'">Rendering map…</template>
          <template v-else-if="status === 'error'">Map render failed: {{ error }}</template>
          <template v-else>Print at 100% / "Actual size" for exact scale.</template>
        </span>
        <button class="primary" :disabled="!!exporting" @click="runExport('pdf')">Download PDF</button>
        <button :disabled="!!exporting" @click="runExport('png')">Download PNG</button>
        <button @click="emit('close')">Close</button>
      </header>
      <div class="preview-page" :class="sheet.orientation" v-html="svg"></div>
    </div>
  </div>
</template>

<style scoped>
.preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 20, 20, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 10;
}

.preview-dialog {
  background: var(--bg);
  border-radius: 6px;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.status {
  flex: 1;
  color: var(--muted);
  font-size: 13px;
}

.preview-page {
  overflow: auto;
  padding: 16px;
}

.preview-page :deep(svg) {
  display: block;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  height: calc(100vh - 32px - 49px - 32px);
  width: auto;
  max-width: calc(100vw - 64px);
}
</style>
