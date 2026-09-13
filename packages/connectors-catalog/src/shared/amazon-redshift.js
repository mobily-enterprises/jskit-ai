import { createSchema } from "json-rest-schema";
import { awsSettings, awsFields, awsCredentials } from "./aws.js";

const regions = [
  ["us-east-1", "N. Virginia"], ["us-east-2", "Ohio"], ["us-west-1", "N. California"], ["us-west-2", "Oregon"],
  ["ca-central-1", "Canada Central"], ["ca-west-1", "Calgary"], ["mx-central-1", "Mexico Central"], ["sa-east-1", "São Paulo"],
  ["eu-west-1", "Ireland"], ["eu-west-2", "London"], ["eu-west-3", "Paris"], ["eu-central-1", "Frankfurt"],
  ["eu-central-2", "Zurich"], ["eu-north-1", "Stockholm"], ["eu-south-1", "Milan"], ["eu-south-2", "Spain"],
  ["il-central-1", "Tel Aviv"], ["me-south-1", "Bahrain"], ["me-central-1", "UAE"], ["af-south-1", "Cape Town"],
  ["ap-east-1", "Hong Kong"], ["ap-east-2", "Taipei"], ["ap-south-1", "Mumbai"], ["ap-south-2", "Hyderabad"],
  ["ap-southeast-1", "Singapore"], ["ap-southeast-2", "Sydney"], ["ap-southeast-3", "Jakarta"], ["ap-southeast-4", "Melbourne"],
  ["ap-southeast-5", "Malaysia"], ["ap-southeast-6", "New Zealand"], ["ap-southeast-7", "Thailand"],
  ["ap-northeast-1", "Tokyo"], ["ap-northeast-2", "Seoul"], ["ap-northeast-3", "Osaka"]
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
  id: "amazon-redshift", name: "Amazon Redshift", description: "Inspect tables and run queries in a serverless workgroup or provisioned cluster.",
  ...awsCredentials, scopes: [],
  settingsSchema: (settings = {}) => settings.deploymentType === "provisioned" ? provisionedSchema : serverlessSchema,
  settingsFields: [
    { name: "deploymentType", label: "Deployment type", items: [{ value: "serverless", title: "Serverless" }, { value: "provisioned", title: "Provisioned cluster" }] },
    { name: "region", label: "AWS Region", items: regions.map(([value, title]) => ({ value, title: `${title} (${value})` })), hint: "Use the warehouse's region. Availability depends on your AWS account and deployment type." },
    ...awsFields.filter((field) => field.name !== "region"),
    { name: "workgroup", label: "Workgroup name", placeholder: "analytics", hint: "The serverless workgroup name, without an ARN or URL." },
    { name: "clusterIdentifier", label: "Cluster identifier", placeholder: "analytics-cluster" },
    { name: "database", label: "Database", placeholder: "dev" },
    { name: "databaseUser", label: "Database user (optional)", placeholder: "report_reader", hint: "Leave blank to use the database identity derived from IAM." }
  ],
  setup: { url: "https://docs.aws.amazon.com/redshift/latest/mgmt/data-api.html", steps: [
    "Select the warehouse's account and region in Amazon Redshift, then copy its serverless workgroup name or provisioned cluster identifier and database name.",
    "Grant only the Data API actions your app uses: ListDatabases, ListSchemas, ListTables, DescribeTable, ExecuteStatement, DescribeStatement, GetStatementResult and CancelStatement. Serverless also needs redshift-serverless:GetCredentials; provisioned IAM users need redshift:GetClusterCredentialsWithIAM, or redshift:GetClusterCredentials for an explicit database user. Database grants control which SQL it can execute.",
    "Save the configuration, then use Set credential in Env for the access key ID, secret key and any session token. Return and choose Connect account. No OAuth app or callback is needed for this shared mode. Renew temporary credential values together.",
    "Connecting lists tables in the configured database. Starting SQL requires a separate application authorization decision."
  ] }
});

export { amazonRedshiftDefinition };
