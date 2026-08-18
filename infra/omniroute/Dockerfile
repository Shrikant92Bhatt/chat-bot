# OmniRoute AI Gateway — self-hosted LiteLLM proxy with the project's
# model routing config baked in. Deployed as its own Cloud Run service,
# separate from chat-api/chat-client (see README.md in this directory).
FROM ghcr.io/berriai/litellm:main-latest

COPY litellm-config.yaml /app/config.yaml

EXPOSE 4000

CMD ["--config", "/app/config.yaml", "--port", "4000"]
