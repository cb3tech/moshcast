/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
      colors: {
        mosh: {
          black: '#000000',
          dark: '#121212',
          darker: '#0a0a0a',
          card: '#181818',
          hover: '#282828',
          border: '#282828',
          text: '#a1a1a1',
          muted: '#6a6a6a',
          light: '#ffffff',
          accent: '#1DB954',
          'accent-hover': '#1ed760',
        }
      }
    },
  },
  plugins: [],
}
