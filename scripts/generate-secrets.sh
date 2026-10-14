#!/usr/bin/env bash
# Prints freshly generated values for the env vars NexusAI needs random
# secrets for. Run locally, paste the output into Vercel (or over the
# <generate> placeholders in .env.production.template). Nothing is written to
# disk or sent anywhere.
set -euo pipefail

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

echo "CONNECTOR_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "MCP_OAUTH_SIGNING_SECRET=$(openssl rand -hex 32)"
echo "CODE_SANDBOX_SERVICE_SECRET=$(openssl rand -hex 32)"
echo
echo "# Only if you are NOT reusing the existing GCP value (rotating it signs everyone out):"
echo "# APP_SESSION_SECRET=$(openssl rand -hex 32)"
