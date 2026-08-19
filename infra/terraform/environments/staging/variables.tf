variable "project_id" {
  description = "GCP project ID for the staging environment."
  type        = string
}

variable "region" {
  description = "GCP region. ci-cd.yml currently deploys to asia-south1."
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  type    = string
  default = "staging"
}

# --- Artifact Registry -------------------------------------------------

variable "artifact_repository_id" {
  type    = string
  default = "chat-repo"
}

# --- Storage -------------------------------------------------------------

variable "bucket_name" {
  description = "Globally-unique GCS bucket name. Must be set per environment — bucket names collide across all GCP projects, not just yours."
  type        = string
  default     = "nexusai-generated-images-staging"
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
  type    = string
  default = "nexus-ai-staging"
}

# --- Redis (Memorystore) — opt-in, no free tier -----------------------------

variable "enable_redis" {
  type    = bool
  default = false
}

# --- Cloud Run ---------------------------------------------------------

variable "api_image" {
  description = "Full chat-api image ref. Defaults to :latest in the shared repo; pin a tag/digest for reproducible deploys."
  type        = string
  default     = null
}

variable "client_image" {
  description = "Full chat-client image ref."
  type        = string
  default     = null
}

variable "min_instance_count" {
  type    = number
  default = 0
}

variable "max_instance_count" {
  type    = number
  default = 2
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
  description = "CORS allowed origin for chat-api."
  type        = string
  default     = "*"
}

# --- Monitoring ----------------------------------------------------------

variable "monitoring_notification_channels" {
  type    = list(string)
  default = []
}
