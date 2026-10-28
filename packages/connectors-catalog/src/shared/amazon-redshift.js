import { createSchema } from "json-rest-schema";
import { awsSettings, awsFields, awsCredentials } from "./aws.js";

const regions = [
  ["us-east-1", "jskit.connectors.aws.regions.usEast1"], ["us-east-2", "jskit.connectors.aws.regions.usEast2"], ["us-west-1", "jskit.connectors.aws.regions.usWest1"], ["us-west-2", "jskit.connectors.aws.regions.usWest2"],
  ["ca-central-1", "jskit.connectors.aws.regions.caCentral1"], ["ca-west-1", "jskit.connectors.aws.regions.caWest1"], ["mx-central-1", "jskit.connectors.aws.regions.mxCentral1"], ["sa-east-1", "jskit.connectors.aws.regions.saEast1"],
  ["eu-west-1", "jskit.connectors.aws.regions.euWest1"], ["eu-west-2", "jskit.connectors.aws.regions.euWest2"], ["eu-west-3", "jskit.connectors.aws.regions.euWest3"], ["eu-central-1", "jskit.connectors.aws.regions.euCentral1"],
  ["eu-central-2", "jskit.connectors.aws.regions.euCentral2"], ["eu-north-1", "jskit.connectors.aws.regions.euNorth1"], ["eu-south-1", "jskit.connectors.aws.regions.euSouth1"], ["eu-south-2", "jskit.connectors.aws.regions.euSouth2"],
  ["il-central-1", "jskit.connectors.aws.regions.ilCentral1"], ["me-south-1", "jskit.connectors.aws.regions.meSouth1"], ["me-central-1", "jskit.connectors.aws.regions.meCentral1"], ["af-south-1", "jskit.connectors.aws.regions.afSouth1"],
  ["ap-east-1", "jskit.connectors.aws.regions.apEast1"], ["ap-east-2", "jskit.connectors.aws.regions.apEast2"], ["ap-south-1", "jskit.connectors.aws.regions.apSouth1"], ["ap-south-2", "jskit.connectors.aws.regions.apSouth2"],
  ["ap-southeast-1", "jskit.connectors.aws.regions.apSoutheast1"], ["ap-southeast-2", "jskit.connectors.aws.regions.apSoutheast2"], ["ap-southeast-3", "jskit.connectors.aws.regions.apSoutheast3"], ["ap-southeast-4", "jskit.connectors.aws.regions.apSoutheast4"],
  ["ap-southeast-5", "jskit.connectors.aws.regions.apSoutheast5"], ["ap-southeast-6", "jskit.connectors.aws.regions.apSoutheast6"], ["ap-southeast-7", "jskit.connectors.aws.regions.apSoutheast7"],
  ["ap-northeast-1", "jskit.connectors.aws.regions.apNortheast1"], ["ap-northeast-2", "jskit.connectors.aws.regions.apNortheast2"], ["ap-northeast-3", "jskit.connectors.aws.regions.apNortheast3"]
];
const databaseName = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 127,
  validator: (value) => (![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && value.trim().length > 0 && new TextEncoder().encode(value).length <= 127) || "Enter a database identifier of at most 127 UTF-8 bytes." };
const common = { ...awsSettings,
  deploymentType: { type: "string", enum: ["serverless", "provisioned"], defaultTo: "serverless" },
  region: { ...awsSettings.region, enum: regions.map(([value]) => value) },
  database: databaseName
};
const serverlessSchema = createSchema({ ...common,
  workgroup: { type: "string", required: true, minLength: 3, maxLength: 63, pattern: "^[a-z0-9-]+$" }
});
const provisionedSchema = createSchema({ ...common,
  clusterIdentifier: { type: "string", required: true, minLength: 1, maxLength: 63, pattern: "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" },
  databaseUser: { ...databaseName, required: false }
});

const amazonRedshiftDefinition = Object.freeze({
  id: "amazon-redshift", name: "Amazon Redshift", description: "jskit.connectors.amazonRedshift.description",
  ...awsCredentials, scopes: [],
  settingsSchema: (settings = {}) => settings.deploymentType === "provisioned" ? provisionedSchema : serverlessSchema,
  settingsFields: [
    { name: "deploymentType", label: "jskit.connectors.amazonRedshift.fields.deploymentType.label", items: [{ value: "serverless", title: "jskit.connectors.amazonRedshift.fields.deploymentType.items.serverless.title" }, { value: "provisioned", title: "jskit.connectors.amazonRedshift.fields.deploymentType.items.provisioned.title" }] },
    { name: "region", label: "jskit.connectors.amazonRedshift.fields.region.label", items: regions.map(([value, key]) => ({ value, title: { key, params: { region: value } } })), hint: "jskit.connectors.amazonRedshift.fields.region.hint" },
    ...awsFields.filter((field) => field.name !== "region"),
    { name: "workgroup", label: "jskit.connectors.amazonRedshift.fields.workgroup.label", placeholder: "analytics", hint: "jskit.connectors.amazonRedshift.fields.workgroup.hint" },
    { name: "clusterIdentifier", label: "jskit.connectors.amazonRedshift.fields.clusterIdentifier.label", placeholder: "analytics-cluster" },
    { name: "database", label: "jskit.connectors.amazonRedshift.fields.database.label", placeholder: "dev" },
    { name: "databaseUser", label: "jskit.connectors.amazonRedshift.fields.databaseUser.label", placeholder: "report_reader", hint: "jskit.connectors.amazonRedshift.fields.databaseUser.hint" }
  ],
  setup: { url: "https://docs.aws.amazon.com/redshift/latest/mgmt/data-api.html", steps: [
    "Select the warehouse's account and region in Amazon Redshift, then copy its serverless workgroup name or provisioned cluster identifier and database name.",
    "Grant only the Data API actions your app uses: ListDatabases, ListSchemas, ListTables, DescribeTable, ExecuteStatement, DescribeStatement, GetStatementResult and CancelStatement. Serverless also needs redshift-serverless:GetCredentials; provisioned IAM users need redshift:GetClusterCredentialsWithIAM, or redshift:GetClusterCredentials for an explicit database user. Database grants control which SQL it can execute.",
    "Save the configuration, then use Set credential in Env for the access key ID, secret key and any session token. Return and choose Connect account. No OAuth app or callback is needed for this shared mode. Renew temporary credential values together.",
    "Connecting lists tables in the configured database. Starting SQL requires a separate application authorization decision."
  ] }
});

export { amazonRedshiftDefinition };
