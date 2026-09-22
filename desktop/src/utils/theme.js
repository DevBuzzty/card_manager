// Spec I §6 -- Farbrollen. Die Werte stehen in docs/fixtures/design/tokens.json; hier steht nur
// die Logik, die beide Geraete teilen (Modus aufloesen, Kontrast rechnen).
export const ROLES = ['bg', 'surface', 'surface-2', 'line', 'text', 'text-muted', 'accent', 'accent-fg', 'good', 'warn', 'bad'];

// 'light' | 'dark' | 'system' -> tatsaechlicher Modus. Alles Unbekannte faellt auf hell zurueck.
export function resolveMode(setting, prefersDark) {
  if (setting === 'dark') return 'dark';
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return 'light';
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`Kein Farbwert: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// WCAG-Kontrastverhaeltnis, 1 bis 21.
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Setzt data-theme am <html>. Der Renderer liest die Einstellung aus der settings-Tabelle.
export function applyTheme(doc, setting, prefersDark) {
  const mode = resolveMode(setting, prefersDark);
  doc.documentElement.dataset.theme = mode;
  return mode;
}

// Wendet die Einstellung an und folgt dem System, solange 'system' gewaehlt ist.
export function startTheme(doc, setting) {
  const mq = typeof doc.defaultView?.matchMedia === 'function'
    ? doc.defaultView.matchMedia('(prefers-color-scheme: dark)') : null;
  applyTheme(doc, setting, !!mq?.matches);
  if (!mq || setting !== 'system') return () => {};
  const on = () => applyTheme(doc, setting, mq.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}
