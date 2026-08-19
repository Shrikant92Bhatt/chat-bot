output "error_rate_alert_policy_ids" {
  value = { for name, policy in google_monitoring_alert_policy.error_rate : name => policy.id }
}

output "latency_alert_policy_ids" {
  value = { for name, policy in google_monitoring_alert_policy.latency : name => policy.id }
}
