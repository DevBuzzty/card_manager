/** @type {import('tailwindcss').Config} */
// Spec I §6.3: Systemschrift -- keine eingebundenen Webfonts mehr.
const SYSTEM = ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'];

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // color-mix statt reinem var(...): Tailwind 3.4 kann den <alpha-value>-Platzhalter
        // (fuer bg-accent/15, hover:bg-accent/90 usw.) nur in eine Funktion einsetzen, nicht in
        // ein rohes var() -- sonst fehlt die Utility im gebauten CSS komplett (Fixrunde 1, Punkt 1).
        // Die Hex-Werte selbst bleiben unveraendert in index.css.
        bg: 'color-mix(in srgb, var(--bg) calc(<alpha-value> * 100%), transparent)',
        surface: 'color-mix(in srgb, var(--surface) calc(<alpha-value> * 100%), transparent)',
        'surface-2': 'color-mix(in srgb, var(--surface-2) calc(<alpha-value> * 100%), transparent)',
        line: 'color-mix(in srgb, var(--line) calc(<alpha-value> * 100%), transparent)',
        text: 'color-mix(in srgb, var(--text) calc(<alpha-value> * 100%), transparent)',
        muted: 'color-mix(in srgb, var(--text-muted) calc(<alpha-value> * 100%), transparent)',
        accent: 'color-mix(in srgb, var(--accent) calc(<alpha-value> * 100%), transparent)',
        'accent-fg': 'color-mix(in srgb, var(--accent-fg) calc(<alpha-value> * 100%), transparent)',
        good: 'color-mix(in srgb, var(--good) calc(<alpha-value> * 100%), transparent)',
        warn: 'color-mix(in srgb, var(--warn) calc(<alpha-value> * 100%), transparent)',
        bad: 'color-mix(in srgb, var(--bad) calc(<alpha-value> * 100%), transparent)',
        // Spielfarben (Kartenrahmen Monster/Zauber/Falle) -- keine Oberflaechenfarbe, bleibt.
        frame: { monster: '#E8944A', spell: '#1DA891', trap: '#C4568A', normal: '#CBB07A' },
      },
      // Spec I §6.3 -- eine Schriftfamilie (Systemschrift) fuer alles; font-display/font-mono bleiben als Namen
      // stehen, loesen aber auf dieselbe Familie auf. Ziffern gleich breit ueber tabular-nums (index.css).
      fontFamily: {
        display: SYSTEM,
        sans: SYSTEM,
        mono: SYSTEM,
      },
      // Spec I §6.3 -- vier Groessen (docs/fixtures/design/tokens.json#typo): Ueberschrift 22, Abschnitt 17,
      // Zeile 15, Nebensache 13/12. Die Tailwind-Stufen werden darauf abgebildet, damit die Regel an EINER
      // Stelle gilt; `text-klein` ersetzt frei gesetzte Pixelgroessen.
      fontSize: {
        klein: ['12px', { lineHeight: '1.5' }],
        xs: ['13px', { lineHeight: '1.5' }],
        sm: ['15px', { lineHeight: '1.5' }],
        base: ['15px', { lineHeight: '1.5' }],
        lg: ['17px', { lineHeight: '1.5' }],
        xl: ['22px', { lineHeight: '1.3' }],
        '2xl': ['22px', { lineHeight: '1.3' }],
        '3xl': ['22px', { lineHeight: '1.3' }],
        '4xl': ['22px', { lineHeight: '1.3' }],
        '5xl': ['22px', { lineHeight: '1.3' }],
      },
      // Spec I §6.3 -- Ecken 10 fuer Flaechen, 6 fuer Felder und Knoepfe, rund (full) nur fuer Marken.
      borderRadius: {
        DEFAULT: '6px', sm: '6px', md: '6px', lg: '6px',
        xl: '10px', '2xl': '10px', '3xl': '10px',
        feld: '6px', flaeche: '10px',
      },
    },
  },
  plugins: [],
}
