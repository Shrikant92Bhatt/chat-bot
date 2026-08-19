terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      # Not directly used by any resource yet — declared so a module can adopt
      # a google-beta-only resource later without an environment-level change.
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

locals {
  # Falls back to ":latest" in this environment's own Artifact Registry repo
  # when api_image/client_image aren't pinned explicitly.
  api_image    = coalesce(var.api_image, "${module.artifact_registry.repository_url}/chat-api:latest")
  client_image = coalesce(var.client_image, "${module.artifact_registry.repository_url}/chat-client:latest")
  admin_image  = coalesce(var.admin_image, "${module.artifact_registry.repository_url}/admin-analytics:latest")
}

module "artifact_registry" {
  source = "../../modules/artifact-registry"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  repository_id = var.artifact_repository_id
}

module "storage" {
  source = "../../modules/storage"

  project_id  = var.project_id
  location    = var.storage_location
  bucket_name = var.bucket_name
}

module "firestore" {
  source = "../../modules/firestore"

  project_id  = var.project_id
  location    = var.firestore_location
  database_id = var.firestore_database_id
}

module "pubsub" {
  source = "../../modules/pubsub"

  project_id = var.project_id
}

module "redis" {
  source = "../../modules/redis"

  project_id    = var.project_id
  region        = var.region
  environment   = var.environment
  enabled       = var.enable_redis
  instance_name = "chat-ratelimit-${var.environment}"
}

module "secret_manager" {
  source = "../../modules/secret-manager"

  project_id  = var.project_id
  environment = var.environment
}

module "iam" {
  source = "../../modules/iam"

  project_id  = var.project_id
  environment = var.environment
  bucket_name = module.storage.bucket_name
}

module "cloud_run" {
  source = "../../modules/cloud-run"

  project_id  = var.project_id
  region      = var.region
  environment = var.environment

  api_image                 = local.api_image
  api_service_account_email = module.iam.api_service_account_email
  client_image               = local.client_image
  admin_image                = local.admin_image

  min_instance_count     = var.min_instance_count
  max_instance_count     = var.max_instance_count
  allow_unauthenticated  = var.allow_unauthenticated

  # Non-secret env vars — see .agents/PROJECT_CONTEXT.md env var table.
  api_env_vars = {
    GOOGLE_CLIENT_ID      = var.google_client_id
    ALLOWED_ORIGIN        = var.allowed_origin
    FIRESTORE_DATABASE_ID = module.firestore.database_id
    GCS_BUCKET_NAME       = module.storage.bucket_name
    OPENROUTER_BASE_URL   = "https://openrouter.ai/api/v1"
  }

  # Secret-backed env vars, pulled from Secret Manager at :latest. NOTE: Cloud
  # Run requires the referenced secret to have at least one version at apply
  # time, so seed a version for each of these (even an empty placeholder for
  # optional ones like OPENAI_API_KEY) before the first `terraform apply`, or
  # remove the line here if you don't use that provider. See
  # infra/terraform/README.md "Secrets" section.
  api_secret_env_vars = {
    GEMINI_API_KEY     = module.secret_manager.secret_ids["GEMINI_API_KEY"]
    OPENAI_API_KEY     = module.secret_manager.secret_ids["OPENAI_API_KEY"]
    OPENROUTER_API_KEY = module.secret_manager.secret_ids["OPENROUTER_API_KEY"]
    APP_SESSION_SECRET = module.secret_manager.secret_ids["APP_SESSION_SECRET"]
  }
}

module "monitoring" {
  source = "../../modules/monitoring"

  project_id  = var.project_id
  environment = var.environment

  cloud_run_service_names = [
    module.cloud_run.api_service_name,
    module.cloud_run.client_service_name,
    module.cloud_run.admin_service_name,
  ]
  notification_channels = var.monitoring_notification_channels
}
