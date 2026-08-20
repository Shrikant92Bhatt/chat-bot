/**
 * Central prompt template registry.
 *
 * Every prompt string the backend sends to an LLM lives here, keyed by
 * `<id>:<version>` (e.g. `chat:v1`). Adding a `v2` alongside `v1` lets a
 * prompt change be rolled out (and rolled back) by flipping the key at the
 * call site instead of editing inline strings scattered across the code.
 *
 * Deliberately small: a Record of templates + `{{var}}` interpolation. No
 * templating engine, no remote prompt store — see prompt-manager.ts.
 */

export type PromptTemplateId =
  | 'system'
  | 'chat'
  | 'rag'
  | 'summarization'
  | 'memory'
  | 'memory_extraction'
  | 'tool_selection'
  | 'project'
  | 'ui_orchestrator';

export interface PromptTemplate {
  id: PromptTemplateId;
  version: string;
  /** What this template is for, and which variables it expects. */
  description: string;
  variables: string[];
  template: string;
}

/** `<id>:<version>` — the key callers pass to renderPrompt(). */
export type PromptKey = `${PromptTemplateId}:${string}`;

export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  'system:v1': {
    id: 'system',
    version: 'v1',
    description: 'Base assistant identity. Always the first block of the assembled system message.',
    variables: [],
    template:
      'You are NexusAI, an enterprise AI assistant. Answer accurately and concisely. ' +
      'Use Markdown for structure and fenced code blocks (with a language tag) for code. ' +
      'If you are unsure or lack the information to answer, say so plainly rather than guessing.',
  },

  'chat:v1': {
    id: 'chat',
    version: 'v1',
    description:
      'Wrapper that stitches the assembled context blocks into one system message. {{blocks}} is the joined set of optional sections.',
    variables: ['blocks'],
    template: '{{blocks}}',
  },

  'rag:v1': {
    id: 'rag',
    version: 'v1',
    description: 'Retrieved knowledge-base excerpts. {{context}} is the joined document text.',
    variables: ['context'],
    template:
      '## Retrieved context\n' +
      'The following excerpts were retrieved from the user\'s knowledge base and may be relevant. ' +
      'Use them when they help; ignore them when they do not, and never claim they say something they do not.\n\n' +
      '{{context}}',
  },

  'memory:v1': {
    id: 'memory',
    version: 'v1',
    description: 'Durable user-level facts/preferences recalled from long-term memory. {{memories}} is a bulleted list.',
    variables: ['memories'],
    template:
      '## What you remember about this user\n' +
      'These are durable facts and preferences saved from earlier conversations. ' +
      'Honour them silently — do not announce that you remembered something unless asked.\n\n' +
      '{{memories}}',
  },

  'memory_extraction:v1': {
    id: 'memory_extraction',
    version: 'v1',
    description:
      'Used to decide whether a user message contains a durable fact worth storing. {{message}} is the raw user message.',
    variables: ['message'],
    template:
      'Decide whether the user message below states a DURABLE fact about the user that would still ' +
      'be useful in an unrelated future conversation (their name, role, employer, location, stable ' +
      'preferences, or an explicit "remember this" instruction).\n\n' +
      'Do NOT extract: questions, task requests, one-off context, transient state, or anything about ' +
      'a topic rather than about the user.\n\n' +
      'Reply with ONLY a JSON array (possibly empty) of objects: ' +
      '[{"content": "<short third-person statement>", "kind": "identity|preference|fact|instruction"}]. ' +
      'No markdown, no prose.\n\n' +
      'User message:\n{{message}}',
  },

  'summarization:v1': {
    id: 'summarization',
    version: 'v1',
    description:
      'Rolls older conversation turns into a compact summary. {{previousSummary}} may be empty; {{transcript}} is the new older turns.',
    variables: ['previousSummary', 'transcript'],
    template:
      'You are compressing an ongoing conversation so it fits in a limited context window.\n\n' +
      'Existing summary of everything before this point (may be empty):\n{{previousSummary}}\n\n' +
      'New turns to fold into that summary:\n{{transcript}}\n\n' +
      'Write ONE updated summary that supersedes the existing one. Preserve: the user\'s goal, ' +
      'decisions made, concrete facts/values/names/file paths mentioned, and anything the assistant ' +
      'committed to. Drop pleasantries and restated text. Under 250 words, plain prose, no preamble.',
  },

  'conversation_summary:v1': {
    id: 'summarization',
    version: 'v1',
    description: 'How a stored summary is presented back to the model as context. {{summary}} is the stored summary text.',
    variables: ['summary'],
    template:
      '## Earlier in this conversation\n' +
      'The messages below the summary are the recent turns; older turns were compressed into this summary:\n\n' +
      '{{summary}}',
  },

  'project:v1': {
    id: 'project',
    version: 'v1',
    description: 'Project custom instructions. {{name}} is the project name, {{instructions}} its instructions text.',
    variables: ['name', 'instructions'],
    template:
      '## Project: {{name}}\n' +
      'This conversation belongs to the above project. Follow its instructions for the whole conversation; ' +
      'they take precedence over your general defaults but never over safety or accuracy.\n\n' +
      '{{instructions}}',
  },

  'ui_orchestrator:v1': {
    id: 'ui_orchestrator',
    version: 'v1',
    description:
      'Teaches the model the structured UI contract: approved component types and the trailing ```ui fenced-block format the backend parses.',
    variables: [],
    template:
      '## Structured UI components\n' +
      'Write your normal Markdown answer first, exactly as you always would. Only when a pre-approved ' +
      'interactive component would genuinely help THIS answer (not for decoration), end your reply with ' +
      'one fenced block, and nothing after it:\n\n' +
      '```ui\n' +
      '{"ui": [{"type": "<TYPE>", "id": "<unique-id>", "data": { ... }}], "sources": [], "actions": []}\n' +
      '```\n\n' +
      'Approved types: TEXT, MARKDOWN, TABLE, CHART, WEATHER_CARD, STOCK_CARD, STOCK_CHART, NEWS_CARD, ' +
      'MAP, PRODUCT_CARD, PRODUCT_CAROUSEL, FILE_CARD, DOCUMENT_PREVIEW, CODE_BLOCK, ERROR_CARD, ' +
      'CONFIRMATION_CARD. Never invent a different type and never emit raw HTML, JavaScript, Angular, ' +
      'or React inside `data` — the frontend owns rendering and only knows these fixed shapes.\n\n' +
      'Rules:\n' +
      '- `ui` is an array; omit the whole ```ui block when plain text/Markdown is sufficient (most replies).\n' +
      '- Every `id` must be unique within the block.\n' +
      '- `data` holds only the fields that component needs — see the fixed shapes below.\n' +
      '- Never invent data. Every field must come from a tool result, retrieved context, or something ' +
      'already established in this conversation. If you lack real data for a field, do not emit that component.\n' +
      '- If a tool call failed, use ERROR_CARD (title, message, toolName?) to report it instead of guessing.\n' +
      '- WEATHER_CARD: {location, current:{temperature, condition, humidity, windSpeed}, forecast?:[{date, ' +
      'temperatureHigh, temperatureLow, condition, precipitationProbability}]}.\n' +
      '- STOCK_CARD: {symbol, name, price, change, changePercent, currency}.\n' +
      '- STOCK_CHART: {symbol, name?, currency?, interval?, points:[{timestamp, price}]}.\n' +
      '- TABLE: {columns:[string], rows:[[string|number|null]]}.\n' +
      '- CHART: {chartType: "line"|"bar"|"pie"|"area"|"scatter", title?, xAxis:[string|number], ' +
      'series:[{name, data:[number]}]}.\n' +
      '- NEWS_CARD: {articles:[{title, source?, url?, publishedAt?, summary?, imageUrl?}]}.\n' +
      '- CODE_BLOCK: {language, code, fileName?} — only when code needs its own component separate from a ' +
      'fenced code block in the Markdown answer (e.g. a downloadable snippet).\n' +
      '- CONFIRMATION_CARD: {title, description?, confirmLabel?, cancelLabel?, actionId?} — for a ' +
      'yes/no decision the user needs to make before you proceed.',
  },

  'tool_selection:v1': {
    id: 'tool_selection',
    version: 'v1',
    description: 'Appended when MCP tools are bound, to steer when tools should be called.',
    variables: [],
    template:
      '## Tools\n' +
      'You have tools available. Call one only when it genuinely improves the answer — for live ' +
      'information, exact computation, or generating an image. Answer directly when you already know ' +
      'the answer. Never fabricate a tool result, and if a tool reports it is unavailable, say so.',
  },
};
