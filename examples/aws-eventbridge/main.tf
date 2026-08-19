terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "region" {
  type        = string
  description = "AWS region."
  default     = "us-east-1"
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

variable "schedule_expression" {
  type        = string
  default     = "cron(0 * * * ? *)"
  description = "EventBridge schedule expression. Note cron() here takes SIX fields, not five."
}

provider "aws" {
  region = var.region
}

# The connection holds the credential. EventBridge stores it in Secrets Manager for you,
# so the token never sits in plaintext on the schedule itself.
resource "aws_cloudwatch_event_connection" "github" {
  name               = "actions-external-cron"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${var.github_token}"
    }

    invocation_http_parameters {
      header {
        key             = "Accept"
        value           = "application/vnd.github+json"
        is_value_secret = false
      }
      header {
        key             = "X-GitHub-Api-Version"
        value           = "2022-11-28"
        is_value_secret = false
      }
      header {
        key             = "User-Agent"
        value           = "actions-external-cron"
        is_value_secret = false
      }
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "github" {
  name                             = "actions-external-cron"
  invocation_endpoint              = "https://api.github.com/repos/${var.github_repository}/dispatches"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 1
  connection_arn                   = aws_cloudwatch_event_connection.github.arn
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "actions-external-cron-scheduler"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
}

resource "aws_iam_role_policy" "invoke_api_destination" {
  name = "invoke-api-destination"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "events:InvokeApiDestination"
      Resource = aws_cloudwatch_event_api_destination.github.arn
    }]
  })
}

resource "aws_scheduler_schedule" "dispatch" {
  name = "actions-external-cron"

  # EventBridge cron takes six fields: minute hour day-of-month month day-of-week year.
  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = "UTC"

  # OFF means fire at the exact minute. Any other mode lets AWS spread invocations
  # across a window, which would sabotage the whole measurement.
  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_cloudwatch_event_api_destination.github.arn
    role_arn = aws_iam_role.scheduler.arn

    # <aws.scheduler.scheduled-time> is substituted at invocation with the slot this
    # execution was scheduled for. Most HTTP schedulers cannot do this.
    input = jsonencode({
      event_type = "scheduled-run"
      client_payload = {
        source        = "aws-eventbridge"
        scheduled_for = "<aws.scheduler.scheduled-time>"
      }
    })

    retry_policy {
      maximum_retry_attempts       = 3
      maximum_event_age_in_seconds = 300
    }
  }
}

output "schedule_arn" {
  value = aws_scheduler_schedule.dispatch.arn
}
