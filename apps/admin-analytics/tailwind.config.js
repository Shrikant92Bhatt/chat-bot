/**
 * Mirrors apps/chat-client/tailwind.config.js so the admin console reads as
 * the same product (obsidian ground, frosted-glass panels, the same three
 * accents) rather than a bolted-on admin panel.
 *
 * Deliberately a copy rather than a shared config import: Angular's builder
 * auto-discovers `tailwind.config.js` at the PROJECT root, and the two apps
 * need different `content` globs anyway. The extra palette entries below
 * (chartSeries*) exist only here - the chat client has no charts.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./apps/admin-analytics/src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        obsidian: '#0a0d14',
        slateBg: '#0f172a',
        glassBg: 'rgba(255, 255, 255, 0.04)',
        glassBorder: 'rgba(255, 255, 255, 0.08)',
        accentCyan: '#06b6d4',
        accentViolet: '#8b5cf6',
        accentEmerald: '#10b981',
        accentAmber: '#f59e0b',
        accentRose: '#f43f5e',
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          'Inter',
          'sans-serif',
          'Apple Color Emoji',
          'Segoe UI Emoji',
          'Segoe UI Symbol',
          'Noto Color Emoji',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      backdropBlur: {
        xs: '2px',
        glass: '16px',
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        glow: '0 0 20px rgba(139, 92, 246, 0.25)',
        cyanGlow: '0 0 20px rgba(6, 182, 212, 0.25)',
      },
    },
  },
  plugins: [],
};
