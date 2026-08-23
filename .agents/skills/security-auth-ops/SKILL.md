# Security & Auth Operations Skill

## 1. Google OAuth2 App Session Authentication
- **Header**: `Authorization: Bearer <sessionToken>`
- **Middleware**: `authenticateToken` ([`apps/chat-api/src/middleware/auth.middleware.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/middleware/auth.middleware.ts))
- **Gating**: Validates session token, attaches `req.user` (`uid`, `email`, `role`).

## 2. Server-Side Admin Guard (Non-negotiable)
- **Middleware**: `requireAdmin` ([`apps/chat-api/src/middleware/admin.middleware.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/middleware/admin.middleware.ts))
- **Strict Rule**: `role` is **NEVER trusted from JWT claims**. `requireAdmin` performs a fresh Firestore read of `users/{uid}.role` on every request.
- **Fail Closed**: If Firestore read fails, access is denied (`403 Forbidden`).

## 3. Helmet HTTP Security Hardening
- **Location**: Registered in [`apps/chat-api/src/main.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/main.ts)
- **Protections**:
  - `Strict-Transport-Security` (HSTS)
  - `X-Frame-Options` (Clickjacking prevention)
  - `X-Content-Type-Options: nosniff` (MIME sniffing prevention)
  - `Cross-Origin-Resource-Policy` set to `cross-origin` for SSE streaming compatibility.

## 4. Operational Limits & Rate Limiting
- **Anonymous Limits**: Firestore-backed rate limiting per IP (`AnonUsageService`).
- **User Limits**: Managed via `SystemLimitsService` in Firestore.
