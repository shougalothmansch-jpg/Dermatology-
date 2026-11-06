import typography from '@tailwindcss/typography';
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#effaf8', 100: '#d7f2ee', 200: '#b1e4dd', 300: '#7fcfc6', 400: '#4fb3aa',
          500: '#33978f', 600: '#277a75', 700: '#23625f', 800: '#204f4d', 900: '#1e4241', 950: '#0c2827',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [typography],
};
