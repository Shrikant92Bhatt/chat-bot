#!/bin/sh
set -e

# Regenerate the runtime config from the API_URL env var Cloud Run injects
# for this service revision, so the image never needs rebuilding to point
# at a different chat-api URL (dev/staging/prod all share the same image).
cat <<EOF > /usr/share/nginx/html/assets/env.js
window.__env = { apiUrl: "${API_URL:-}" };
EOF

exec nginx -g 'daemon off;'
