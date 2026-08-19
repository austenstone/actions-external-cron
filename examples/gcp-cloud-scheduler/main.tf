terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "region" {
  type        = string
  description = "Region for the scheduler job."
  default     = "us-central1"
}

variable "github_repository" {
  type        = string
  description = "Target repository as owner/repo."
}

variable "github_token" {
  type        = string
  sensitive   = true
  description = "Fine-grained PAT with Contents: write on the target repository."
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "scheduler" {
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_cloud_scheduler_job" "dispatch" {
  name             = "actions-external-cron"
  description      = "Dispatches a scheduled-run event to GitHub Actions"
  schedule         = "0 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "30s"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "5s"
    max_backoff_duration = "60s"
  }

  http_target {
    http_method = "POST"
    uri         = "https://api.github.com/repos/${var.github_repository}/dispatches"

    headers = {
      "Accept"               = "application/vnd.github+json"
      "Content-Type"         = "application/json"
      "X-GitHub-Api-Version" = "2022-11-28"
      "User-Agent"           = "actions-external-cron"
      "Authorization"        = "Bearer ${var.github_token}"
    }

    # Cloud Scheduler bodies are static — there is no templating, so this job cannot
    # report when it fired. The receiving workflow infers the slot instead.
    # See docs/PAYLOAD.md.
    body = base64encode(jsonencode({
      event_type = "scheduled-run"
      client_payload = {
        source = "gcp-cloud-scheduler"
      }
    }))
  }

  depends_on = [google_project_service.scheduler]
}

output "job_name" {
  value = google_cloud_scheduler_job.dispatch.name
}
