output "bucket_name" {
  description = "GCS bucket name — set this as GCS_BUCKET_NAME on the chat-api Cloud Run service."
  value       = google_storage_bucket.uploads.name
}

output "bucket_url" {
  description = "gs:// URL of the bucket."
  value       = google_storage_bucket.uploads.url
}

output "bucket_self_link" {
  value = google_storage_bucket.uploads.self_link
}
