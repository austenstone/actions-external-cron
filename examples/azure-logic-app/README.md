# Azure Logic Apps (Consumption)

**Auth:** fine-grained PAT as a secure workflow parameter
**Reports:** `fired_at` (via `utcNow()`)
**Cost:** consumption billing, roughly $0.01/month at hourly frequency

Zero code, one Bicep file. A Recurrence trigger wired to an HTTP action. If your org is
Azure-shaped this is the least friction path, and the visual run history is genuinely the
best debugging experience of any option here.

## Setup

### 1. Create the token

A [fine-grained PAT](https://github.com/settings/personal-access-tokens/new) scoped to the
target repository with **Contents: Read and write**.

### 2. Deploy

```bash
az group create --name actions-external-cron --location eastus

az deployment group create \
  --resource-group actions-external-cron \
  --template-file main.bicep \
  --parameters \
      githubRepository=austenstone/actions-external-cron \
      githubToken=github_pat_...
```

### 3. Verify

```bash
# Fire the trigger immediately
az rest --method post --uri "https://management.azure.com/subscriptions/$(az account show --query id -o tsv)/resourceGroups/actions-external-cron/providers/Microsoft.Logic/workflows/actions-external-cron/triggers/Hourly/run?api-version=2016-06-01"

# Inspect run history
az rest --method get --uri "https://management.azure.com/subscriptions/$(az account show --query id -o tsv)/resourceGroups/actions-external-cron/providers/Microsoft.Logic/workflows/actions-external-cron/runs?api-version=2016-06-01" \
  --query "value[].{status:properties.status,start:properties.startTime}" -o table
```

The portal's **Run history** view shows the exact request and response body per action,
which beats digging through logs when GitHub returns a 404 and you need to know why.

## Notes

- **Pin the minute.** A bare `frequency: Hour, interval: 1` anchors to whenever you
  deployed, so a 14:37 deployment gives you a job that runs at :37 forever. The explicit
  `schedule: { minutes: [0] }` fixes it to the top of the hour.
- **`utcNow()` gives `fired_at`, not the slot.** Logic Apps does not expose the intended
  recurrence time to the action, so `scheduled_for` is omitted and the receiving workflow
  infers it.
- **Secure parameters are not perfectly secure.** `@secure()` keeps the value out of
  deployment logs and the designer, but anyone with `Microsoft.Logic/workflows/read` plus
  listing rights can still recover it. Use Key Vault references if that matters.
- **Consumption vs Standard.** This is a Consumption workflow — pay per action, scales to
  zero, ideal for something that fires 24 times a day. Standard (App Service hosted) is
  overkill here.
- **Retry policy is per-action.** The `exponential` policy retries the HTTP call four
  times before the run is marked failed, which covers a transient GitHub 5xx.
