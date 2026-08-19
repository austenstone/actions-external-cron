@description('Name of the Logic App workflow.')
param name string = 'actions-external-cron'

@description('Azure region for the workflow.')
param location string = resourceGroup().location

@description('Target repository as owner/repo.')
param githubRepository string

@description('Fine-grained PAT with Contents: write on the target repository.')
@secure()
param githubToken string

resource workflow 'Microsoft.Logic/workflows@2019-05-01' = {
  name: name
  location: location
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        githubToken: {
          type: 'SecureString'
        }
      }
      triggers: {
        Hourly: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Hour'
            interval: 1
            timeZone: 'UTC'
            // Without an explicit schedule the first run anchors to deployment time and
            // every subsequent run inherits that offset. Pin it to :00.
            schedule: {
              minutes: [0]
            }
          }
        }
      }
      actions: {
        Dispatch: {
          type: 'Http'
          runAfter: {}
          inputs: {
            method: 'POST'
            uri: 'https://api.github.com/repos/${githubRepository}/dispatches'
            headers: {
              Accept: 'application/vnd.github+json'
              'Content-Type': 'application/json'
              'X-GitHub-Api-Version': '2022-11-28'
              'User-Agent': 'actions-external-cron'
              Authorization: 'Bearer @{parameters(\'githubToken\')}'
            }
            body: {
              event_type: 'scheduled-run'
              client_payload: {
                source: 'azure-logic-app'
                fired_at: '@{utcNow()}'
              }
            }
          }
          retryPolicy: {
            type: 'exponential'
            count: 4
            interval: 'PT10S'
          }
        }
      }
      outputs: {}
    }
    parameters: {
      githubToken: {
        value: githubToken
      }
    }
  }
}

output workflowName string = workflow.name
output triggerCallbackHint string = 'az rest --method post --uri "${environment().resourceManager}subscriptions/{sub}/resourceGroups/${resourceGroup().name}/providers/Microsoft.Logic/workflows/${workflow.name}/triggers/Hourly/run?api-version=2016-06-01"'
