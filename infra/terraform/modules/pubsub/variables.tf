variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "topics" {
  description = <<-EOT
    Pub/Sub topics to scaffold for future async work (document ingestion / RAG
    pipeline). Nothing in apps/chat-api currently publishes or subscribes to
    these — see rag/retriever.ts, which today calls ingest() synchronously
    in-process. Provisioned ahead of time so the async pipeline can be wired up
    without an infra change.
  EOT
  type        = list(string)
  default = [
    "file.uploaded",
    "document.processing",
    "document.embedding",
  ]
}

variable "message_retention_duration" {
  description = "How long unacked messages are retained."
  type        = string
  default     = "86400s" # 1 day
}
