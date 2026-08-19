output "api_service_account_email" {
  description = "Email of the chat-api runtime service account — pass to modules/cloud-run's api_service_account_email."
  value       = google_service_account.api.email
}

output "api_service_account_id" {
  value = google_service_account.api.account_id
}
