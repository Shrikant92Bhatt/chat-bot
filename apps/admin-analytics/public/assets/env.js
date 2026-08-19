// Runtime configuration for the admin-analytics Angular app.
// In local dev this stays empty and services fall back to http://localhost:3000.
// In the container image, docker-entrypoint.sh regenerates this file at startup
// from the API_URL environment variable set on the Cloud Run service, so the
// same built image can point at any backend without a rebuild.
window.__env = {
  apiUrl: '',
};
