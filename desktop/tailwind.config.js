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
      },
    },
  },
  plugins: [],
}
