import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { ConnectorError } from "@jskit-ai/connectors-core/server";

const awsOrigin = (service, settings) => `https://${service}.${settings.region}.amazonaws.com`;

function awsOperation(service, command, fields, makeInput, validateResult, scopes = []) {
  const schema = createSchema(fields);
  return {
    scopes,
    request(input, settings) {
      const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: awsOrigin(service, settings), body: { command, ...makeInput(values, settings) } };
    },
    validateResult
  };
}

function awsExchange(service, Client, execute) {
  return async (endpoint, options, { settings, apiKey, resolveReference, fetchImpl }) => {
    let credentials;
    try {
      const accessKeyId = await resolveReference(settings.accessKeyIdRef);
      const sessionToken = settings.sessionTokenRef ? await resolveReference(settings.sessionTokenRef) : undefined;
      if (typeof accessKeyId !== "string" || !/^[A-Z0-9]{16,128}$/u.test(accessKeyId) || !apiKey ||
        (settings.sessionTokenRef && (typeof sessionToken !== "string" || !sessionToken || /\s/u.test(sessionToken))) ||
        (accessKeyId.startsWith("ASIA") && !sessionToken)) throw new Error("Invalid credentials");
      credentials = { accessKeyId, secretAccessKey: apiKey, ...(sessionToken ? { sessionToken } : {}) };
    } catch {
      throw new ConnectorError("connector_binding_missing", "Provide the AWS access key ID, secret access key and any required session token bindings.");
    }
    const origin = awsOrigin(service, settings);
    if (new URL(endpoint).origin !== origin) throw new ConnectorError("connector_destination_invalid", "The AWS region does not match the operation destination.");
    const client = new Client({ region: settings.region, endpoint: origin, credentials, maxAttempts: 1,
      ...(service === "s3" ? { forcePathStyle: true, followRegionRedirects: false, requestChecksumCalculation: "WHEN_REQUIRED" } : {}),
      requestHandler: new FetchHttpHandler({
        requestInit: () => ({ credentials: "omit", redirect: "error" }),
        customFetch: async (request) => {
          if (new URL(request.url).origin !== origin) throw new ConnectorError("connector_destination_invalid", "The AWS SDK selected an unexpected destination.");
          options.signal.throwIfAborted();
          return fetchImpl(request.url, { method: request.method, headers: request.headers,
            ...(request.body ? { body: await request.text() } : {}), signal: options.signal, credentials: "omit", redirect: "error" });
        }
      })
    });
    try {
      options.signal.throwIfAborted();
      const result = await execute(client, options.body, { settings, signal: options.signal });
      options.signal.throwIfAborted();
      const { $metadata, ...data } = result;
      return data;
    } catch (error) {
      options.signal.throwIfAborted();
      if (error instanceof ConnectorError || ["AbortError", "TimeoutError"].includes(error.name)) throw error;
      const status = error.$metadata?.httpStatusCode;
      if (["ExpiredToken", "ExpiredTokenException", "InvalidAccessKeyId", "InvalidClientTokenId", "UnrecognizedClientException", "InvalidToken", "SignatureDoesNotMatch"].includes(error.name) || status === 401) {
        throw new ConnectorError("connector_reconnect_required", "Renew the AWS credential bindings and connect again.", { statusCode: 401 });
      }
      if (["TooManyRequestsException", "ThrottlingException", "SlowDown", "RequestLimitExceeded", "ActiveStatementsExceededException", "ActiveSessionsExceededException", "ActiveWaitingRequestsExceededException"].includes(error.name) || status === 429) {
        throw new ConnectorError("connector_rate_limited", "The AWS request limit was reached.", { statusCode: 429 });
      }
      if (status === 403) throw new ConnectorError("connector_permission_denied", "AWS denied this operation. Check IAM, resource and database permissions.", { statusCode: 403 });
      if (status === 404 || error.name === "ResourceNotFoundException") throw new ConnectorError("connector_not_found", "The AWS resource was not found.", { statusCode: 404 });
      if (status === 301 || status === 307 || ["AuthorizationHeaderMalformed", "PermanentRedirect", "InvalidRequestException", "ValidationException"].includes(error.name)) {
        throw new ConnectorError("connector_configuration_invalid", "Check the AWS region, resource and operation settings.", { statusCode: 422 });
      }
      throw new ConnectorError("connector_provider_failed", "The AWS request failed or returned an unreadable response.", { statusCode: 502 });
    } finally {
      client.destroy();
    }
  };
}

export { awsOrigin, awsOperation, awsExchange };
