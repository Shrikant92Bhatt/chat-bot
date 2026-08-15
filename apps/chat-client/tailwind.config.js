/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './apps/chat-client/src/**/*.{html,ts}',
  ],
  theme: {
    extend: {
      colors: {
        abyss: '#030712',            // Deepest midnight background
        cardDark: '#0b0f19',         // Deep card surface
        glassBg: 'rgba(255, 255, 255, 0.035)',
        glassBorder: 'rgba(255, 255, 255, 0.08)',
        brandEmerald: '#10b981',     // Vibrant Emerald Green
        brandMint: '#34d399',        // Neon Mint Glow
        brandIndigo: '#6366f1',      // Electric Indigo
        brandMagenta: '#ec4899',     // Sunset Magenta
        brandAmber: '#f59e0b',       // Cyber Gold
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
        glass: '18px',
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.45)',
        emeraldGlow: '0 0 25px rgba(16, 185, 129, 0.3)',
        indigoGlow: '0 0 25px rgba(99, 102, 241, 0.3)',
        amberGlow: '0 0 25px rgba(245, 158, 11, 0.3)',
      },
    },
  },
  plugins: [],
};
