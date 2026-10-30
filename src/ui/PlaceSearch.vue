<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { parseCoordinate, searchPlaces, type SearchResult } from '../search/places'

const props = defineProps<{
  /** Map centre, [lon, lat]: biases place results and gives the zone for short MGRS references. */
  near: () => [number, number]
}>()
const emit = defineEmits<{ select: [result: SearchResult] }>()

const DEBOUNCE_MS = 300
const MIN_CHARS = 3

const query = ref('')
const results = ref<SearchResult[]>([])
const active = ref(-1)
const open = ref(false)
const status = ref<'idle' | 'searching' | 'error'>('idle')
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined

watch(query, (q) => {
  clearTimeout(timer)
  controller?.abort()
  const coordinate = parseCoordinate(q, props.near())
  results.value = coordinate ? [coordinate] : []
  active.value = coordinate ? 0 : -1
  open.value = q.trim().length > 0
  status.value = 'idle'
  // A typed coordinate is a complete answer; don't also send it to the geocoder.
  if (coordinate || q.trim().length < MIN_CHARS) return
  status.value = 'searching'
  timer = setTimeout(() => runSearch(q.trim()), DEBOUNCE_MS)
})

async function runSearch(q: string) {
  controller = new AbortController()
  try {
    results.value = await searchPlaces(q, props.near(), controller.signal)
    active.value = results.value.length ? 0 : -1
    status.value = 'idle'
  } catch (e) {
    if ((e as Error).name !== 'AbortError') status.value = 'error'
  }
}

function choose(r: SearchResult | undefined) {
  if (!r) return
  emit('select', r)
  open.value = false
}

function onKey(e: KeyboardEvent) {
  const n = results.value.length
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    open.value = true
    active.value = (active.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    active.value = (active.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    choose(results.value[Math.max(active.value, 0)])
  } else if (e.key === 'Escape') {
    if (open.value) open.value = false
    else query.value = ''
  }
}

onBeforeUnmount(() => {
  clearTimeout(timer)
  controller?.abort()
})
</script>

<template>
  <div class="place-search" @focusout="(e) => !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node) && (open = false)">
    <input
      v-model="query"
      type="search"
      placeholder="Search place or MGRS / lat, lon"
      aria-label="Search for a place or coordinate"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open"
      aria-controls="place-search-results"
      autocomplete="off"
      spellcheck="false"
      @focus="open = query.trim().length > 0"
      @keydown="onKey"
    />
    <ul v-if="open" id="place-search-results" class="place-search-results" role="listbox">
      <li
        v-for="(r, i) in results"
        :key="i"
        role="option"
        tabindex="-1"
        :aria-selected="i === active"
        :class="{ active: i === active, coordinate: r.kind === 'coordinate' }"
        @mousedown.prevent="choose(r)"
        @mouseenter="active = i"
      >
        <span class="name">{{ r.label }}</span>
        <span class="detail">{{ r.detail }}</span>
      </li>
      <li v-if="!results.length" class="empty">
        <template v-if="status === 'searching'">Searching…</template>
        <template v-else-if="status === 'error'">Search is unavailable right now.</template>
        <template v-else-if="query.trim().length < MIN_CHARS">Keep typing…</template>
        <template v-else>No places found.</template>
      </li>
    </ul>
  </div>
</template>
