variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "location" {
  description = "Firestore location (region or multi-region, e.g. asia-south1 or nam5)."
  type        = string
  default     = "asia-south1"
}

variable "database_id" {
  description = <<-EOT
    Firestore database ID. The app reads this via FIRESTORE_DATABASE_ID (see
    .github/workflows/ci-cd.yml, which currently deploys with "nexus-ai"). Use
    "(default)" if you want the project's default database instead of a named one.
  EOT
  type        = string
  default     = "nexus-ai"
}

variable "delete_protection" {
  description = "Prevent accidental deletion of the Firestore database via the API/console."
  type        = bool
  default     = false
}
