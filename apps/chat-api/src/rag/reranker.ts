import type { VectorQueryResult } from './vector-db';
import { createOmniRouteChatModel, isOmniRouteConfigured } from '../llm/client';

/**
 * Reranking stage that sits between the initial cosine-similarity vector
 * search and the final top-K selection, per the RAG flow documented in
 * .agents/PROJECT_CONTEXT.md: Vector Search -> Fusion -> Reranker -> Top K
 * Chunks.
 *
 * Why hybrid lexical fusion instead of a second embeddings pass:
 * vector-db.ts's embedding is a dependency-free hashing bag-of-words
 * embedding, not a real semantic model - re-embedding and comparing again
 * would just reproduce (with hash noise) the same cosine ranking the first
 * pass already computed, adding cost without adding signal. Independent
 * signal instead comes from a classic lexical scorer (BM25) computed over
 * the small candidate pool, then fused with the vector ranking via
 * Reciprocal Rank Fusion (RRF).
 *
 * RRF combines two rankings by rank position rather than raw score, which
 * matters here because cosine similarity (0..1, dense) and BM25 (unbounded,
 * sparse/bursty) live on incomparable scales - fusing raw scores would
 * require hand-tuned normalization that's liable to misbehave as the
 * corpus/query mix changes. RRF sidesteps that: it only needs each
 * document's position in each ranking.
 *
 * Cost/latency: O(candidates * queryTerms), entirely in-process, no I/O.
 * For the candidate pool sizes this in-memory store deals with (single
 * user's uploaded docs, typically low tens of chunks), this runs in well
 * under a millisecond - negligible against the project's <300ms RAG
 * retrieval budget.
 */

const RRF_K = 60; // standard damping constant used in published RRF work (Cormack et al.)
const BM25_K1 = 1.5;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) || [];
}

// Common English function words. BM25's IDF is normally computed over a
// large corpus, where "what"/"is"/"the" naturally end up with near-zero
// weight because they appear in nearly every document. Here IDF is only
// computed over the small in-request candidate pool (a handful of chunks),
// which is too small a sample for that to happen reliably - a filler-heavy
// candidate can still look distinctive purely by chance. Stripping stopwords
// from the *query* terms before scoring (a standard step in lexical search)
// sidesteps that: only content-bearing query words drive the lexical signal.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'about',
  'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out',
  'and', 'or', 'but', 'if', 'so', 'than', 'too', 'very',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'best', 'good',
]);

function contentTerms(tokens: string[]): string[] {
  const filtered = tokens.filter((t) => !STOPWORDS.has(t));
  return filtered.length > 0 ? filtered : tokens; // don't zero out an all-stopword query
}

/**
 * BM25 ranking of `candidates` against `query`. Document frequency / average
 * length are computed over the candidate pool itself (there's no standing
 * inverted index) - fine here because we only need a *relative* ordering of
 * this already-small candidate set, not a globally comparable BM25 score.
 */
function bm25Rank(query: string, candidates: VectorQueryResult[]): VectorQueryResult[] {
  const queryTerms = contentTerms(tokenize(query));
  if (queryTerms.length === 0 || candidates.length === 0) {
    return [...candidates];
  }

  const docTokens = candidates.map((c) => tokenize(c.content));
  const avgDocLen = docTokens.reduce((sum, t) => sum + t.length, 0) / docTokens.length || 1;
  const docCount = candidates.length;

  const documentFrequency = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    const count = docTokens.filter((tokens) => tokens.includes(term)).length;
    documentFrequency.set(term, count);
  }

  const scored = candidates.map((candidate, idx) => {
    const tokens = docTokens[idx];
    const docLen = tokens.length || 1;
    let score = 0;
    for (const term of queryTerms) {
      const freq = tokens.filter((t) => t === term).length;
      if (freq === 0) continue;
      const df = documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
      score += idf * ((freq * (BM25_K1 + 1)) / (freq + BM25_K1 * (1 - BM25_B + (BM25_B * docLen) / avgDocLen)));
    }
    return { candidate, score };
  });

  return scored.sort((a, b) => b.score - a.score).map((s) => s.candidate);
}

/** Reciprocal Rank Fusion over any number of same-candidate-set rankings. */
function reciprocalRankFusion(candidates: VectorQueryResult[], rankings: VectorQueryResult[][]): VectorQueryResult[] {
  const rrfScore = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((doc, rank) => {
      rrfScore.set(doc.id, (rrfScore.get(doc.id) || 0) + 1 / (RRF_K + rank + 1));
    });
  }
  return [...candidates].sort((a, b) => (rrfScore.get(b.id) || 0) - (rrfScore.get(a.id) || 0));
}

/**
 * Default reranking path (always on): fuses the vector-similarity ranking
 * (candidates are assumed pre-sorted by cosine score, as returned by
 * VectorDbAdapter.similaritySearch) with a BM25 lexical ranking via RRF, and
 * returns the fused ordering truncated to `topK`.
 */
export function hybridRerank(query: string, candidates: VectorQueryResult[], topK: number): VectorQueryResult[] {
  if (candidates.length <= 1) {
    return candidates.slice(0, topK);
  }
  const vectorRanking = candidates; // already sorted by cosine score
  const lexicalRanking = bm25Rank(query, candidates);
  return reciprocalRankFusion(candidates, [vectorRanking, lexicalRanking]).slice(0, topK);
}

/**
 * Optional LLM-based reranker, for callers that explicitly opt in on
 * higher-value queries. NOT part of the default retrieval path -
 * hybridRerank() above always runs; this is an additional, explicitly-
 * flagged step a caller may layer on top when the extra network round trip
 * and latency are acceptable (a single non-streaming LLM call, easily
 * 500ms-2s+ depending on the gateway/model - well over the <300ms budget
 * for the default path, which is exactly why this isn't wired into
 * retrieveContext() automatically).
 *
 * Expects `candidates` already narrowed to a small set (e.g. the output of
 * hybridRerank) to keep the prompt short and cheap. Falls back to the input
 * ordering, truncated to topK, if the gateway isn't configured or the LLM
 * response can't be parsed - this is a quality refinement, never a hard
 * dependency for retrieval to function.
 */
export async function llmRerank(
  query: string,
  candidates: VectorQueryResult[],
  topK: number,
  model = 'gemini-flash-latest'
): Promise<VectorQueryResult[]> {
  if (candidates.length <= 1 || !isOmniRouteConfigured()) {
    return candidates.slice(0, topK);
  }

  try {
    const chat = createOmniRouteChatModel(model, 0);
    const numbered = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 500)}`).join('\n\n');
    const prompt =
      `Query: "${query}"\n\n` +
      `Candidate passages:\n${numbered}\n\n` +
      `Return ONLY a JSON array of the candidate indices (numbers), ordered from most to least relevant to the query. ` +
      `Example: [2,0,1]`;

    const response = await chat.invoke(prompt);
    const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const match = raw.match(/\[[\d,\s]*\]/);
    if (!match) {
      return candidates.slice(0, topK);
    }
    const order: number[] = JSON.parse(match[0]);
    const reordered = order.filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length).map((i) => candidates[i]);

    // Append any candidates the model omitted, so we never silently drop one.
    const seen = new Set(reordered);
    for (const c of candidates) {
      if (!seen.has(c)) reordered.push(c);
    }

    return reordered.slice(0, topK);
  } catch (error) {
    console.warn('[RAG] llmRerank failed, falling back to hybrid ranking:', (error as Error).message);
    return candidates.slice(0, topK);
  }
}
