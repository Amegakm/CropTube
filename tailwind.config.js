/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'luxury-black': '#0D0D0D',
        'luxury-card': '#1A1613',
        'luxury-gold': '#E5A93C',
        'luxury-bronze': '#B86C33',
        'luxury-chocolate': '#472C19',
        'luxury-cream': '#FAF9F6',
        'luxury-sand': '#A6A19A',
        'luxury-red': '#8B1E2F',
        'luxury-red-dark': '#4A121A',
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
