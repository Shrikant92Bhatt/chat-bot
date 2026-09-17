// Local/standalone entrypoint (not used on Vercel, which imports app.ts
// directly via /api/index.ts and never calls .listen() itself - Vercel owns
// the HTTP server). Use this for `nx serve chat-api` and any non-Vercel host.
import app from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Chat API Express Server running on port ${PORT}`);
  console.log(`📡 Healthcheck: http://localhost:${PORT}/health`);
  console.log(`🔑 GOOGLE_CLIENT_ID Loaded: ${process.env.GOOGLE_CLIENT_ID ? 'YES (' + process.env.GOOGLE_CLIENT_ID.slice(0, 12) + '...)' : 'NO (Check .env file)'}`);
  console.log(`=================================================`);
});
