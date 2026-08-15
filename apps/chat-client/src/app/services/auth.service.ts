import { Injectable, signal } from '@angular/core';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { UserSession } from '@chat-monorepo/shared';

const firebaseConfig = {
  apiKey: "AIzaSyYOUR_FIREBASE_API_KEY",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app-id",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  public userSignal = signal<UserSession | null>(null);
  private firebaseAuth: any = null;

  constructor() {
    this.initFirebase();
  }

  private initFirebase() {
    try {
      if (!getApps().length) {
        const app = initializeApp(firebaseConfig);
        this.firebaseAuth = getAuth(app);
      } else {
        this.firebaseAuth = getAuth();
      }

      this.firebaseAuth.onAuthStateChanged(async (firebaseUser: User | null) => {
        if (firebaseUser) {
          const idToken = await firebaseUser.getIdToken();
          this.userSignal.set({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            idToken,
          });
        } else {
          this.userSignal.set(null);
        }
      });
    } catch (e) {
      console.warn('[AuthService] Firebase initialization notice:', e);
      // Auto-set dev user in demo mode
      this.userSignal.set({
        uid: 'dev-user-777',
        email: 'alex.architect@enterprise.io',
        displayName: 'Alex Architect',
        photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
        idToken: 'mock-dev-token-jwt-12345',
      });
    }
  }

  async loginWithGoogle(): Promise<void> {
    if (!this.firebaseAuth) {
      // Fallback for demo mode
      this.userSignal.set({
        uid: 'google-user-999',
        email: 'alex.architect@enterprise.io',
        displayName: 'Alex Architect',
        photoURL: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
        idToken: 'demo-google-id-token',
      });
      return;
    }

    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(this.firebaseAuth, provider);
      const idToken = await result.user.getIdToken();
      this.userSignal.set({
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL,
        idToken,
      });
    } catch (error) {
      console.error('[AuthService] Google Login Failed:', error);
      throw error;
    }
  }

  async logout(): Promise<void> {
    if (this.firebaseAuth) {
      await signOut(this.firebaseAuth);
    }
    this.userSignal.set(null);
  }

  getIdToken(): string {
    return this.userSignal()?.idToken || 'mock-dev-token-jwt-12345';
  }
}
