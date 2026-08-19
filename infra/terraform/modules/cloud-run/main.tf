# Three Cloud Run v2 services, mirroring the three images built by
# cloudbuild.yaml and deployed by .github/workflows/ci-cd.yml's "Deploy to
# Cloud Run" job:
#   - chat-api        <- Dockerfile.api    (Express, needs GCP permissions -> dedicated SA)
#   - chat-client     <- Dockerfile.client (static NGINX SPA -> default compute SA is fine)
#   - admin-analytics <- Dockerfile.admin  (static NGINX SPA, same shape as chat-client)

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

# ---------------------------------------------------------------------------
# admin-analytics: the admin console SPA. Structurally identical to the client
# above (same image shape, same API_URL runtime config, same public invoker).
#
# It is intentionally public at the INFRA layer: authorization happens in-app
# (Google Sign-In -> app session JWT -> the API's requireAdmin middleware,
# which re-reads users/{uid}.role from Firestore on every single request).
# Fronting it with Cloud Run IAM instead would break the sign-in flow, which
# needs anonymous access to the API's public config endpoint. The bundle holds
# no secrets - every figure it renders comes from an admin-gated API call.

resource "google_cloud_run_v2_service" "admin" {
  project  = var.project_id
  name     = var.admin_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    containers {
      image = var.admin_image

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
        for_each = merge(
          { API_URL = google_cloud_run_v2_service.api.uri },
          var.admin_env_vars,
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

resource "google_cloud_run_v2_service_iam_member" "admin_public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.admin.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
