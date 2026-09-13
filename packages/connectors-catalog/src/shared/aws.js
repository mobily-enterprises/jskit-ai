import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const regions = [
  ["us-east-1", "N. Virginia"], ["us-east-2", "Ohio"], ["us-west-1", "N. California"], ["us-west-2", "Oregon"],
  ["eu-west-1", "Ireland"], ["eu-west-2", "London"], ["eu-west-3", "Paris"], ["eu-central-1", "Frankfurt"],
  ["eu-north-1", "Stockholm"], ["ap-southeast-1", "Singapore"], ["ap-southeast-2", "Sydney"],
  ["ap-northeast-1", "Tokyo"], ["ap-northeast-2", "Seoul"], ["ap-south-1", "Mumbai"],
  ["sa-east-1", "São Paulo"], ["ca-central-1", "Canada Central"], ["me-south-1", "Bahrain"], ["af-south-1", "Cape Town"]
];
const awsSettings = {
  region: { type: "string", enum: regions.map(([value]) => value), defaultTo: "us-east-1" },
  accessKeyIdRef: secretReference,
  sessionTokenRef: { ...secretReference, required: false }
};
const awsFields = [
  { name: "region", label: "AWS Region", items: regions.map(([value, title]) => ({ value, title: `${title} (${value})` })) },
  { name: "accessKeyIdRef", environmentCredential: { label: "AWS access key ID", public: false }, label: "Access key ID reference", placeholder: "env:AWS_ACCESS_KEY_ID", hint: "Store the access key ID in Env and enter its reference." },
  { name: "sessionTokenRef", environmentCredential: { label: "AWS session token", public: false }, label: "Session token reference (optional)", placeholder: "env:AWS_SESSION_TOKEN", hint: "Required with temporary STS credentials. The host must renew all three credential bindings before they expire." }
];
const awsCredentials = {
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"],
  apiKeyReferenceLabel: "Secret access key reference",
  apiKeyReferenceHint: "Use a reference such as env:AWS_SECRET_ACCESS_KEY. Credentials belong to the configured AWS account; host defaults are never used."
};
const bucketName = {
  type: "string", required: true, minLength: 3, maxLength: 63,
  validator: (value) => (/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(value) && !value.includes("..") &&
    !/^\d+\.\d+\.\d+\.\d+$/u.test(value) && !/^(xn--|sthree-|amzn-s3-demo-)/u.test(value) &&
    !/(-s3alias|--ol-s3|\.mrap|--x-s3|--table-s3|-an)$/u.test(value)) || "Enter a general purpose S3 bucket name, not an ARN, URL or directory bucket."
};
const awsS3Definition = Object.freeze({
  id: "aws-s3", name: "AWS S3", description: "List bucket objects and create short-lived download or upload URLs.",
  ...awsCredentials,
  permissionsHint: "These choices limit the application's operations. AWS IAM and bucket policies decide actual access; selecting a permission does not grant it in AWS.",
  scopes: [
    { value: "read", label: "List and download objects from bucket", required: true, recommended: true },
    { value: "write", label: "Also upload objects via pre-signed URLs", recommended: true }
  ],
  settingsSchema: createSchema({ ...awsSettings, bucket: bucketName }),
  settingsFields: [{ name: "bucket", label: "Bucket name", placeholder: "my-app-files" }, ...awsFields],
  setup: { url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html", steps: [
    "In Amazon S3, select a general purpose bucket and copy its name and region. Keep public access blocked.",
    "Use an IAM identity limited to this bucket: ListBucket and GetObject, plus PutObject only for uploads. Additional encryption permissions may be required.",
    "For an IAM-user key, sign in as that user, open the account menu > Security credentials > Access keys > Create access key. Review the alternatives, then choose Other > Next > Create access key. Copy the ID and secret before closing; the secret is shown only once. For temporary role credentials, obtain all three values from your deployment administrator.",
    "Enter env:AWS_ACCESS_KEY_ID as the access key ID reference and env:AWS_SECRET_ACCESS_KEY as the secret reference. For temporary credentials also enter env:AWS_SESSION_TOKEN; otherwise leave the session-token reference empty. Save configuration, then use each Set credential in Env link to save its actual value in this project's Env. Return here and choose Connect. No OAuth app or callback URL is needed.",
    "For browser downloads or uploads, open Amazon S3 > General purpose buckets > your bucket > Permissions > Cross-origin resource sharing (CORS) > Edit. Allow your app's exact origin, GET for downloads and PUT for uploads, and any request headers your app sends. Save changes. Add the custom-domain origin when it changes; do not make the bucket public to fix a CORS error.",
    "Connecting checks one listing page, not every object's permissions. URLs are temporary bearer credentials. If Connect fails, check bucket, region, IAM permissions and Env values; renew all three temporary credential values together when they expire, then reconnect."
  ] }
});
const awsAthenaDefinition = Object.freeze({
  id: "aws-athena", name: "AWS Athena", description: "Browse data catalogs and schemas; start, inspect, page through and cancel queries in a configured workgroup.",
  ...awsCredentials, scopes: [],
  settingsSchema: createSchema({ ...awsSettings,
    workgroup: { type: "string", minLength: 1, maxLength: 128, defaultTo: "primary", pattern: "^[a-zA-Z0-9._-]+$" },
    resultLocation: { type: "string", minLength: 1, maxLength: 1024, validator: (value) =>
      /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/(?:[^\s?#\\]*)$/u.test(value) || "Enter an s3://bucket/prefix/ location without query parameters or fragments." }
  }),
  settingsFields: [...awsFields,
    { name: "workgroup", label: "Workgroup (optional)", placeholder: "primary", hint: "Defaults to primary. Query access is restricted to this workgroup." },
    { name: "resultLocation", label: "Query result location (optional)", placeholder: "s3://my-query-results/athena/", hint: "Leave blank when the workgroup supplies its own result storage. Enforced workgroup settings take precedence." }
  ],
  setup: { url: "https://docs.aws.amazon.com/athena/latest/ug/creating-workgroups.html", steps: [
    "In the Athena console, select the region and open Workgroups in the navigation pane. Select an existing SQL workgroup, or choose Create workgroup, enter its name, choose Athena SQL and AWS Identity and Access Management (IAM) authentication. This connector does not use Spark or IAM Identity Center workgroups.",
    "For S3-backed results, set Location of query result to an existing s3://bucket/prefix/ path. Configure encryption and query scan limits; select Override client-side settings if the workgroup must enforce its settings, then Create workgroup or save your edits. Grant the backend identity athena:GetWorkGroup, athena:StartQueryExecution, athena:GetQueryExecution, athena:GetQueryResults and athena:StopQueryExecution for this workgroup, plus the necessary source-data, S3 result and encryption permissions. For browsing, also grant athena:ListDataCatalogs, athena:ListDatabases and athena:ListTableMetadata with the appropriate catalog access; Glue-backed catalogs require glue:GetDatabase, glue:GetDatabases, glue:GetTable and glue:GetTables on the allowed catalog/database/table resources.",
    "For an IAM-user key, sign in as that user, open the account menu > Security credentials > Access keys > Create access key. Review the alternatives, then choose Other > Next > Create access key. Copy the ID and secret before closing; the secret is shown only once. For temporary role credentials, obtain all three values from your deployment administrator.",
    "Enter env:AWS_ACCESS_KEY_ID as Access key ID reference and env:AWS_SECRET_ACCESS_KEY as Secret access key reference. For temporary credentials also enter env:AWS_SESSION_TOKEN. Save configuration, then use each Set credential in Env link to save the actual value in this project. Return here and choose Connect account. No OAuth app or callback URL is needed.",
    "Connecting reads workgroup metadata without running SQL. It does not prove table or result access. If connection fails, check the region, workgroup, IAM policy and Env values; renew all three temporary credential values together when expired and reconnect. Running SQL is a separate, billable operation that your application must authorize. Query failures can require catalog, source-data, result-bucket or encryption permissions even when connection succeeds."
  ] }
});

export { awsS3Definition, awsAthenaDefinition, awsSettings, awsFields, awsCredentials };
