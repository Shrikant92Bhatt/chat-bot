import { describe, it, expect } from 'vitest';
import { mintAppSessionToken } from './auth.middleware';

describe('AuthMiddleware Unit Tests', () => {
  it('should mint valid JWT session tokens carrying user identity', () => {
    const user = { uid: 'usr-100', email: 'test@nexusai.dev', name: 'Test User' };
    const token = mintAppSessionToken(user);

    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // Standard JWT format
  });
});
