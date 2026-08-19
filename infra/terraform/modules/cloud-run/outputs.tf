output "api_service_name" {
  value = google_cloud_run_v2_service.api.name
}

output "api_url" {
  description = "The chat-api Cloud Run URL (Express backend, SSE endpoint lives at <api_url>/api/chat/stream)."
  value       = google_cloud_run_v2_service.api.uri
}

output "client_service_name" {
  value = google_cloud_run_v2_service.client.name
}

output "client_url" {
  description = "The chat-client Cloud Run URL (Angular SPA served via NGINX)."
  value       = google_cloud_run_v2_service.client.uri
}

output "admin_service_name" {
  value = google_cloud_run_v2_service.admin.name
}

output "admin_url" {
  description = <<-EOT
    The admin-analytics Cloud Run URL (admin console SPA served via NGINX).

    ACTION REQUIRED after the first apply — add this URL to both:
      1. chat-api's ALLOWED_ORIGIN (comma-separated list), otherwise every
         admin API call fails CORS preflight from the browser.
      2. the Google OAuth client's "Authorized JavaScript origins" in the
         Google Cloud Console, otherwise Google Sign-In won't initialise.
  EOT
  value       = google_cloud_run_v2_service.admin.uri
}
