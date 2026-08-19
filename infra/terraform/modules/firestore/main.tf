# Native-mode Firestore database used for the user registry and chat thread
# history (see AGENTS.md / PROJECT_CONTEXT.md — "DB: Firestore (user registry,
# threads)"). One project can host multiple named Firestore databases, which is
# why database_id is exposed as a variable instead of always using "(default)".

resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = var.database_id
  location_id = var.location
  type        = "FIRESTORE_NATIVE"

  concurrency_mode                 = "OPTIMISTIC"
  app_engine_integration_mode      = "DISABLED"
  delete_protection_state          = var.delete_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"
}
