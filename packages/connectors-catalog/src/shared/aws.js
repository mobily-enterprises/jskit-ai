import { createSchema } from "json-rest-schema";
import { secretReference } from "@jskit-ai/connectors-core/shared/configuration";

const regions = [
  ["us-east-1", "jskit.connectors.aws.regions.usEast1"], ["us-east-2", "jskit.connectors.aws.regions.usEast2"], ["us-west-1", "jskit.connectors.aws.regions.usWest1"], ["us-west-2", "jskit.connectors.aws.regions.usWest2"],
  ["eu-west-1", "jskit.connectors.aws.regions.euWest1"], ["eu-west-2", "jskit.connectors.aws.regions.euWest2"], ["eu-west-3", "jskit.connectors.aws.regions.euWest3"], ["eu-central-1", "jskit.connectors.aws.regions.euCentral1"],
  ["eu-north-1", "jskit.connectors.aws.regions.euNorth1"], ["ap-southeast-1", "jskit.connectors.aws.regions.apSoutheast1"], ["ap-southeast-2", "jskit.connectors.aws.regions.apSoutheast2"],
  ["ap-northeast-1", "jskit.connectors.aws.regions.apNortheast1"], ["ap-northeast-2", "jskit.connectors.aws.regions.apNortheast2"], ["ap-south-1", "jskit.connectors.aws.regions.apSouth1"],
  ["sa-east-1", "jskit.connectors.aws.regions.saEast1"], ["ca-central-1", "jskit.connectors.aws.regions.caCentral1"], ["me-south-1", "jskit.connectors.aws.regions.meSouth1"], ["af-south-1", "jskit.connectors.aws.regions.afSouth1"]
];
const awsSettings = {
  region: { type: "string", enum: regions.map(([value]) => value), defaultTo: "us-east-1" },
  accessKeyIdRef: secretReference,
  sessionTokenRef: { ...secretReference, required: false }
};
const awsFields = [
  { name: "region", label: "jskit.connectors.aws.fields.region.label", items: regions.map(([value, key]) => ({ value, title: { key, params: { region: value } } })) },
  { name: "accessKeyIdRef", environmentCredential: { label: "jskit.connectors.aws.fields.accessKeyIdRef.environmentCredential.label", public: false }, label: "jskit.connectors.aws.fields.accessKeyIdRef.label", placeholder: "env:AWS_ACCESS_KEY_ID", hint: "jskit.connectors.aws.fields.accessKeyIdRef.hint" },
  { name: "sessionTokenRef", environmentCredential: { label: "jskit.connectors.aws.fields.sessionTokenRef.environmentCredential.label", public: false }, label: "jskit.connectors.aws.fields.sessionTokenRef.label", placeholder: "env:AWS_SESSION_TOKEN", hint: "jskit.connectors.aws.fields.sessionTokenRef.hint" }
];
const awsCredentials = {
  accountModes: ["shared", "assistant"], authenticationMethods: ["api-key"],
  apiKeyReferenceLabel: "jskit.connectors.aws.credentials.apiKeyReferenceLabel",
  apiKeyReferenceHint: "jskit.connectors.aws.credentials.apiKeyReferenceHint"
};
const bucketName = {
  type: "string", required: true, minLength: 3, maxLength: 63,
  validator: (value) => (/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(value) && !value.includes("..") &&
    !/^\d+\.\d+\.\d+\.\d+$/u.test(value) && !/^(xn--|sthree-|amzn-s3-demo-)/u.test(value) &&
    !/(-s3alias|--ol-s3|\.mrap|--x-s3|--table-s3|-an)$/u.test(value)) || "Enter a general purpose S3 bucket name, not an ARN, URL or directory bucket."
};
const awsS3Definition = Object.freeze({
  id: "aws-s3", name: "AWS S3", description: "jskit.connectors.awsS3.description",
  ...awsCredentials,
  permissionsHint: "jskit.connectors.awsS3.permissionsHint",
  scopes: [
    { value: "read", label: "jskit.connectors.awsS3.scopes.read.label", required: true, recommended: true },
    { value: "write", label: "jskit.connectors.awsS3.scopes.write.label", recommended: true }
  ],
  settingsSchema: createSchema({ ...awsSettings, bucket: bucketName }),
  settingsFields: [{ name: "bucket", label: "jskit.connectors.awsS3.fields.bucket.label", placeholder: "my-app-files" }, ...awsFields],
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
  id: "aws-athena", name: "AWS Athena", description: "jskit.connectors.awsAthena.description",
  ...awsCredentials, scopes: [],
  settingsSchema: createSchema({ ...awsSettings,
    workgroup: { type: "string", minLength: 1, maxLength: 128, defaultTo: "primary", pattern: "^[a-zA-Z0-9._-]+$" },
    resultLocation: { type: "string", minLength: 1, maxLength: 1024, validator: (value) =>
      /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/(?:[^\s?#\\]*)$/u.test(value) || "Enter an s3://bucket/prefix/ location without query parameters or fragments." }
  }),
  settingsFields: [...awsFields,
    { name: "workgroup", label: "jskit.connectors.awsAthena.fields.workgroup.label", placeholder: "primary", hint: "jskit.connectors.awsAthena.fields.workgroup.hint" },
    { name: "resultLocation", label: "jskit.connectors.awsAthena.fields.resultLocation.label", placeholder: "s3://my-query-results/athena/", hint: "jskit.connectors.awsAthena.fields.resultLocation.hint" }
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
