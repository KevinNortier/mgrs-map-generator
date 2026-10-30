import { createApp } from 'vue'
import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import App from './App.vue'

// MapLibre 6 loads its worker as a separate module; let Vite emit it and tell MapLibre where it is.
setWorkerUrl(maplibreWorkerUrl)

createApp(App).mount('#app')
