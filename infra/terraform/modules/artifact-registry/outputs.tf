output "repository_id" {
  description = "Artifact Registry repository ID."
  value       = google_artifact_registry_repository.docker_repo.repository_id
}

output "repository_url" {
  description = "Base URL to push/pull images, e.g. asia-south1-docker.pkg.dev/PROJECT/chat-repo"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.repository_id}"
}
