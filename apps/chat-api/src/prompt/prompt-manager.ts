import { PROMPT_TEMPLATES, PromptTemplate } from './templates';

/**
 * Prompt Manager — the single place that turns the assembled context
 * (project instructions, long-term memories, RAG excerpts, conversation
 * summary) into the system message the orchestrator sends to the LLM.
 *
 * Everything that used to be an inline prompt string in orchestration/
 * nodes.ts, rag/retriever.ts and the services layer is rendered from the
 * versioned registry in templates.ts instead.
 */

export function getTemplate(key: string): PromptTemplate {
  const template = PROMPT_TEMPLATES[key];
  if (!template) {
    throw new Error(`[PromptManager] Unknown prompt template "${key}".`);
  }
  return template;
}

/** Renders `{{var}}` placeholders. A missing variable renders as an empty string. */
export function renderPrompt(key: string, variables: Record<string, string | undefined> = {}): string {
  const { template } = getTemplate(key);
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => variables[name] ?? '');
}

/** Lists the registry, for diagnostics/settings UIs. */
export function listPromptTemplates(): Array<{ key: string; id: string; version: string; description: string }> {
  return Object.entries(PROMPT_TEMPLATES).map(([key, t]) => ({
    key,
    id: t.id,
    version: t.version,
    description: t.description,
  }));
}

/** Rough token estimate (~4 chars/token) — good enough for budget decisions. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Everything the context-assembly step gathers before the LLM call.
 * Produced by context/context-builder.ts, consumed here.
 */
export interface AssembledContext {
  /** From the verified Google session - the one piece of "who is this" that's true for every turn, not just what got said/written. */
  accountName?: string | null;
  accountEmail?: string | null;
  projectName?: string | null;
  projectInstructions?: string | null;
  /** Durable user-level facts from long-term memory. */
  memories?: string[];
  /** RAG excerpts (user knowledge base + project files). */
  ragContext?: string[];
  /** Rolling summary of the conversation turns that were dropped from the window. */
  conversationSummary?: string | null;
  /**
   * Evidence gathered by the research node for THIS turn, pre-formatted by
   * orchestration/research.ts. The most volatile block there is - it is
   * true as of a few seconds ago and has no bearing on any later turn.
   */
  researchFindings?: string | null;
  /**
   * Set when this turn's question is about markets/instruments, so a
   * researched answer gets the finance structure and its disclaimer. Only
   * meaningful alongside researchFindings.
   */
  financeQuestion?: boolean;
}

export const EMPTY_CONTEXT: AssembledContext = {};

/**
 * Builds the single system message for a turn.
 *
 * Block order is deliberate — most durable/authoritative first, most
 * volatile last, so later blocks read as "for this turn" rather than as
 * standing instructions:
 *   system identity -> UI response contract -> tool policy -> account
 *   identity -> project instructions -> memories -> RAG excerpts ->
 *   conversation summary -> this turn's research findings.
 *
 * Returns null when there is nothing at all to say (never happens today,
 * since system:v1 is unconditional, but keeps callers honest).
 */
export function buildSystemPrompt(context: AssembledContext, options: { mcpEnabled?: boolean } = {}): string | null {
  const blocks: string[] = [renderPrompt('system:v1'), renderPrompt('ui_orchestrator:v2')];

  if (options.mcpEnabled) {
    blocks.push(renderPrompt('tool_selection:v2'));
  }

  // Anonymous users have neither field - nothing to say here, memories/
  // the explicit "About you" profile (also injected below, via
  // context.memories) are the only things this app can ever know about them.
  if (context.accountName && context.accountName.trim()) {
    const email = context.accountEmail?.trim();
    blocks.push(
      renderPrompt('account_identity:v1', {
        name: context.accountName.trim(),
        emailNote: email ? ` (${email})` : '',
      })
    );
  }

  if (context.projectInstructions && context.projectInstructions.trim()) {
    blocks.push(
      renderPrompt('project:v1', {
        name: context.projectName || 'Untitled project',
        instructions: context.projectInstructions.trim(),
      })
    );
  }

  if (context.memories && context.memories.length > 0) {
    blocks.push(
      renderPrompt('memory:v1', {
        memories: context.memories.map((m) => `- ${m}`).join('\n'),
      })
    );
  }

  if (context.ragContext && context.ragContext.length > 0) {
    blocks.push(renderPrompt('rag:v1', { context: context.ragContext.join('\n\n---\n\n') }));
  }

  if (context.conversationSummary && context.conversationSummary.trim()) {
    blocks.push(renderPrompt('conversation_summary:v1', { summary: context.conversationSummary.trim() }));
  }

  // Last, deliberately: this is the only block that was true seconds ago
  // rather than for the whole conversation, and it should read as evidence
  // for this answer rather than as a standing instruction.
  if (context.researchFindings && context.researchFindings.trim()) {
    blocks.push(renderPrompt('research_findings:v1', { findings: context.researchFindings.trim() }));
    // Only alongside real findings: the structure below asks for levels and
    // drivers, which without evidence would invite exactly the invention
    // the findings block spends its length forbidding.
    if (context.financeQuestion) {
      blocks.push(renderPrompt('finance_answer:v1'));
    }
  }

  const joined = blocks.filter(Boolean).join('\n\n');
  if (!joined.trim()) return null;

  return renderPrompt('chat:v1', { blocks: joined });
}
