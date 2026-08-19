import { InjectionToken } from '@angular/core';

/**
 * This library is consumed by exactly one app (chat-client) and deliberately
 * does not depend on it directly - Nx project boundaries don't allow a lib
 * importing from an app, and even if they did, importing chat-client's
 * concrete AuthService here would make this lib unusable/untestable on its
 * own. The consuming app provides an implementation of this instead.
 */
export interface AdminAuthBridge {
  getIdToken(): string;
  currentUid(): string | null;
  /** Delegate to the host app's existing "please sign in again" flow. */
  notifySessionExpired(): void;
}

export const ADMIN_AUTH_BRIDGE = new InjectionToken<AdminAuthBridge>('ADMIN_AUTH_BRIDGE');

/** Base URL for the chat-api backend (same one the host app already talks to). */
export const ADMIN_API_BASE_URL = new InjectionToken<string>('ADMIN_API_BASE_URL');
