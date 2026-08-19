variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "environment" {
  description = "Environment name, used in alert policy display names."
  type        = string
}

variable "cloud_run_service_names" {
  description = "Cloud Run service names to monitor (module.cloud_run outputs api_service_name / client_service_name)."
  type        = list(string)
}

variable "notification_channels" {
  description = "Notification channel IDs (e.g. from google_monitoring_notification_channel resources managed elsewhere). Empty by default — alert policies are created but won't page anyone until channels are added."
  type        = list(string)
  default     = []
}

variable "error_rate_threshold" {
  description = "5xx responses per second (averaged over the alignment period) that triggers the alert."
  type        = number
  default     = 5
}

variable "latency_p99_threshold_ms" {
  description = "p99 request latency (ms) that triggers the alert."
  type        = number
  default     = 3000
}
