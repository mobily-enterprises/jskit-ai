import { createServer } from "node:http";
import { AwsV4Signer } from "aws4fetch";

// S3 answers a bucket listing with at most this many keys, and says so with IsTruncated.
const LIST_PAGE_SIZE = 1000;

function escapeXml(value) {
  return String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function xmlElements(fields) {
  return Object.entries(fields).map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`).join("");
}

function errorXml(code, message, details = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error>${xmlElements({ Code: code, Message: message, ...details })}</Error>`;
}

/**
 * The request's AWS signature, worked out again from what reached the server with the credentials S3 holds, as S3
 * checks it: the headers the request says it signed, its own date, and SigV4 through aws4fetch, the signer
 * unstorage's s3 driver uses.
 * @param {import("node:http").IncomingMessage} request
 * @param {{ region: string, accessKeyId: string, secretAccessKey: string }} credentials
 */
async function checkSignature(request, { region, accessKeyId, secretAccessKey }) {
  const authorization = String(request.headers.authorization || "");
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]+)$/u
    .exec(authorization);
  if (!match) {
    return { status: 403, code: "AccessDenied", message: "Access Denied" };
  }
  const [, requestAccessKeyId, , requestRegion, signedHeaders, signature] = match;
  if (requestAccessKeyId !== accessKeyId) {
    return {
      status: 403,
      code: "InvalidAccessKeyId",
      message: "The AWS Access Key Id you provided does not exist in our records.",
      details: { AWSAccessKeyId: requestAccessKeyId }
    };
  }
  if (requestRegion !== region) {
    return {
      status: 400,
      code: "AuthorizationHeaderMalformed",
      message: `The authorization header is malformed; the region '${requestRegion}' is wrong; expecting '${region}'`,
      details: { Region: region }
    };
  }

  const headers = {};
  for (const name of signedHeaders.split(";")) {
    if (name !== "host") {
      headers[name] = String(request.headers[name] ?? "");
    }
  }
  const signer = new AwsV4Signer({
    method: request.method,
    url: `http://${request.headers.host}${request.url}`,
    headers,
    accessKeyId,
    secretAccessKey,
    region,
    service: "s3",
    datetime: String(request.headers["x-amz-date"] || "")
  });
  if ((await signer.signature()) === signature) {
    return null;
  }
  return {
    status: 403,
    code: "SignatureDoesNotMatch",
    message: "The request signature we calculated does not match the signature you provided. Check your key and signing method.",
    details: {
      AWSAccessKeyId: requestAccessKeyId,
      StringToSign: await signer.stringToSign(),
      SignatureProvided: signature,
      CanonicalRequest: await signer.canonicalString()
    }
  };
}

/**
 * A stand-in for one S3 bucket over HTTP on 127.0.0.1, enough for unstorage's s3 driver: an object's PUT, GET, HEAD
 * and DELETE, and the bucket's listing (ListObjects). It holds the objects in memory, refuses a request whose AWS
 * signature does not match the credentials it was given with S3's own error codes, and records each request, so a
 * test sees what reached the bucket and how it was answered.
 * @param {{ bucket: string, region: string, accessKeyId: string, secretAccessKey: string }} credentials
 */
async function startS3StandIn(credentials) {
  const objects = new Map();
  const requests = [];

  async function answer(request, body) {
    const refusal = await checkSignature(request, credentials);
    if (refusal) {
      return { status: refusal.status, body: errorXml(refusal.code, refusal.message, refusal.details) };
    }

    const url = new URL(request.url, "http://stand-in");
    const [bucket, ...keyParts] = url.pathname.slice(1).split("/");
    const key = decodeURIComponent(keyParts.join("/"));
    if (bucket !== credentials.bucket) {
      return { status: 404, body: errorXml("NoSuchBucket", "The specified bucket does not exist", { BucketName: bucket }) };
    }

    if (!key) {
      if (request.method !== "GET") {
        return { status: 405, body: errorXml("MethodNotAllowed", "The specified method is not allowed against this resource.") };
      }
      const prefix = url.searchParams.get("prefix") || "";
      const keys = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort();
      const page = keys.slice(0, LIST_PAGE_SIZE);
      const contents = page
        .map((name) => `<Contents>${xmlElements({ Key: name, Size: objects.get(name).length, StorageClass: "STANDARD" })}</Contents>`)
        .join("");
      return {
        status: 200,
        body:
          '<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
          xmlElements({ Name: bucket, Prefix: prefix, MaxKeys: LIST_PAGE_SIZE, IsTruncated: keys.length > page.length }) +
          `${contents}</ListBucketResult>`
      };
    }

    if (request.method === "PUT") {
      objects.set(key, body);
      return { status: 200, headers: { etag: `"${objects.size}"` } };
    }
    if (request.method === "DELETE") {
      // S3 answers 204 whether or not the object was there.
      objects.delete(key);
      return { status: 204 };
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (!objects.has(key)) {
        return { status: 404, body: request.method === "GET" ? errorXml("NoSuchKey", "The specified key does not exist.", { Key: key }) : "" };
      }
      const value = objects.get(key);
      return {
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": String(value.length) },
        body: request.method === "GET" ? value : ""
      };
    }
    return { status: 405, body: errorXml("MethodNotAllowed", "The specified method is not allowed against this resource.") };
  }

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      answer(request, Buffer.concat(chunks))
        .catch((error) => ({ status: 500, body: errorXml("InternalError", String(error?.message || error)) }))
        .then(({ status, headers = {}, body = "" }) => {
          requests.push({ method: request.method, path: request.url, status });
          response.writeHead(status, body && !headers["content-type"] ? { ...headers, "content-type": "application/xml" } : headers);
          response.end(body);
        });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());

  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    requests,
    close() {
      const closed = new Promise((resolve) => server.close(() => resolve()));
      // fetch keeps its connections open for reuse; closing them lets the server stop at once.
      server.closeAllConnections();
      return closed;
    }
  };
}

export { startS3StandIn };
