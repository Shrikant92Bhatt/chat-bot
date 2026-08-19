variable "project_id" {
  description = "GCP project ID for the prod environment. The existing deploy (ci-cd.yml) targets chat-bot-505613 — set that here if adopting this Terraform against the already-running project, or a fresh project ID otherwise."
  type        = string
}

variable "region" {
  description = "GCP region. ci-cd.yml currently deploys to asia-south1."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  type    = string
  default = "prod"
}

# --- Artifact Registry -------------------------------------------------

variable "artifact_repository_id" {
  type    = string
  default = "chat-repo"
}

# --- Storage -------------------------------------------------------------

variable "bucket_name" {
  description = "Globally-unique GCS bucket name. Defaults to the name already referenced by PROJECT_CONTEXT.md's GCS_BUCKET_NAME table (nexusai-generated-images)."
  type        = string
  default     = "nexusai-generated-images"
}

variable "storage_location" {
  type    = string
  default = "ASIA-SOUTH1"
}

# --- Firestore -------------------------------------------------------------

variable "firestore_location" {
  type    = string
  default = "asia-south1"
}

variable "firestore_database_id" {
  description = "Matches FIRESTORE_DATABASE_ID already set in .github/workflows/ci-cd.yml's gcloud run deploy step."
  type        = string
  default     = "nexus-ai"
}

# --- Redis (Memorystore) — opt-in, no free tier -----------------------------

variable "enable_redis" {
  type    = bool
  default = false
}

# --- Cloud Run ---------------------------------------------------------

variable "api_image" {
  description = "Full chat-api image ref. Defaults to :latest in the shared repo; pin a tag/digest for reproducible prod deploys instead of floating :latest."
  type        = string
  default     = null
}

variable "client_image" {
  description = "Full chat-client image ref."
  type        = string
  default     = null
}

variable "min_instance_count" {
  description = "Kept at 0 by default to stay free-tier-safe. Bump to 1 in terraform.tfvars once cold-start latency matters more than idle cost."
  type        = number
  default     = 0
}

variable "max_instance_count" {
  type    = number
  default = 4
}

variable "allow_unauthenticated" {
  description = "Matches --allow-unauthenticated in ci-cd.yml — app-level auth (Google OAuth2 + session JWT) handles access control, not IAM."
  type        = bool
  default     = true
}

# --- App env vars (non-secret) ------------------------------------------

variable "google_client_id" {
  description = "Google OAuth2 client ID (public, not a secret — see modules/secret-manager's note on this)."
  type        = string
  default     = ""
}

variable "allowed_origin" {
  description = "CORS allowed origin for chat-api. ci-cd.yml currently sets this to the custom domain fronting chat-client (https://nexusai-gcp.duckdns.org)."
  type        = string
  default     = "*"
}

# --- Monitoring ----------------------------------------------------------

variable "monitoring_notification_channels" {
  type    = list(string)
  default = []
}
