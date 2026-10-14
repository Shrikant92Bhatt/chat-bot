import crypto from 'crypto';
import { COLLECTIONS, ConnectorStore } from './connector-store';

/**
 * Server-only credential storage (plan §6).
 *
 * Provider tokens are encrypted with AES-256-GCM before they ever reach the
 * database, in a collection separate from connection metadata, so a query
 * that lists a user's connections can never return a secret by accident.
 * The ciphertext's additional authenticated data binds it to its owner and
 * connection id: copying an envelope onto a different user's connection makes
 * decryption fail rather than silently handing over someone else's token.
 *
 * Key material comes from CONNECTOR_ENCRYPTION_KEY (32 bytes, base64 or hex).
 * Rotation: put the new key in CONNECTOR_ENCRYPTION_KEY and the old one in
 * CONNECTOR_ENCRYPTION_KEY_PREVIOUS - envelopes record which key id sealed
 * them, old ones still decrypt and are re-sealed with the new key on the next
 * token refresh. A deployment with a managed KMS can replace `KeyProvider`
 * without touching any caller.
 */

export interface ProviderCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent for tokens that do not expire. */
  expiresAt?: number;
  tokenType?: string;
}

interface CredentialEnvelope extends Record<string, unknown> {
  ownerUid: string;
  connectionId: string;
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: number;
}

export interface KeyProvider {
  /** Current key used for new envelopes. Throws when unconfigured (fail closed). */
  current(): { id: string; key: Buffer };
  /** Any key that may still be referenced by an existing envelope. */
  byId(id: string): Buffer | null;
}

function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const value = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  return buf.length === 32 ? buf : null;
}

function keyId(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export class EnvKeyProvider implements KeyProvider {
  current() {
    const key = parseKey(process.env.CONNECTOR_ENCRYPTION_KEY);
    if (!key) {
      throw new Error('CONNECTOR_ENCRYPTION_KEY is missing or not a 32-byte base64/hex value.');
    }
    return { id: keyId(key), key };
  }

  byId(id: string): Buffer | null {
    for (const raw of [process.env.CONNECTOR_ENCRYPTION_KEY, process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS]) {
      const key = parseKey(raw);
      if (key && keyId(key) === id) return key;
    }
    return null;
  }

  static isConfigured(): boolean {
    return parseKey(process.env.CONNECTOR_ENCRYPTION_KEY) !== null;
  }
}

function aad(ownerUid: string, connectionId: string): Buffer {
  return Buffer.from(`nexus-connector:v1:${ownerUid}:${connectionId}`, 'utf8');
}

export class CredentialVault {
  constructor(
    private readonly store: ConnectorStore,
    private readonly keys: KeyProvider = new EnvKeyProvider()
  ) {}

  async put(ownerUid: string, connectionId: string, credentials: ProviderCredentials): Promise<void> {
    const { id, key } = this.keys.current();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(ownerUid, connectionId));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    const envelope: CredentialEnvelope = {
      ownerUid,
      connectionId,
      keyId: id,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      updatedAt: Date.now(),
    };
    await this.store.set(COLLECTIONS.credentials, connectionId, envelope);
  }

  /** Returns null when absent, owned by someone else, or undecryptable - callers treat all three as "not connected". */
  async get(ownerUid: string, connectionId: string): Promise<ProviderCredentials | null> {
    const envelope = await this.store.get<CredentialEnvelope>(COLLECTIONS.credentials, connectionId);
    if (!envelope || envelope.ownerUid !== ownerUid || envelope.connectionId !== connectionId) return null;

    const key = this.keys.byId(envelope.keyId);
    if (!key) {
      console.error(`[CredentialVault] No key available for envelope key id ${envelope.keyId}.`);
      return null;
    }
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(aad(ownerUid, connectionId));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plaintext) as ProviderCredentials;
    } catch {
      // Deliberately no detail: the error text could hint at key material.
      console.error(`[CredentialVault] Failed to decrypt credentials for connection ${connectionId}.`);
      return null;
    }
  }

  async delete(connectionId: string): Promise<void> {
    await this.store.delete(COLLECTIONS.credentials, connectionId);
  }
}
