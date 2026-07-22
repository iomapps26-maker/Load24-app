/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.jsx', './screens/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#f97316',
          dark: '#1e3a8a'
        },
        navy: {
          DEFAULT: '#0f1c30',
          card: '#152238'
        }
      }
    }
  },
  plugins: []
};
