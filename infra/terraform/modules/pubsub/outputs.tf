output "topic_ids" {
  description = "Map of topic short name -> fully-qualified topic ID."
  value       = { for name, topic in google_pubsub_topic.topics : name => topic.id }
}

output "topic_names" {
  description = "List of created topic short names."
  value       = [for topic in google_pubsub_topic.topics : topic.name]
}
