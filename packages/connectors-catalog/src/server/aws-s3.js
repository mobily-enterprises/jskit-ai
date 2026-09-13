import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { awsS3Definition } from "../shared/aws.js";
import { awsOrigin, awsOperation, awsExchange } from "./awsTransport.js";

const key = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 1024,
  validator: (value) => (Buffer.byteLength(value, "utf8") <= 1024 && !value.split("/").some((part) => part === "." || part === "..")) || "Use an object key of at most 1024 UTF-8 bytes, without standalone . or .. path segments." };
const expires = { type: "integer", min: 1, max: 900, defaultTo: 300 };
const validUrl = (result) => typeof result?.url === "string" && Number.isInteger(result.expiresInSeconds) && ["GET", "PUT"].includes(result.method);
const awsS3Provider = Object.freeze({
  ...awsS3Definition,
  apiOrigins: (settings) => [awsOrigin("s3", settings)],
  apiKey: { headers: () => ({}) },
  checkOperation: "objects.list",
  exchange: awsExchange("s3", S3Client, async (client, body, { settings, signal }) => {
    if (body.command === "ListObjectsV2") {
      const result = await client.send(new ListObjectsV2Command(body.input), { abortSignal: signal });
      if (result.Name !== settings.bucket || (result.Contents?.length || 0) > body.input.MaxKeys) {
        throw new ConnectorError("connector_response_invalid", "S3 returned an unexpected bucket or page size.", { statusCode: 502 });
      }
      return result;
    }
    const upload = body.command === "PutObject";
    const command = upload ? new PutObjectCommand(body.input) : new GetObjectCommand(body.input);
    const url = await getSignedUrl(client, command, { expiresIn: body.expiresInSeconds });
    return { url, method: upload ? "PUT" : "GET", expiresInSeconds: body.expiresInSeconds };
  }),
  operations: {
    "objects.list": awsOperation("s3", "ListObjectsV2", {
      maxKeys: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      prefix: { type: "string", noTrim: true, maxLength: 1024 },
      delimiter: { type: "string", enum: ["/"] },
      continuationToken: { type: "string", noTrim: true, minLength: 1, maxLength: 8192 }
    }, (v, s) => ({ input: { Bucket: s.bucket, MaxKeys: v.maxKeys, EncodingType: "url",
      ...(v.prefix === undefined ? {} : { Prefix: v.prefix }), ...(v.delimiter ? { Delimiter: v.delimiter } : {}),
      ...(v.continuationToken ? { ContinuationToken: v.continuationToken } : {}) } }),
    (r) => typeof r?.Name === "string" && typeof r.IsTruncated === "boolean" && Number.isInteger(r.KeyCount) && r.KeyCount >= 0 &&
      (!r.IsTruncated || typeof r.NextContinuationToken === "string" && r.NextContinuationToken.length > 0) &&
      (r.Contents === undefined || Array.isArray(r.Contents) && r.Contents.every((o) => typeof o.Key === "string" && Number.isInteger(o.Size) && o.Size >= 0)) &&
      (r.CommonPrefixes === undefined || Array.isArray(r.CommonPrefixes) && r.CommonPrefixes.every((p) => typeof p.Prefix === "string")), ["read"]),
    "objects.downloadUrl": awsOperation("s3", "GetObject", { key, expiresInSeconds: expires },
      (v, s) => ({ input: { Bucket: s.bucket, Key: v.key }, expiresInSeconds: v.expiresInSeconds }), validUrl, ["read"]),
    "objects.uploadUrl": awsOperation("s3", "PutObject", { key, expiresInSeconds: expires },
      (v, s) => ({ input: { Bucket: s.bucket, Key: v.key }, expiresInSeconds: v.expiresInSeconds }), validUrl, ["write"])
  }
});

export { awsS3Provider };
