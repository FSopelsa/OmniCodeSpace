import { createRoot } from 'react-dom/client'
import '@fontsource-variable/overpass'
import '@fontsource/overpass-mono'
import './index.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
