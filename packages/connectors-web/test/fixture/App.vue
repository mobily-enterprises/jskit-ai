<script setup>
import { computed, ref } from "vue";
import { googleAnalyticsDefinition, googleDriveDefinition, gmailDefinition, bigqueryDefinition } from "../../../connectors-catalog/src/shared/google.js";
import { IntegrationConfigurationFields } from "../../src/client/index.js";
import { googleCalendarDefinition } from "../../../connector-google-calendar/src/shared/definition.js";
import { mailgunDefinition, contentfulDefinition } from "../../../connectors-catalog/src/shared/tokens.js";
import { algoliaDefinition } from "../../../connectors-catalog/src/shared/algolia.js";
import { clickhouseDefinition } from "../../../connectors-catalog/src/shared/clickhouse.js";
import { slackDefinition } from "../../../connectors-catalog/src/shared/slack.js";
import { amazonRedshiftDefinition } from "../../../connectors-catalog/src/shared/amazon-redshift.js";
import { snowflakeDefinition } from "../../../connectors-catalog/src/shared/snowflake.js";
import { databricksDefinition } from "../../../connectors-catalog/src/shared/databricks.js";
import { parseIntegrationConfiguration, validateIntegrationConfiguration } from "../../../connectors-core/src/shared/configuration.js";

const configuration = ref({
  schemaVersion: 1,
  integrations: { bigquery: {
    provider: "bigquery", accountMode: "shared",
    scopes: bigqueryDefinition.scopes.filter((scope) => scope.recommended).map((scope) => scope.value),
    authentication: { method: "oauth2", registrationRef: "google" }, settings: { projectId: "query-project" }
  }, gmail: {
    provider: "gmail", accountMode: "shared",
    scopes: gmailDefinition.scopes.filter((scope) => scope.recommended).map((scope) => scope.value),
    authentication: { method: "oauth2", registrationRef: "google" }
  }, drive: {
    provider: "google-drive", accountMode: "shared",
    scopes: googleDriveDefinition.scopes.filter((scope) => scope.recommended).map((scope) => scope.value),
    authentication: { method: "oauth2", registrationRef: "google" }
  }, analytics: {
    provider: "google-analytics", accountMode: "shared", scopes: [],
    authentication: { method: "none" }, settings: { measurementId: "G-ORIGINAL1" }
  }, content: {
    provider: "contentful", accountMode: "shared", scopes: [], settings: { spaceId: "original-space" },
    authentication: { method: "api-key", secretRef: "env:CONTENTFUL_DELIVERY_TOKEN" }
  }, calendar: {
    provider: "google-calendar", displayName: "Team calendar", accountMode: "per-user",
    scopes: googleCalendarDefinition.scopes.filter((scope) => scope.recommended).map((scope) => scope.value),
    authentication: { method: "oauth2", registrationRef: "google" },
    extensions: { businessRule: "keep-me" }
  }, mail: {
    provider: "mailgun", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:MAILGUN_KEY" }, extensions: { label: "preserve" }
  }, search: {
    provider: "algolia", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:ALGOLIA_BACKEND_KEY" },
    settings: { applicationId: "ORIGINALAPP" }, extensions: { keep: true }
  }, warehouse: {
    provider: "clickhouse", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:CLICKHOUSE_PASSWORD" },
    settings: { httpUrl: "https://warehouse.example:8443/query/", username: "reader" }, extensions: { keep: "database" }
  }, slack: {
    provider: "slack", accountMode: "per-user", scopes: ["channels:read"], settings: { actor: "user" },
    authentication: { method: "oauth2", registrationRef: "slack" }, extensions: { keep: "workspace" }
  }, redshift: {
    provider: "amazon-redshift", accountMode: "shared", scopes: [],
    authentication: { method: "api-key", secretRef: "env:AWS_SECRET_ACCESS_KEY" },
    settings: { workgroup: "analytics", database: "dev", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID" }, extensions: { keep: "redshift" }
  }, snowflake: {
    provider: "snowflake", accountMode: "per-user", scopes: ["refresh_token"],
    authentication: { method: "oauth2", registrationRef: "snowflake" },
    settings: { accountUrl: "https://myorg-myaccount.snowflakecomputing.com" }, extensions: { keep: "account" }
  }, databricks: {
    provider: "databricks", accountMode: "per-user", scopes: ["all-apis", "offline_access"],
    authentication: { method: "oauth2", registrationRef: "databricks" },
    settings: { workspaceUrl: "https://dbc-abc123.cloud.databricks.com" }, extensions: { keep: "workspace" }
  } },
  registrations: {
    snowflake: { source: "own", clientId: "snowflake-client", clientSecretRef: "env:SNOWFLAKE_SECRET", callbackUrlRef: "env:SNOWFLAKE_CALLBACK" },
    google: { source: "own", clientId: "original-client", clientSecretRef: "env:GOOGLE_SECRET", callbackUrlRef: "env:CALLBACK" },
    slack: { source: "own", clientId: "slack-client", clientSecretRef: "env:SLACK_SECRET", callbackUrlRef: "env:SLACK_CALLBACK" },
    databricks: { source: "own", clientId: "user-client", clientSecretRef: "env:DATABRICKS_SECRET", callbackUrlRef: "env:DATABRICKS_CALLBACK" }
  }
});
const visible = ref(true);
const errors = ref({});
const exported = ref("");
const source = ref("");
const locked = ref(false);
const activeId = ref("calendar");
const providers = [bigqueryDefinition, gmailDefinition, googleDriveDefinition, googleAnalyticsDefinition, contentfulDefinition, snowflakeDefinition, googleCalendarDefinition, mailgunDefinition, algoliaDefinition, clickhouseDefinition, slackDefinition, amazonRedshiftDefinition, databricksDefinition];
const provider = computed(() => providers.find((entry) => entry.id === configuration.value.integrations[activeId.value].provider));
function save() {
  try {
    const validated = validateIntegrationConfiguration(configuration.value, { providers });
    errors.value = {};
    exported.value = JSON.stringify(validated, null, 2);
  } catch (error) { errors.value = error.fieldErrors; }
}
function importSource() {
  try {
    configuration.value = parseIntegrationConfiguration(source.value, { providers });
    errors.value = {};
  } catch (error) { errors.value = error.fieldErrors; }
}
</script>

<template>
  <v-app>
    <v-main>
      <v-container style="max-width: 900px">
        <v-btn class="mb-4" min-height="48" @click="visible = !visible">{{ visible ? 'Leave configuration' : 'Return to configuration' }}</v-btn>
        <v-switch v-model="locked" label="Lock form" />
        <v-btn class="mb-4" min-height="48" @click="activeId = 'content'">Edit Contentful</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'analytics'">Edit Analytics</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'drive'">Edit Drive</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'gmail'">Edit Gmail</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'bigquery'">Edit BigQuery</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'mail'">Edit Mailgun</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'search'">Edit Algolia</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'warehouse'">Edit ClickHouse</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'slack'">Edit Slack</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'redshift'">Edit Redshift</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'databricks'">Edit Databricks</v-btn>
        <v-btn class="mb-4" min-height="48" @click="activeId = 'snowflake'">Edit Snowflake</v-btn>
        <IntegrationConfigurationFields
          v-if="visible" v-model="configuration" :integration-id="activeId"
          :provider="provider" :field-errors="errors" :disabled="locked"
        />
        <v-btn class="my-4" min-height="48" color="primary" @click="save">Export configuration</v-btn>
        <v-textarea v-model="source" label="Import configuration JSON" />
        <v-btn min-height="48" @click="importSource">Import configuration</v-btn>
        <pre data-testid="export" class="mt-4" style="white-space: pre-wrap; overflow-wrap: anywhere">{{ exported }}</pre>
      </v-container>
    </v-main>
  </v-app>
</template>
