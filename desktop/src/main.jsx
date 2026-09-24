import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { startTheme } from './utils/theme'

// Spec I §6.4 -- Darstellung gilt je Geraet; die Einstellung steht lokal in der settings-Tabelle.
// localStorage spiegelt nur den zuletzt gewaehlten Wert, um das Aufblitzen von Hell beim Start zu
// vermeiden -- verbindliche Quelle bleibt die settings-Tabelle ueber window.api.getSettings().
let vorlaeufigesTheme = 'light';
try { vorlaeufigesTheme = localStorage.getItem('theme') ?? 'light'; } catch { /* z.B. privater Modus */ }
window.api?.getSettings?.().then((s) => startTheme(document, s?.theme ?? 'light')).catch(() => {});
startTheme(document, vorlaeufigesTheme);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
