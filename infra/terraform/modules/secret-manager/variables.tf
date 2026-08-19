variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "environment" {
  description = "Environment name, used only in labels."
  type        = string
}

variable "secret_ids" {
  description = <<-EOT
    Secret Manager secret IDs to create (empty containers only — no values).
    Sourced from the app's env var table in .agents/PROJECT_CONTEXT.md:
      GEMINI_API_KEY      - required, Google Gemini API key
      OPENAI_API_KEY      - optional, enables GPT models
      OPENROUTER_API_KEY  - optional, preferred LLM gateway when set
      APP_SESSION_SECRET  - required in prod, JWT signing secret
      GOOGLE_CLIENT_ID    - required, Google OAuth2 client ID

    NOTE / assumption: .github/workflows/ci-cd.yml's existing `gcloud run deploy`
    step actually passes GOOGLE_CLIENT_ID as a *plain* --set-env-vars value (it's
    not confidential — it's sent to the browser) and instead pulls a
    GOOGLE_CLIENT_SECRET from Secret Manager, which isn't in PROJECT_CONTEXT.md's
    env var table at all. This module follows the task spec's literal 5-secret
    list; add "GOOGLE_CLIENT_SECRET" to this list (and wire it into
    modules/cloud-run's api_secret_env_vars) if/when the OAuth flow needs it here.
  EOT
  type        = list(string)
  default = [
    "GEMINI_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "APP_SESSION_SECRET",
    "GOOGLE_CLIENT_ID",
  ]
}

variable "secret_values" {
  description = <<-EOT
    Optional initial values, keyed by secret ID, e.g. { GEMINI_API_KEY = "..." }.
    Left empty by default — do NOT put real secrets in terraform.tfvars committed
    to git. Supply via `-var-file=secrets.auto.tfvars` (gitignored) or
    `TF_VAR_secret_values` at apply time, or leave empty and add versions
    out-of-band with `gcloud secrets versions add`.
  EOT
  type      = map(string)
  default   = {}
  sensitive = true
}
