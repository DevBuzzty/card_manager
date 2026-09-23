/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        line: 'var(--line)',
        text: 'var(--text)',
        muted: 'var(--text-muted)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
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
