# Scaffolded for future distributed rate-limiting work. Not created by default
# (see variables.tf `enabled`) — Memorystore bills hourly with no free tier, so
# this module stays a deliberate opt-in per environment.

resource "google_redis_instance" "cache" {
  count = var.enabled ? 1 : 0

  project        = var.project_id
  name           = var.instance_name
  region         = var.region
  tier           = var.tier
  memory_size_gb = var.memory_size_gb
  redis_version  = var.redis_version

  display_name = "chat-api rate limiting (${var.environment})"

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}
