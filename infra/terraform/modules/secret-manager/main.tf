resource "google_secret_manager_secret" "secrets" {
  for_each = toset(var.secret_ids)

  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

# Optional initial version. Only created for secret IDs present in both
# secret_ids and secret_values, so leaving secret_values empty (the default)
# creates empty secret containers with no versions — safe for a fresh apply.
resource "google_secret_manager_secret_version" "initial" {
  for_each = var.secret_values

  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}
