import { Injectable, signal, computed } from '@angular/core';
import { getApiBaseUrl } from '../core/runtime-config';

declare const google: any;

export interface AdminSession {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  /** The app's own session JWT minted by POST /api/auth/session. */
  sessionToken: string;
}

/**
 * Independent Google Sign-In + app-session handling for the admin console.
 *
 * This is a deliberate ~200-line duplicate of
 * apps/chat-client/src/app/services/auth.service.ts, NOT an oversight:
 *
 *  - admin-analytics is a separately deployed app with its own origin, its
 *    own build and its own login. It shares no runtime or state with
 *    chat-client (Module Federation was considered and rejected as too risky
 *    on this Angular version's esbuild builder).
 *  - It talks to the SAME backend: the same GOOGLE_CLIENT_ID (fetched from
 *    GET /api/chat/config) and the same POST /api/auth/session exchange. Only
 *    the localStorage key differs (NEXUS_ADMIN_SESSION), so signing out of
 *    the admin console never disturbs a chat-client session in the same
 *    browser, and vice versa.
 *
 * COULD EXTRACT TO libs/frontend/auth LATER: if a third frontend appears, or
 * if this and chat-client's copy start drifting in ways that matter, the
 * Google/GIS + session-exchange logic is the natural thing to lift into a
 * shared Nx lib. Doing that refactor now would mean touching the working
 * chat-client auth path for no immediate benefit, so it is explicitly
 * deferred.
 */
@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private static readonly STORAGE_KEY = 'NEXUS_ADMIN_SESSION';
  private static readonly CLIENT_ID_KEY = 'NEXUS_ADMIN_GOOGLE_CLIENT_ID';

  public readonly session = signal<AdminSession | null>(null);
  public readonly isAuthenticated = computed(() => this.session() !== null);

  /** User-visible sign-in failure (popup blocked, backend unreachable, ...). */
  public readonly loginError = signal<string | null>(null);
  public readonly isSigningIn = signal(false);

  /** Set when an admin API call comes back 403 - drives the access-denied screen. */
  public readonly accessDenied = signal(false);

  public readonly googleClientId = signal<string>(
    (localStorage.getItem(AdminAuthService.CLIENT_ID_KEY) || '').trim()
  );

  private configPromise: Promise<void>;

  constructor() {
    this.restoreSession();
    this.configPromise = this.fetchBackendConfig();
  }

  /** Pulls GOOGLE_CLIENT_ID from the backend, same public endpoint chat-client uses. */
  private async fetchBackendConfig(): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/chat/config`);
      if (!res.ok) return;
      const data = await res.json();
      const clientId = (data?.googleClientId || '').trim();
      if (clientId) {
        this.googleClientId.set(clientId);
        localStorage.setItem(AdminAuthService.CLIENT_ID_KEY, clientId);
      }
    } catch (e) {
      console.error('[Admin Auth] Failed to fetch backend config:', e);
    }
  }

  private restoreSession(): void {
    const stored = localStorage.getItem(AdminAuthService.STORAGE_KEY);
    if (!stored) return;

    try {
      const session: AdminSession = JSON.parse(stored);
      const payload = this.decodeJwtPayload(session.sessionToken);
      const nowSeconds = Math.floor(Date.now() / 1000);

      // The app session token is a 7-day JWT. Drop it locally once expired
      // rather than letting every API call 401 first.
      if (payload?.exp && payload.exp < nowSeconds) {
        localStorage.removeItem(AdminAuthService.STORAGE_KEY);
        return;
      }
      this.session.set(session);
    } catch {
      localStorage.removeItem(AdminAuthService.STORAGE_KEY);
    }
  }

  public async signInWithGoogle(): Promise<void> {
    this.loginError.set(null);
    this.isSigningIn.set(true);

    try {
      let clientId = this.googleClientId().trim();
      if (!clientId) {
        await this.configPromise;
        clientId = this.googleClientId().trim();
      }
      if (!clientId) {
        await this.fetchBackendConfig();
        clientId = this.googleClientId().trim();
      }
      if (!clientId) {
        this.loginError.set('Could not reach the sign-in service. Check your connection and try again.');
        this.isSigningIn.set(false);
        return;
      }

      if (typeof google === 'undefined' || !google.accounts) {
        this.loginError.set('Sign-in is still loading. Please try again in a moment.');
        this.isSigningIn.set(false);
        return;
      }

      try {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: any) => {
            if (response?.credential) {
              void this.exchangeForAppSession(response.credential);
            } else {
              this.isSigningIn.set(false);
            }
          },
          auto_select: false,
        });

        google.accounts.id.prompt((notification: any) => {
          // One Tap suppressed (dismissed before, no session, browser policy):
          // fall back to the explicit OAuth2 popup, same as chat-client.
          if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
            this.triggerOAuth2Popup(clientId);
          }
        });
      } catch (e) {
        console.error('[Admin Auth] GIS initialize failed:', e);
        this.triggerOAuth2Popup(clientId);
      }
    } catch (e) {
      console.error('[Admin Auth] Sign-in failed to start:', e);
      this.loginError.set('Google sign-in failed to start. Please try again.');
      this.isSigningIn.set(false);
    }
  }

  private triggerOAuth2Popup(clientId: string): void {
    if (typeof google === 'undefined' || !google.accounts?.oauth2) {
      this.loginError.set('Sign-in is still loading. Please try again in a moment.');
      this.isSigningIn.set(false);
      return;
    }

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope:
          'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
        callback: (tokenResponse: any) => {
          if (tokenResponse?.access_token) {
            void this.exchangeForAppSession(tokenResponse.access_token);
          } else {
            this.loginError.set('Google sign-in did not return a token. Please try again.');
            this.isSigningIn.set(false);
          }
        },
        error_callback: (err: any) => {
          console.error('[Admin Auth] OAuth2 popup failed:', err);
          this.loginError.set(
            'The Google sign-in popup was blocked or closed. Please allow popups for this site and try again.'
          );
          this.isSigningIn.set(false);
        },
      });
      client.requestAccessToken();
    } catch (e) {
      console.error('[Admin Auth] OAuth2 token client failed:', e);
      this.loginError.set('Google sign-in failed to start. Please try again.');
      this.isSigningIn.set(false);
    }
  }

  /**
   * Exchanges the raw Google credential for the app's own session JWT via the
   * EXISTING POST /api/auth/session endpoint. Note this endpoint is not
   * admin-gated - anyone with a Google account can obtain a session token.
   * Authorization happens per-request on the admin API (requireAdmin does a
   * fresh Firestore role read), which is why a successful sign-in here can
   * still land on the access-denied screen.
   */
  private async exchangeForAppSession(googleToken: string): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleToken}` },
      });

      if (!res.ok) {
        this.loginError.set(`Sign-in failed (server returned ${res.status}). Please try again.`);
        return;
      }

      const data = await res.json();
      const session: AdminSession = {
        uid: data.user.uid,
        email: data.user.email || '',
        displayName: data.user.name || 'Google User',
        photoURL: data.user.picture || '',
        sessionToken: data.sessionToken,
      };

      this.session.set(session);
      this.accessDenied.set(false);
      this.loginError.set(null);
      localStorage.setItem(AdminAuthService.STORAGE_KEY, JSON.stringify(session));
    } catch (e) {
      console.error('[Admin Auth] Session exchange failed:', e);
      this.loginError.set('Could not reach the server to complete sign-in. Please check your connection.');
    } finally {
      this.isSigningIn.set(false);
    }
  }

  public getSessionToken(): string {
    return this.session()?.sessionToken || '';
  }

  /** Called by the API client on a 403 from any admin endpoint. */
  public markAccessDenied(): void {
    this.accessDenied.set(true);
  }

  /** Called by the API client on a 401 - the session token is gone or expired. */
  public handleUnauthorized(): void {
    this.signOut();
    this.loginError.set('Your session has expired. Please sign in again.');
  }

  public signOut(): void {
    if (typeof google !== 'undefined' && google.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }
    this.session.set(null);
    this.accessDenied.set(false);
    localStorage.removeItem(AdminAuthService.STORAGE_KEY);
  }

  private decodeJwtPayload(token: string): { exp?: number } | null {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
}
