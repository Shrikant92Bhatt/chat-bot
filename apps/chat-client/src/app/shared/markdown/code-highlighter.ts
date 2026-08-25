import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import diff from 'highlight.js/lib/languages/diff';
import graphql from 'highlight.js/lib/languages/graphql';
import plaintext from 'highlight.js/lib/languages/plaintext';

/**
 * `highlight.js/lib/core` ships with zero languages registered - every
 * grammar is its own module, imported and registered explicitly above, so
 * the bundle only pays for the languages this app actually offers (a
 * chat-assistant's realistic range, not the ~190-language "all languages"
 * bundle the plain `highlight.js` package would pull in).
 */
const LANGUAGES: Record<string, unknown> = {
  javascript,
  typescript,
  python,
  bash,
  json,
  xml,
  css,
  scss,
  yaml,
  markdown,
  sql,
  java,
  csharp,
  cpp,
  c,
  go,
  rust,
  php,
  ruby,
  kotlin,
  swift,
  dockerfile,
  ini,
  diff,
  graphql,
  plaintext,
};

/**
 * Alias -> canonical registration key. Drives both `hljs.registerAliases()`
 * (so `hljs.highlight()` accepts these directly) and this module's own
 * `resolveLanguageKey()` below - `hljs.getLanguage(alias)` returns the
 * grammar's `Language` object, but that object doesn't expose the
 * canonical key it was registered under, only its human-readable `name`
 * (e.g. `"TypeScript"`) and its OWN alias list. Resolving through this map
 * ourselves, rather than trying to reverse-engineer the canonical key out
 * of what hljs returns, keeps `languageKey` (used for the `language-*` CSS
 * class and the `DISPLAY_NAMES` lookup below) always equal to one of the
 * keys `LANGUAGES` was registered under.
 */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  py3: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  shellscript: 'bash',
  html: 'xml',
  svg: 'xml',
  xhtml: 'xml',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  kt: 'kotlin',
  kts: 'kotlin',
  docker: 'dockerfile',
  toml: 'ini',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
};

/** Registration is idempotent-guarded so importing this module from
 * multiple entry points (chat-window, markdown-block, code-block) is safe. */
let registered = false;

function ensureLanguagesRegistered(): void {
  if (registered) return;
  registered = true;

  for (const [name, definition] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, definition as Parameters<typeof hljs.registerLanguage>[1]);
  }

  const aliasesByLanguage = new Map<string, string[]>();
  for (const [alias, languageName] of Object.entries(ALIASES)) {
    const list = aliasesByLanguage.get(languageName) ?? [];
    list.push(alias);
    aliasesByLanguage.set(languageName, list);
  }
  for (const [languageName, aliases] of aliasesByLanguage) {
    hljs.registerAliases(aliases, { languageName });
  }
}

/** Resolves a fence-language string (canonical name or alias, any case) to its canonical registration key. */
function resolveLanguageKey(requestedLanguage: string): string | null {
  if (LANGUAGES[requestedLanguage]) return requestedLanguage;
  return ALIASES[requestedLanguage] ?? null;
}

/** Friendlier display names for the header label than the raw grammar key. */
const DISPLAY_NAMES: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  bash: 'Bash',
  json: 'JSON',
  xml: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  yaml: 'YAML',
  markdown: 'Markdown',
  sql: 'SQL',
  java: 'Java',
  csharp: 'C#',
  cpp: 'C++',
  c: 'C',
  go: 'Go',
  rust: 'Rust',
  php: 'PHP',
  ruby: 'Ruby',
  kotlin: 'Kotlin',
  swift: 'Swift',
  dockerfile: 'Dockerfile',
  ini: 'INI',
  diff: 'Diff',
  graphql: 'GraphQL',
  plaintext: 'Plain text',
};

export interface HighlightedCode {
  /** The canonical grammar key hljs highlighted with (after alias resolution), or null if unrecognized. */
  languageKey: string | null;
  /** Human-readable label for the code block header. */
  languageLabel: string;
  /** One highlighted (already HTML-escaped by hljs) HTML fragment per physical line of the source. */
  lines: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Highlights `code` for the given fence language (if recognized), one
 * physical line at a time.
 *
 * Highlighting per-line (rather than highlighting the whole block once and
 * then splitting the resulting HTML on newlines) is what makes the CSS
 * line-numbering gutter possible: each line becomes its own block-level
 * element so `counter-increment` fires once per line, and each is
 * independently safe to reflow if line-wrap is toggled on. The trade-off is
 * that a token spanning multiple physical lines (an unterminated block
 * comment, a multi-line template literal) is colored per-line instead of as
 * one continuous span - a cosmetic imperfection, not a correctness one:
 * `hljs.highlight()` always HTML-escapes its input regardless of whether it
 * recognizes the language, so this never affects what gets copied (the
 * Copy button reads the untouched original text out of the snippet store,
 * never this rendered markup).
 */
export function highlightCode(code: string, requestedLanguage?: string): HighlightedCode {
  ensureLanguagesRegistered();

  const normalized = requestedLanguage?.trim().toLowerCase();
  const languageKey = normalized ? resolveLanguageKey(normalized) : null;
  const languageLabel = languageKey
    ? DISPLAY_NAMES[languageKey] ?? languageKey
    : normalized || DISPLAY_NAMES['plaintext'];

  const sourceLines = code.split('\n');
  const lines = languageKey
    ? sourceLines.map((line) => hljs.highlight(line, { language: languageKey, ignoreIllegals: true }).value)
    : sourceLines.map((line) => escapeHtml(line));

  return { languageKey, languageLabel, lines };
}
