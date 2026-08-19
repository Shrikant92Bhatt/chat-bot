# Single bucket used for both direct file uploads and generated images, matching
# apps/chat-api/src/storage/uploader.ts and metrics.ts, which read/write via
# GCS_BUCKET_NAME. Default naming in PROJECT_CONTEXT.md is "nexusai-generated-images".

resource "google_storage_bucket" "uploads" {
  project                     = var.project_id
  name                         = var.bucket_name
  location                     = var.location
  storage_class                = "STANDARD"
  uniform_bucket_level_access  = var.uniform_bucket_level_access
  force_destroy                = var.force_destroy

  dynamic "cors" {
    for_each = length(var.cors_origins) > 0 ? [1] : []
    content {
      origin          = var.cors_origins
      method          = ["GET", "HEAD", "POST", "PUT"]
      response_header = ["Content-Type"]
      max_age_seconds = 3600
    }
  }

  dynamic "lifecycle_rule" {
    for_each = var.enable_lifecycle_rule ? [1] : []
    content {
      condition {
        age = var.retention_days
      }
      action {
        type = "Delete"
      }
    }
  }

  labels = {
    managed_by = "terraform"
  }
}
