import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'deep': '#0a0a0b',
        'surface': '#111113',
        'elevated': '#1a1a1d',
        'cyan': '#00ffd0',
        'cyan-dim': 'rgba(0, 255, 208, 0.2)',
        'cyan-glow': 'rgba(0, 255, 208, 0.4)',
        'red-alert': '#ff3b5c',
        'primary': '#e8e8e8',
        'secondary': '#888888',
        'dim': '#555555',
        'border': '#2a2a2d',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Outfit', 'sans-serif'],
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s ease both',
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
export default config
