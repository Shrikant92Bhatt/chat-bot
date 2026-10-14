/**
 * Persistence for the connector platform, behind one small interface so the
 * services can be unit-tested against an in-memory store and run against
 * Firestore in production.
 *
 * Collections (plan §11):
 * - connectorConnections   connection metadata (owner, provider, scopes, status) - never secrets
 * - connectorCredentials   encrypted credential envelopes, keyed by connection id, server-only
 * - connectorOAuthStates   single-use OAuth state, keyed by sha256(state)
 * - connectorApprovals     exact-action approvals, bound by digest
 * - connectorAuditEvents   redacted audit trail
 * - connectorPaperPortfolios  simulated broker state (paper trading only)
 * - connectorSocialDrafts  local social post drafts
 * - mcpOAuthClients / mcpOAuthCodes / mcpOAuthRefreshTokens  MCP authorization server state
 *
 * Every query in the services is a single-field equality filter sorted in
 * process (AGENTS.md §2b) so no composite index has to be provisioned.
 */

export type StoreDoc = Record<string, unknown>;

export interface ConnectorStore {
  get<T extends StoreDoc>(collection: string, id: string): Promise<T | null>;
  set<T extends StoreDoc>(collection: string, id: string, data: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  /** Single-field equality query. */
  findBy<T extends StoreDoc>(collection: string, field: string, value: unknown): Promise<Array<{ id: string; data: T }>>;
  /**
   * Atomic read-modify-write. `fn` receives the current doc (or null) and
   * returns the new doc, `null` to delete it, or `undefined` to leave it
   * untouched. Its second return value is passed back to the caller. Used for
   * single-use OAuth state, approval state transitions and paper fills, so two
   * instances can never both consume/execute the same record.
   */
  transact<T extends StoreDoc, R>(
    collection: string,
    id: string,
    fn: (current: T | null) => { next: T | null | undefined; result: R }
  ): Promise<R>;
}

export class MemoryConnectorStore implements ConnectorStore {
  private readonly data = new Map<string, Map<string, StoreDoc>>();

  private coll(name: string): Map<string, StoreDoc> {
    let c = this.data.get(name);
    if (!c) {
      c = new Map();
      this.data.set(name, c);
    }
    return c;
  }

  async get<T extends StoreDoc>(collection: string, id: string): Promise<T | null> {
    const doc = this.coll(collection).get(id);
    return doc ? (structuredClone(doc) as T) : null;
  }

  async set<T extends StoreDoc>(collection: string, id: string, data: T): Promise<void> {
    this.coll(collection).set(id, structuredClone(data));
  }

  async delete(collection: string, id: string): Promise<void> {
    this.coll(collection).delete(id);
  }

  async findBy<T extends StoreDoc>(collection: string, field: string, value: unknown) {
    const out: Array<{ id: string; data: T }> = [];
    this.coll(collection).forEach((doc, id) => {
      if (doc[field] === value) out.push({ id, data: structuredClone(doc) as T });
    });
    return out;
  }

  async transact<T extends StoreDoc, R>(
    collection: string,
    id: string,
    fn: (current: T | null) => { next: T | null | undefined; result: R }
  ): Promise<R> {
    // Synchronous between read and write, so it is atomic within this process.
    const c = this.coll(collection);
    const current = c.has(id) ? (structuredClone(c.get(id)) as T) : null;
    const { next, result } = fn(current);
    if (next === null) c.delete(id);
    else if (next !== undefined) c.set(id, structuredClone(next));
    return result;
  }

  /** Test helper: raw view of a collection. */
  dump(collection: string): Array<{ id: string; data: StoreDoc }> {
    return [...this.coll(collection).entries()].map(([id, data]) => ({ id, data }));
  }
}

export class FirestoreConnectorStore implements ConnectorStore {
  // Imported lazily so unit tests that use MemoryConnectorStore never
  // initialise firebase-admin.
  private get db() {
    return (require('../db/firestore') as typeof import('../db/firestore')).firestore;
  }

  async get<T extends StoreDoc>(collection: string, id: string): Promise<T | null> {
    const snap = await this.db.collection(collection).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async set<T extends StoreDoc>(collection: string, id: string, data: T): Promise<void> {
    await this.db.collection(collection).doc(id).set(data);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.db.collection(collection).doc(id).delete();
  }

  async findBy<T extends StoreDoc>(collection: string, field: string, value: unknown) {
    const snap = await this.db.collection(collection).where(field, '==', value).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
  }

  async transact<T extends StoreDoc, R>(
    collection: string,
    id: string,
    fn: (current: T | null) => { next: T | null | undefined; result: R }
  ): Promise<R> {
    const ref = this.db.collection(collection).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const { next, result } = fn(snap.exists ? (snap.data() as T) : null);
      if (next === null) tx.delete(ref);
      else if (next !== undefined) tx.set(ref, next);
      return result;
    });
  }
}

export const COLLECTIONS = {
  connections: 'connectorConnections',
  credentials: 'connectorCredentials',
  oauthStates: 'connectorOAuthStates',
  approvals: 'connectorApprovals',
  audit: 'connectorAuditEvents',
  paperPortfolios: 'connectorPaperPortfolios',
  socialDrafts: 'connectorSocialDrafts',
  mcpClients: 'mcpOAuthClients',
  mcpCodes: 'mcpOAuthCodes',
  mcpRefreshTokens: 'mcpOAuthRefreshTokens',
} as const;
