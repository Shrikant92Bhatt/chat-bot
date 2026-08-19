output "database_id" {
  description = "Firestore database ID — set as FIRESTORE_DATABASE_ID on chat-api."
  value       = google_firestore_database.database.name
}

output "database_location" {
  value = google_firestore_database.database.location_id
}
