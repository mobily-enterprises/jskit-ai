# AWS S3

Import `awsS3Provider` from `@jskit-ai/connectors-catalog/server/aws-s3` and use
`createConnectionService` or the ordinary JSKIT connector Feature. The shared
catalogue definition drives Vibe64's form. Runtime state can use encrypted JSON
files; no database or generated application is required.

## Portable configuration

```json
{
  "schemaVersion": 1,
  "registrations": {},
  "integrations": {
    "files": {
      "provider": "aws-s3",
      "displayName": "Application files",
      "accountMode": "shared",
      "scopes": ["read"],
      "authentication": {
        "method": "api-key",
        "secretRef": "env:AWS_SECRET_ACCESS_KEY"
      },
      "settings": {
        "region": "ap-southeast-2",
        "bucket": "my-app-files",
        "accessKeyIdRef": "env:AWS_ACCESS_KEY_ID"
      }
    }
  }
}
```

Optional `settings.sessionTokenRef` binds temporary credentials. The form
initially selects read and write, matching the captured two-permission setup;
remove write for a reader. Read access is mandatory: the configuration validator
rejects its absence and the editor keeps that checkbox selected and disabled.
These are local operation limits, not an IAM grant.
The returned `grantedScopes` remains empty because AWS did not issue OAuth
consent. `assistant` ownership is also supported; neither mode represents a
separate AWS account for each end user.

## Administrator setup

1. Open **Amazon S3 > General purpose buckets** in the intended AWS account.
   Select an existing bucket, or choose **Create bucket**, select the region,
   supply a valid unique bucket name and create it. Retain blocked public access
   and disabled ACLs unless your application specifically requires otherwise.
2. Copy the bucket name and its region into the form. This fragment supports the
   18 regions listed by its shared definition, using the commercial AWS
   partition and general purpose buckets in the shared global namespace.
3. Give the backend identity `s3:ListBucket` on the bucket ARN and
   `s3:GetObject` on the permitted object ARNs. Add `s3:PutObject` only for uploads.
   Encryption or cross-account policies can require additional permissions.
4. Follow [AWS credential setup](aws-credentials.md). Store references in the
   form, save the file, then let the runtime call `connectApiKey`.
5. For browser fetches or uploads, open the bucket's **Permissions** tab. Under
   **Cross-origin resource sharing (CORS)** choose **Edit**, add the app's exact
   origins and needed methods/headers, then **Save changes**. Add a verified
   custom-domain origin when it becomes active. CORS does not grant object access.

For the native Fetch example, this is a starting CORS document. Replace the
illustrative origin with the application's real HTTPS origin, without a path
or trailing slash. Remove PUT for a download-only app. Preserve any existing
rules required by other applications using the bucket.

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

If your upload code adds checksum or other request headers, list those headers
too. A server-side transfer does not require browser CORS. Keep the AWS keys on
the server; the browser receives only the URL for its authorized object.

The [bucket API guide](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CreateBucket.html)
explains bucket types, regions and public-access settings. Browser setup follows
[AWS's CORS instructions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html).
An authorized AI can use CreateBucket, IAM policies and
[PutBucketCors](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutBucketCors.html)
to perform these administrative steps. Provisioning is not an adapter operation.
For application-owned credentials, quota boundaries and the absence of a callback URL,
see [AWS ownership](aws-credentials.md#online-public-editor-and-independent-cli).

## Runtime operations

| Operation | Inputs | Behavior |
|---|---|---|
| `objects.list` | Optional `maxKeys` 1–1000 (default 100), `prefix`, delimiter `/`, opaque `continuationToken` | One ListObjectsV2 page in the configured bucket; also the connection check |
| `objects.downloadUrl` | Exact `key`; optional `expiresInSeconds` 1–900 (default 300) | Returns `{url, method: "GET", expiresInSeconds}` |
| `objects.uploadUrl` | Same fields; requires local `write` permission | Returns `{url, method: "PUT", expiresInSeconds}` |

Listing preserves AWS's response shape and uses `EncodingType: "url"`.
Decode the listed `Contents[].Key` and `CommonPrefixes[].Prefix` with
`decodeURIComponent` once before displaying or passing a key to a URL operation;
do not decode opaque continuation tokens. Empty pages are valid; continue using
`NextContinuationToken` when `IsTruncated` is true. See
[ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html).

Keys preserve spaces, Unicode, plus signs and literal percent signs. Keys over
1024 UTF-8 bytes, and standalone `.` or `..` path segments, are rejected to avoid
URL normalization changing object identity. These are deliberate fragment bounds
based on [AWS key behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html).
No directory buckets, access-point ARNs, alternate endpoints, multipart uploads,
version selection, delete, ACL or encryption-header operations are implemented.

Presigning is local. It does not prove that an object exists, a transfer
succeeded or IAM permits it. Use the returned method and unmodified URL without
an Authorization header. PUT sends the file body and can overwrite that key.
URLs are bearer credentials, reusable until effective expiration; temporary
credentials can expire first. Do not log them or put them in public source.
Local disconnect prevents future use through the service but cannot revoke an
already issued URL. See [presigned URL behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

The host must authorize the exact key/prefix before invocation. A shared bucket
connection alone does not isolate application users. SDK calls use one attempt,
explicit credentials and a fixed regional origin; wrong-region responses and
expired credentials remain observable. Local tests use controlled HTTP with
real SDK signing and encrypted file persistence. They do not access a live bucket
or transfer files through issued URLs.

## Application-owned file transfers

The tested [transfer example](../patterns/aws-storage-queries/example/s3-transfer.js)
composes the existing connection service with native Fetch. Copy it into an
application server module or CLI; it needs no Vibe64 process. Supply the same
authorized context and integration ID used by the service, an exact permitted
key, and a timeout/cancellation signal. The upload body is a Blob, ArrayBuffer
or typed array. Downloads return a Response whose body can be streamed to a file
or a format reader. Await body consumption before reporting completion.

```js
const response = await transferS3Object({ service, context,
  integrationId: "files", key: authorizedKey, direction: "download",
  signal: AbortSignal.timeout(60_000) });
// For a bounded JSON document; validate its schema in your application.
const document = await response.json();
```

For CSV and Parquet, preserve the response bytes and use the application's
selected CSV/Parquet reader; S3 does not interpret these formats. The
[native format example](../patterns/aws-storage-queries/example/formats/data-formats.js)
implements JSON, CSV and Parquet encoding/decoding through native libraries.
Its separate package manifest and lockfile are illustrative application
dependencies, not dependencies of the connector runtime.

Copy the `example/formats` directory to an isolated working directory, run
`npm ci --ignore-scripts`, then `npm test`. This exercises only the format
libraries; it does not generate or launch an application or contact AWS.
An existing application can instead install the listed libraries using its
normal dependency workflow and adapt `data-formats.js` into its own server code.

```js
const encoded = encodeDataFile("csv", [
  ["id", "description"], ["001", "A description, with punctuation"]
]);
await transferS3Object({ service, context, integrationId: "files",
  key: authorizedKey, direction: "upload", body: encoded,
  signal: AbortSignal.timeout(60_000) });
const downloaded = await transferS3Object({ service, context,
  integrationId: "files", key: authorizedKey, direction: "download",
  signal: AbortSignal.timeout(60_000) });
const rows = await decodeDataFile("csv", new Uint8Array(await downloaded.arrayBuffer()));
```

CSV preserves row arrays, quoting, newlines and leading zeroes; the application
decides which row is the header and validates its business schema. Parquet
encoding accepts explicit native `{name, type, data}` columns; decoding returns
row objects. The example uses in-memory parsing with an 8 MiB input limit.
That limit is checked after download and is not a network-transfer or decompressed
memory limit. Large or untrusted datasets need the application's bounded stream,
row/column selection and resource policy. Other Parquet codecs and schemas should
use the native reader's documented options rather than a new connector API.

The example refuses redirects, omits cookies, sends no Authorization header,
and does not retry transfers. A failed PUT connection can mean an unknown
outcome: inspect the intended object before deciding to repeat the upload.
HTTP failures remain failures even when URL signing succeeded. A stream can
also fail after receiving successful response headers. Follow the provider's
[upload instructions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
when using a URL in another framework or a browser.

Controlled tests exercise real SDK signing followed by fixture GET/PUT
transfers, binary chunk consumption, transfer errors and denied authorization.
Separate format checks exercise JSON, quoted CSV and typed nullable Parquet
content with the real libraries. Neither suite establishes live AWS interoperability.
