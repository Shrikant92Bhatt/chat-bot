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
