variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "location" {
  description = "GCS bucket location. Regional (e.g. ASIA-SOUTH1) or multi-region (e.g. ASIA)."
  type        = string
  default     = "ASIA-SOUTH1"
}

variable "bucket_name" {
  description = <<-EOT
    Bucket name. Bucket names are globally unique across all of GCS, so this must be
    supplied per environment. Matches the app's GCS_BUCKET_NAME env var — set the
    same value on the Cloud Run service (see modules/cloud-run) so uploader.ts and
    metrics.ts point at this bucket.
  EOT
  type        = string
}

variable "force_destroy" {
  description = "Allow `terraform destroy` to delete the bucket even if it still contains objects. Keep false in prod."
  type        = bool
  default     = false
}

variable "uniform_bucket_level_access" {
  description = "Use uniform (IAM-only) bucket access instead of legacy ACLs."
  type        = bool
  default     = true
}

variable "cors_origins" {
  description = "Allowed CORS origins for direct browser uploads/reads, if ever needed. Empty by default since uploads currently proxy through chat-api."
  type        = list(string)
  default     = []
}

variable "enable_lifecycle_rule" {
  description = "Enable an age-based lifecycle rule that deletes objects after `retention_days`. Off by default so generated images/uploads aren't silently deleted."
  type        = bool
  default     = false
}

variable "retention_days" {
  description = "Age (in days) at which objects are deleted, when enable_lifecycle_rule is true."
  type        = number
  default     = 90
}
