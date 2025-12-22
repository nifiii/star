/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Comic Sans MS"', '"Chalkboard SE"', 'sans-serif'],
      },
      colors: {
        kid: {
          bg: '#EFF6FF', // Light blue background
          card: '#FFFFFF',
          primary: '#4F46E5', // Indigo
          secondary: '#F59E0B', // Amber
          accent: '#EC4899', // Pink
          success: '#10B981', // Emerald
          text: '#1E293B', // Slate 800
          blue: '#60A5FA',
          yellow: '#FEF08A',
          orange: '#FB923C',
          green: '#86EFAC',
          purple: '#A78BFA'
        }
      },
      borderRadius: {
        '3xl': '1.5rem',
        '4xl': '2rem',
      }
    }
  },
  plugins: [],
}