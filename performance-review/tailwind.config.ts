import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f2f6ff',
          100: '#dce7ff',
          200: '#b8ceff',
          300: '#91b1ff',
          400: '#6d94ff',
          500: '#4a75f5',
          600: '#325bdd',
          700: '#2749b0',
          800: '#1e3a8a',
          900: '#182f6e'
        }
      }
    }
  },
  plugins: []
};

export default config;
