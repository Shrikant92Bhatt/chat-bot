# Docker repository holding the two images built by cloudbuild.yaml:
#   - chat-api    (from Dockerfile.api)
#   - chat-client (from Dockerfile.client)
#
# Repository URL format matches what ci-cd.yml and cloudbuild.yaml already hardcode:
#   <region>-docker.pkg.dev/<project_id>/<repository_id>/<image>:<tag>

resource "google_artifact_registry_repository" "docker_repo" {
  project       = var.project_id
  location      = var.region
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "Docker images for chat-api and chat-client (${var.environment})"

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}
