import crypto from 'crypto';
import { z } from 'zod';
import { ConnectorAdapter, ToolDefinition } from '../../connector.types';
import { COLLECTIONS } from '../../connector-store';

/**
 * Social media - drafting only (plan §8 Phase C).
 *
 * The plan defers choosing a social provider (plan §15 #5) until supported
 * networks, write permissions, pricing and app-review requirements are
 * verified, so this connector never talks to a social network. It stores
 * post drafts in NexusAI itself (tier 0, local), checks them against each
 * network's length limit, and leaves publishing/analytics for the provider
 * adapter that will slot in beside it once a provider is chosen.
 */

const NETWORK_LIMITS = {
  x: 280,
  threads: 500,
  linkedin: 3000,
  instagram: 2200,
  facebook: 63206,
  generic: 5000,
} as const;
type Network = keyof typeof NETWORK_LIMITS;

interface SocialDraft extends Record<string, unknown> {
  id: string;
  ownerUid: string;
  connectionId: string;
  network: Network;
  text: string;
  hashtags: string[];
  plannedFor?: string;
  createdAt: number;
}

const draftOut = z.object({
  id: z.string(),
  network: z.string(),
  text: z.string(),
  hashtags: z.array(z.string()),
  plannedFor: z.string().optional(),
  characters: z.number(),
  limit: z.number(),
  createdAt: z.number(),
});

const toOut = (d: SocialDraft) => ({
  id: d.id,
  network: d.network,
  text: d.text,
  hashtags: d.hashtags,
  plannedFor: d.plannedFor,
  characters: [...d.text].length,
  limit: NETWORK_LIMITS[d.network],
  createdAt: d.createdAt,
});

const createDraft: ToolDefinition = {
  name: 'social_create_post_draft',
  version: '1',
  title: 'Save a social post draft',
  description:
    'Saves a social media post draft inside NexusAI (it is NOT published anywhere). Checks the text against the ' +
    'target network\'s length limit. Use after writing the draft text for the user.',
  inputSchema: z
    .object({
      network: z.enum(Object.keys(NETWORK_LIMITS) as [Network, ...Network[]]),
      text: z.string().trim().min(1).max(10_000),
      hashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]{1,50}$/u)).max(30).optional(),
      plannedFor: z.string().datetime().optional(),
    })
    .refine((v) => [...v.text].length <= NETWORK_LIMITS[v.network], {
      message: 'Text is longer than the network allows.',
      path: ['text'],
    }),
  outputSchema: z.object({ draft: draftOut }),
  riskTier: 0,
  capability: 'write',
  requiredScopes: [],
  requiresApproval: false,
  timeoutMs: 5_000,
  maxAttempts: 1,
  idempotent: false,
  cacheTtlMs: 0,
  async run(ctx, input) {
    const draft: SocialDraft = {
      id: crypto.randomUUID(),
      ownerUid: ctx.uid,
      connectionId: ctx.connectionId,
      network: input.network,
      text: input.text,
      hashtags: (input.hashtags ?? []).map((h: string) => (h.startsWith('#') ? h : `#${h}`)),
      plannedFor: input.plannedFor,
      createdAt: Date.now(),
    };
    await ctx.store.set(COLLECTIONS.socialDrafts, draft.id, draft);
    const out = toOut(draft);
    return {
      data: { draft: out },
      display: {
        title: `Draft saved for ${draft.network} (not published)`,
        items: [{ title: draft.text, badge: `${out.characters}/${out.limit}`, meta: draft.plannedFor ? [{ label: 'Planned for', value: draft.plannedFor }] : [] }],
      },
    };
  },
};

const listDrafts: ToolDefinition = {
  name: 'social_list_drafts',
  version: '1',
  title: 'List social post drafts',
  description: 'Lists the user\'s saved social post drafts (newest first).',
  inputSchema: z.object({ network: z.enum(Object.keys(NETWORK_LIMITS) as [Network, ...Network[]]).optional() }),
  outputSchema: z.object({ drafts: z.array(draftOut) }),
  riskTier: 0,
  capability: 'read',
  requiredScopes: [],
  requiresApproval: false,
  timeoutMs: 5_000,
  maxAttempts: 1,
  idempotent: true,
  cacheTtlMs: 0,
  async run(ctx, input) {
    const rows = await ctx.store.findBy<SocialDraft>(COLLECTIONS.socialDrafts, 'ownerUid', ctx.uid);
    const drafts = rows
      .map((r) => r.data)
      .filter((d) => d.connectionId === ctx.connectionId && (!input.network || d.network === input.network))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map(toOut);
    return {
      data: { drafts },
      display: {
        title: 'Social drafts',
        emptyMessage: 'No drafts saved yet.',
        items: drafts.map((d) => ({ title: d.text, badge: d.network, meta: [{ label: 'Length', value: `${d.characters}/${d.limit}` }] })),
      },
    };
  },
};

const deleteDraft: ToolDefinition = {
  name: 'social_delete_draft',
  version: '1',
  title: 'Delete a social post draft',
  description: 'Deletes one of the user\'s saved social post drafts by id.',
  inputSchema: z.object({ draftId: z.string().uuid() }),
  outputSchema: z.object({ deleted: z.boolean() }),
  riskTier: 0,
  capability: 'write',
  requiredScopes: [],
  requiresApproval: false,
  timeoutMs: 5_000,
  maxAttempts: 1,
  idempotent: true,
  cacheTtlMs: 0,
  async run(ctx, input) {
    const deleted = await ctx.store.transact<SocialDraft, boolean>(COLLECTIONS.socialDrafts, input.draftId, (current) =>
      // Someone else's draft is indistinguishable from a missing one.
      current && current.ownerUid === ctx.uid ? { next: null, result: true } : { next: undefined, result: false }
    );
    return { data: { deleted }, display: { title: deleted ? 'Draft deleted' : 'Draft not found' } };
  },
};

export const socialConnector: ConnectorAdapter = {
  id: 'social',
  name: 'Social drafts',
  description: 'Write and keep social media post drafts with per-network length checks. Nothing is published.',
  defaultCapabilities: ['read', 'write'],
  unavailableReason: () => null,
  oauth: null,
  tools: [createDraft, listDrafts, deleteDraft],
};
