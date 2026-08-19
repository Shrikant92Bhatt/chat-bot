# Remote state backend. Left with no attributes on purpose — GCS backend
# config can't use variables/tfvars (Terraform reads this before any vars are
# evaluated), so each operator supplies their own state bucket either by
# editing the values below or via `terraform init -backend-config=...`.
#
# Example (edit in place):
#   terraform {
#     backend "gcs" {
#       bucket = "chat-bot-tfstate-staging"
#       prefix = "terraform/state"
#     }
#   }
#
# Or via CLI, without editing this file:
#   terraform init \
#     -backend-config="bucket=chat-bot-tfstate-staging" \
#     -backend-config="prefix=terraform/state"
#
# The state bucket itself is NOT managed by this Terraform config (chicken/egg
# problem) — create it once by hand:
#   gsutil mb -l asia-south1 gs://chat-bot-tfstate-staging
#   gsutil versioning set on gs://chat-bot-tfstate-staging

terraform {
  backend "gcs" {}
}
