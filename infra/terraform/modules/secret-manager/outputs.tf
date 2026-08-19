output "secret_ids" {
  description = "Map of secret name -> Secret Manager secret ID, for wiring into modules/cloud-run's api_secret_env_vars."
  value       = { for name, secret in google_secret_manager_secret.secrets : name => secret.secret_id }
}
