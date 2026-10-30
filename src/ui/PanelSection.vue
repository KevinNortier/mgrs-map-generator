<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** Key for remembering the open state in this browser. */
    id: string
    title: string
    defaultOpen?: boolean
    /** Short status shown next to the title while collapsed. */
    summary?: string | null
  }>(),
  { defaultOpen: true, summary: null },
)

// Open/closed is a per-browser convenience; storage can be unavailable (private mode, blocked site data).
const storageKey = `panel-section:${props.id}`

function loadOpen() {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored === null ? props.defaultOpen : stored === '1'
  } catch {
    return props.defaultOpen
  }
}

const open = ref(loadOpen())

function onToggle(e: Event) {
  open.value = (e.target as HTMLDetailsElement).open
  try {
    localStorage.setItem(storageKey, open.value ? '1' : '0')
  } catch {
    // ignore
  }
}
</script>

<template>
  <details class="panel-section" :open="open" @toggle="onToggle">
    <summary>
      <h2>{{ title }}</h2>
      <span v-if="!open && summary" class="panel-section-summary">{{ summary }}</span>
    </summary>
    <div class="panel-section-body">
      <slot />
    </div>
  </details>
</template>
