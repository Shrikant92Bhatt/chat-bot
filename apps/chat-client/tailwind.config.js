/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './apps/chat-client/src/**/*.{html,ts}',
  ],
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
      },
      fontFamily: {
        // Plus Jakarta Sans/Inter/sans-serif have no emoji glyphs, so without
        // an explicit color-emoji fallback the browser picks whatever emoji
        // font it lands on inconsistently - some render full-color, others
        // fall back to a small monochrome glyph. This is the standard emoji
        // font stack (same one GitHub/Slack/etc. use) so it's consistent
        // everywhere across platforms.
        sans: [
          'Plus Jakarta Sans',
          'Inter',
          'sans-serif',
          'Apple Color Emoji',
          'Segoe UI Emoji',
          'Segoe UI Symbol',
          'Noto Color Emoji',
        ],
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
