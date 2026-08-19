variable "project_id" {
  description = "GCP project ID to create the Artifact Registry repository in."
  type        = string
}

variable "region" {
  description = "Region for the Artifact Registry repository (should match the Cloud Run region so pulls are same-region)."
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod) — used only for labels/description text."
  type        = string
}

variable "repository_id" {
  description = "Artifact Registry repository ID. Matches the `chat-repo` name already referenced by cloudbuild.yaml and .github/workflows/ci-cd.yml."
  type        = string
  default     = "chat-repo"
}
