# Least-privilege runtime identity for the chat-api Cloud Run service. The
# chat-client service is static NGINX with no GCP API calls, so it runs as the
# Cloud Run default compute service account (no dedicated SA needed).
#
# Grants map directly to what apps/chat-api/src actually touches:
#   - Firestore (user registry, threads)      -> roles/datastore.user
#   - GCS bucket (uploads/generated images)   -> roles/storage.objectAdmin (bucket-scoped, not project-wide)
#   - Secret Manager (API keys, JWT secret)   -> roles/secretmanager.secretAccessor
#   - Pub/Sub publish (future async pipeline) -> roles/pubsub.publisher (project-scoped; topics aren't
#     individually IAM-scoped by this module since none exist to publish to yet in app code)

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = var.api_service_account_id
  display_name = "chat-api runtime service account (${var.environment})"
}

resource "google_project_iam_member" "api_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "api_storage_object_admin" {
  bucket = var.bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}
