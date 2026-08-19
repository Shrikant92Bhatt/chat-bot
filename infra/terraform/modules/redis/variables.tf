variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the Memorystore instance."
  type        = string
}

variable "environment" {
  description = "Environment name, used in the instance display name."
  type        = string
}

variable "enabled" {
  description = <<-EOT
    Memorystore for Redis has no free tier (unlike Cloud Run/Firestore/Storage/
    Pub/Sub, which all have one). Nothing in apps/chat-api talks to Redis today —
    rate limiting is currently in-memory (see AGENTS.md feature matrix: "Rate
    limiting (anon trial) | ✅" with no Redis dependency listed). Keep this false
    until a distributed rate limiter is actually built, so this module is a no-op
    by default and never implies cost on its own.
  EOT
  type        = bool
  default     = false
}

variable "instance_name" {
  description = "Memorystore instance name."
  type        = string
  default     = "chat-ratelimit"
}

variable "tier" {
  description = "BASIC (no HA, cheapest) or STANDARD_HA."
  type        = string
  default     = "BASIC"
}

variable "memory_size_gb" {
  description = "Instance size in GB. 1 is the Memorystore minimum."
  type        = number
  default     = 1
}

variable "redis_version" {
  type    = string
  default = "REDIS_7_2"
}
