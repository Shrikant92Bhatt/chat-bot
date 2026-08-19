output "host" {
  description = "Redis instance IP (null when enabled = false)."
  value       = try(google_redis_instance.cache[0].host, null)
}

output "port" {
  value = try(google_redis_instance.cache[0].port, null)
}
