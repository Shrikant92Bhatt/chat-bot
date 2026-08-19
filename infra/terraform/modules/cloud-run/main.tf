# Two Cloud Run v2 services, mirroring the two images built by cloudbuild.yaml
# and deployed by .github/workflows/ci-cd.yml's "Deploy to Cloud Run" job:
#   - chat-api    <- Dockerfile.api    (Express, needs GCP permissions -> dedicated SA)
#   - chat-client <- Dockerfile.client (static NGINX SPA -> default compute SA is fine)

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = var.api_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = var.api_service_account_email

    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    containers {
      image = var.api_image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      ports {
        container_port = var.container_port
      }

      dynamic "env" {
        for_each = var.api_env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.api_secret_env_vars
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "client" {
  project  = var.project_id
  name     = var.client_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    containers {
      image = var.client_image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      ports {
        container_port = var.container_port
      }

      # Defaults to the chat-api service's own Cloud Run URL; override via
      # client_env_vars.API_URL if fronting chat-api with a custom domain.
      dynamic "env" {
        for_each = merge(
          { API_URL = google_cloud_run_v2_service.api.uri },
          var.client_env_vars,
        )
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_cloud_run_v2_service_iam_member" "client_public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.client.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
