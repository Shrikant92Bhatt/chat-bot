variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Cloud Run region. ci-cd.yml currently deploys to asia-south1."
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)."
  type        = string
}

# ---------------------------------------------------------------------------
# chat-api (apps/chat-api, built from Dockerfile.api, listens on PORT=8080)
# ---------------------------------------------------------------------------

variable "api_service_name" {
  type    = string
  default = "chat-api"
}

variable "api_image" {
  description = "Full image ref, e.g. asia-south1-docker.pkg.dev/PROJECT/chat-repo/chat-api:latest"
  type        = string
}

variable "api_service_account_email" {
  description = "Runtime service account for chat-api (module.iam output)."
  type        = string
}

variable "api_env_vars" {
  description = "Plain (non-secret) env vars for chat-api. See .agents/PROJECT_CONTEXT.md's env var table."
  type        = map(string)
  default     = {}
}

variable "api_secret_env_vars" {
  description = "Env var name -> Secret Manager secret ID, injected as Cloud Run secret env vars (always :latest)."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# chat-client (apps/chat-client, built from Dockerfile.client, NGINX, PORT=8080)
# ---------------------------------------------------------------------------

variable "client_service_name" {
  type    = string
  default = "chat-client"
}

variable "client_image" {
  description = "Full image ref, e.g. asia-south1-docker.pkg.dev/PROJECT/chat-repo/chat-client:latest"
  type        = string
}

variable "client_env_vars" {
  description = <<-EOT
    Extra/override env vars for chat-client. API_URL defaults to the chat-api
    service's own Cloud Run URL (see main.tf) — only set this if you're fronting
    chat-api with a custom domain, matching how ci-cd.yml currently sets
    API_URL=https://nexusai-gcp.duckdns.org instead of the raw Cloud Run URL.
  EOT
  type    = map(string)
  default = {}
}

# ---------------------------------------------------------------------------
# Shared sizing / scaling (kept free-tier-safe: 0 min instances everywhere by
# default so idle environments cost nothing beyond storage/Firestore reads).
# ---------------------------------------------------------------------------

variable "min_instance_count" {
  type    = number
  default = 0
}

variable "max_instance_count" {
  type    = number
  default = 2
}

variable "cpu" {
  description = "vCPU limit per container instance."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Memory limit per container instance."
  type        = string
  default     = "512Mi"
}

variable "container_port" {
  description = "Matches EXPOSE 8080 in both Dockerfile.api and Dockerfile.client."
  type        = number
  default     = 8080
}

variable "allow_unauthenticated" {
  description = "Grant roles/run.invoker to allUsers, matching --allow-unauthenticated in ci-cd.yml's gcloud run deploy steps."
  type        = bool
  default     = true
}
