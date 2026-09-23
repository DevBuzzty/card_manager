/** @type {import('tailwindcss').Config} */
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
      fontFamily: {
        display: ['"Chakra Petch"', 'system-ui', 'sans-serif'],
        sans: ['"Manrope"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
