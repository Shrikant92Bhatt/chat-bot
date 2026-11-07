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
      // "Graphite & Ember" theme: warm graphite neutrals with a single ember
      // accent. The stock scales below are overridden on purpose so the
      // existing `slate-*` / `cyan-*` / `emerald-*` classes across every
      // template pick the theme up without touching each one. The accent*
      // names are kept for the same reason - accentCyan is now the ember
      // accent, not cyan.
      colors: {
        obsidian: '#12110f',
        abyss: '#12110f',
        slateBg: '#181613',
        glassBg: 'rgba(255, 245, 230, 0.035)',
        glassBorder: 'rgba(255, 245, 230, 0.08)',
        accentCyan: '#e2733a',
        accentViolet: '#c9a26b',
        accentEmerald: '#86a97f',
        accentAmber: '#d9a441',
        accentRose: '#d6584f',
        brandEmerald: '#e2733a',
        slate: {
          50: '#f7f4ef',
          100: '#ede7dd',
          200: '#ddd5c8',
          300: '#c9c1b4',
          400: '#a0978a',
          500: '#7d7569',
          600: '#5e574d',
          700: '#443f37',
          800: '#2c2823',
          900: '#1d1a16',
          950: '#12110f',
        },
        cyan: {
          50: '#fdf3ec',
          100: '#fbe2d1',
          200: '#f6c4a3',
          300: '#f1a273',
          400: '#ec8a52',
          500: '#e2733a',
          600: '#c85d27',
          700: '#a4491f',
          800: '#823b1c',
          900: '#6a321a',
          950: '#3a180b',
        },
        violet: {
          50: '#faf6ef',
          100: '#f2e8d6',
          200: '#e6d3b1',
          300: '#d9bc8c',
          400: '#cfaa77',
          500: '#c9a26b',
          600: '#a9824f',
          700: '#876640',
          800: '#6a5135',
          900: '#56432e',
          950: '#2e2317',
        },
        emerald: {
          50: '#f3f7f2',
          100: '#e1ebdf',
          200: '#c4d7c0',
          300: '#a5c09f',
          400: '#93b28c',
          500: '#86a97f',
          600: '#6b8b65',
          700: '#566f51',
          800: '#465a43',
          900: '#3a4a38',
          950: '#1e281d',
        },
      },
      fontSize: {
        xs: '0.75rem', // 12px - labels, badges, small UI
        sm: '0.875rem', // 14px - body text alternative
        base: '1rem', // 16px - body text default
        lg: '1.125rem', // 18px - slightly larger text
        xl: '1.25rem', // 20px - headlines
        '2xl': '1.5rem', // 24px - prominent headlines
        '3xl': '1.875rem', // 30px - hero text
        '4xl': '2.25rem', // 36px - large hero text
        // Microscopic sizes for dense UI elements (annotations, badges, labels)
        xs3: '9px', // very compact annotations
        xs2: '10px', // compact annotations
        xs15: '11px', // small annotations, metadata labels
      },
      fontFamily: {
        // Plus Jakarta Sans/Inter/sans-serif have no emoji glyphs, so without
        // an explicit color-emoji fallback the browser picks whatever emoji
        // font it lands on inconsistently - some render full-color, others
        // fall back to a small monochrome glyph. This is the standard emoji
        // font stack (same one GitHub/Slack/etc. use) so it's consistent
        // everywhere across platforms.
        sans: [
          'IBM Plex Sans',
          'system-ui',
          'sans-serif',
          'Apple Color Emoji',
          'Segoe UI Emoji',
          'Segoe UI Symbol',
          'Noto Color Emoji',
        ],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
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
        glow: '0 1px 0 rgba(255, 245, 230, 0.06)',
        cyanGlow: '0 1px 0 rgba(255, 245, 230, 0.06)',
      },
    },
  },
  plugins: [],
};
