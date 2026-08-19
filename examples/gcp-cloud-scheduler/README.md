# GCP Cloud Scheduler

**Auth:** fine-grained PAT in a static header
**Reports:** nothing — the body cannot be templated
**Cost:** 3 jobs free per billing account, then $0.10/job/month

The simplest possible version of this idea: a managed cron that makes an HTTP request.
No code, no runtime, no deployment artifact. One Terraform resource.

## Setup

### 1. Create the token

A [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped to the
single target repository with **Contents: Read and write**.

### 2. Apply

```bash
terraform init

terraform apply \
  -var="project_id=your-gcp-project" \
  -var="github_repository=austenstone/actions-external-cron" \
  -var="github_token=github_pat_..."
```

Or without Terraform:

```bash
gcloud scheduler jobs create http actions-external-cron \
  --location=us-central1 \
  --schedule="0 * * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://api.github.com/repos/OWNER/REPO/dispatches" \
  --http-method=POST \
  --headers="Accept=application/vnd.github+json,Content-Type=application/json,X-GitHub-Api-Version=2022-11-28,User-Agent=actions-external-cron,Authorization=Bearer github_pat_..." \
  --message-body='{"event_type":"scheduled-run","client_payload":{"source":"gcp-cloud-scheduler"}}'
```

### 3. Verify

```bash
gcloud scheduler jobs run actions-external-cron --location=us-central1
gcloud scheduler jobs describe actions-external-cron --location=us-central1
```

A successful dispatch returns **204 No Content**. If you get 404, the token cannot see the
repo (fine-grained PATs return 404 rather than 403 for repos outside their scope — an
easy hour to lose).

## Notes

- **The body is a static string.** Cloud Scheduler has no templating, so this job cannot
  stamp `fired_at` or `scheduled_for` into the payload. It is the only example in this
  repo with that limitation, and the receiving workflow compensates by inferring the slot
  from the run's `created_at`.
- **The token sits in plaintext in the job config.** Anyone with
  `cloudscheduler.jobs.get` can read it, and it lands in Terraform state. Restrict
  IAM and treat state as sensitive. If that is unacceptable, use a scheduler that can run
  code and mint short-lived App tokens — [Cloudflare](../cloudflare-worker/) or
  [Deno](../deno-deploy/).
- **`attempt_deadline` is not a retry.** It is the per-attempt timeout; `retry_config`
  governs retries. 30 seconds is generous for a call that normally returns in under one.
