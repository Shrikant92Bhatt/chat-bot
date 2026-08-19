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
# admin-analytics (apps/admin-analytics, built from Dockerfile.admin, NGINX,
# PORT=8080). Public at the infra layer by design - see main.tf for why.
# ---------------------------------------------------------------------------

variable "admin_service_name" {
  type    = string
  default = "admin-analytics"
}

variable "admin_image" {
  description = "Full image ref, e.g. asia-south1-docker.pkg.dev/PROJECT/chat-repo/admin-analytics:latest"
  type        = string
}

variable "admin_env_vars" {
  description = <<-EOT
    Extra/override env vars for admin-analytics. API_URL defaults to the
    chat-api service's own Cloud Run URL (see main.tf) — only set this if
    you're fronting chat-api with a custom domain, matching how ci-cd.yml
    sets API_URL=https://nexusai-gcp.duckdns.org.

    NOTE: after the first apply, the resulting admin_url output must be added
    manually to (a) chat-api's ALLOWED_ORIGIN (comma-separated) and (b) the
    Google OAuth client's Authorized JavaScript origins. Neither can be set
    before the URL exists.
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
