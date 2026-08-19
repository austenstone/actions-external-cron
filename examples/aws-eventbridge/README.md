# AWS EventBridge Scheduler + API Destinations

**Auth:** fine-grained PAT, stored in Secrets Manager by EventBridge
**Reports:** `scheduled_for` (native)
**Cost:** 14M invocations/month free, then $1.00/million

The most capable option in this repo, and the only one that hits GitHub directly *and*
knows what time it meant to fire. No Lambda in the path.

## Setup

### 1. Create the token

A [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped to the
target repository with **Contents: Read and write**.

### 2. Apply

```bash
terraform init

terraform apply \
  -var="github_repository=austenstone/actions-external-cron" \
  -var="github_token=github_pat_..."
```

Four resources get created: a **connection** (holds the credential), an **API
destination** (the endpoint), an **IAM role** (lets the scheduler invoke it), and the
**schedule** itself.

### 3. Verify

There is no "run now" button for EventBridge Scheduler, and one-shot `at()` schedules need
you to hand-assemble the target JSON. The pragmatic check is to temporarily speed the
schedule up:

```bash
terraform apply -var="schedule_expression=rate(1 minute)" -var="github_token=$GITHUB_TOKEN"
# watch the repo's Actions tab for a minute, then put it back
terraform apply -var="github_token=$GITHUB_TOKEN"
```

Note that `rate(1 minute)` does not substitute a meaningful `<aws.scheduler.scheduled-time>`
slot for the leaderboard, so expect the drift numbers from these test runs to look odd.
They are excluded automatically if they land more than 30 minutes from an hour boundary.

Failures land in CloudWatch metrics under `AWS/Scheduler` —
`InvocationAttemptCount` and `TargetErrorCount`.

## Notes

- **`<aws.scheduler.scheduled-time>` is the killer feature.** EventBridge substitutes
  context attributes into the target input at invocation time, so the payload carries the
  intended slot without any code. Also available:
  `<aws.scheduler.execution-id>`, `<aws.scheduler.attempt-number>`.
- **`flexible_time_window { mode = "OFF" }` is not optional here.** The alternative,
  `FLEXIBLE`, deliberately jitters invocations across a window to smooth load. Great for
  real workloads, fatal for measuring punctuality.
- **The credential is managed for you.** The connection provisions a Secrets Manager
  secret behind the scenes, so unlike the [GCP example](../gcp-cloud-scheduler/) the token
  is not sitting in the schedule definition. It *is* still in Terraform state.
- **`invocation_rate_limit_per_second = 1`** caps how hard EventBridge will hammer the
  destination. GitHub's secondary rate limits are unforgiving; do not raise it without a
  reason.
- **Timezone support is real.** `schedule_expression_timezone` handles DST correctly,
  which matters if you ever want "9am local" rather than a fixed UTC hour. GitHub's own
  `schedule:` trigger is UTC-only.
