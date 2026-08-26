const path = require('path');

/**
 * Content globs are ABSOLUTE, derived from this file's own location.
 *
 * They used to be relative (`./apps/chat-client/src/**` plus
 * `../../libs/frontend/admin-analytics/src/**`), which quietly resolved
 * against the *process* CWD - the Nx workspace root - not against this file.
 * So the first glob happened to work and the second one pointed two levels
 * ABOVE the workspace root at a directory that doesn't exist: the
 * admin-analytics lib was never scanned, and the only Tailwind classes it ever
 * got were the ones chat-client's own source happened to use too. Everything
 * else - `grid-cols-12`, `col-span-*`, `ambient-glow-1`, every arbitrary value
 * - was silently dropped from the bundle, which is most of why the admin
 * console looked unstyled. Absolute paths can't drift with the CWD, and they
 * keep working from a git worktree.
 *
 * Forward slashes on purpose: fast-glob (Tailwind's matcher) treats a
 * backslash as an escape character, so a Windows `path.join` result would not
 * match anything.
 */
const glob = (...segments) => path.join(...segments).replace(/\\/g, '/');
const workspaceRoot = path.join(__dirname, '..', '..');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    glob(__dirname, 'src/**/*.{html,ts}'),
    // admin-analytics lib is consumed directly into this app's bundle (see
    // .agents/PROJECT_CONTEXT.md) - its classes need scanning here too,
    // since Tailwind only generates CSS for classes it can see at build time.
    glob(workspaceRoot, 'libs/frontend/admin-analytics/src/**/*.{html,ts}'),
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
        accentAmber: '#f59e0b',
        accentRose: '#f43f5e',
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
      borderRadius: {
        sm: '0.25rem', // 4px - small, compact components
        md: '0.375rem', // 6px - form inputs, small buttons
        lg: '0.5rem', // 8px - medium components
        xl: '0.75rem', // 12px - dialogs, cards
        '2xl': '1rem', // 16px - large modals, prominent surfaces
        '3xl': '1.5rem', // 24px - hero elements
        full: '9999px', // circular
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
