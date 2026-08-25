/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'space-black': '#121212',
        'space-charcoal': '#1E1E1E',
        'space-white': '#E0E0E0',
        'space-violet': '#9D00FF',
        'space-violet-dark': '#7A00C7',
        'violet-soft': '#b957ff',
        obsidian: { DEFAULT: '#0c0a11', 800: '#16121e', 700: '#1e1829', 600: '#261e34' },
        line: '#2c2440',
        ink: { DEFAULT: '#ece8f4', muted: '#9a90b0', faint: '#6b6383' },
        gold: { DEFAULT: '#F5C542', deep: '#d1a02a' },
        frame: { monster: '#E8944A', spell: '#1DA891', trap: '#C4568A', normal: '#CBB07A' },
        rarity: { common: '#8a8594', rare: '#6db4e8', super: '#e8c76d', ultra: '#f5c542', secret: '#ff5db1' },
        good: '#39d98a',
        warn: '#f5c542',
        crit: '#ff5d6c',
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
