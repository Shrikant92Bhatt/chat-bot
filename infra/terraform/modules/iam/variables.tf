variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "environment" {
  description = "Environment name, used in the service account display name."
  type        = string
}

variable "api_service_account_id" {
  description = "Account ID (the part before @project.iam.gserviceaccount.com) for the chat-api runtime service account."
  type        = string
  default     = "chat-api-sa"
}

variable "bucket_name" {
  description = "Name of the GCS bucket the API needs read/write access to (module.storage output). Used to scope the storage grant to this bucket instead of the whole project."
  type        = string
}
