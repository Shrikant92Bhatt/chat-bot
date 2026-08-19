# Basic alert policy stubs for the two Cloud Run services. Deliberately minimal
# (error rate + latency only) — extend with uptime checks / log-based metrics
# once there's real traffic to tune thresholds against.

resource "google_monitoring_alert_policy" "error_rate" {
  for_each = toset(var.cloud_run_service_names)

  project      = var.project_id
  display_name = "${each.value} - high 5xx error rate (${var.environment})"
  combiner     = "OR"

  conditions {
    display_name = "5xx responses/sec > threshold"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${each.value}\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.error_rate_threshold
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = var.notification_channels

  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_monitoring_alert_policy" "latency" {
  for_each = toset(var.cloud_run_service_names)

  project      = var.project_id
  display_name = "${each.value} - high p99 latency (${var.environment})"
  combiner     = "OR"

  conditions {
    display_name = "p99 request latency > threshold"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"${each.value}\" AND metric.type = \"run.googleapis.com/request_latencies\""
      comparison      = "COMPARISON_GT"
      threshold_value = var.latency_p99_threshold_ms
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_99"
        cross_series_reducer = "REDUCE_NONE"
      }
    }
  }

  notification_channels = var.notification_channels

  alert_strategy {
    auto_close = "1800s"
  }
}
