# Topics only — no subscriptions, since nothing consumes these yet. Add
# subscriptions (push to a Cloud Run worker, or pull) once a consumer exists.

resource "google_pubsub_topic" "topics" {
  for_each = toset(var.topics)

  project                    = var.project_id
  name                       = each.value
  message_retention_duration = var.message_retention_duration

  labels = {
    managed_by = "terraform"
  }
}
