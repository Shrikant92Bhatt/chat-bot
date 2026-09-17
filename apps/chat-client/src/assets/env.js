// Runtime/dev-time configuration for the Angular app.
// This checked-in copy is what `ng serve`/local dev uses - the chat-api dev
// server on port 3000. The Vercel production build overwrites this file at
// build time (see package.json's "build:vercel" script) with apiUrl: '',
// meaning "call the API on this same origin" (chat-client and chat-api are
// deployed together as one Vercel project - see vercel.json).
window.__env = {
  apiUrl: 'http://localhost:3000',
};
