import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";

const graphOrigin = "https://graph.microsoft.com";
const pageSize = { type: "integer", min: 1, max: 100, defaultTo: 25 };
const driveItemId = {
  type: "string", required: true, minLength: 1, maxLength: 1024,
  validator: (value) => /^[a-zA-Z0-9_!-]+$/u.test(value) || "Enter the drive item's ID, not a file URL or path."
};

function graphRead(permission, fields, destination) {
  const schema = createSchema({ ...fields, nextLink: { type: "string", minLength: 1, maxLength: 16384 } });
  return {
    scopes: [permission],
    validateResult: (value) => Array.isArray(value?.value) &&
      (value["@odata.nextLink"] === undefined || typeof value["@odata.nextLink"] === "string"),
    request(input) {
      const params = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const { pathname, query = {} } = destination(params);
      const url = new URL(`/v1.0${pathname}`, graphOrigin);
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      if (!params.nextLink) return { method: "GET", url: url.href };
      // Graph owns the opaque paging query. A continuation must stay on this operation's resource.
      const continuation = createSchema({ nextLink: {
        type: "string", required: true,
        validator(value) {
          try {
            const next = new URL(value);
            return (next.origin === url.origin && next.pathname === url.pathname &&
              !next.username && !next.password && !next.hash) || "Use the next link returned for this operation and resource.";
          } catch { return "Use the next link returned for this operation and resource."; }
        }
      } });
      validateSchemaPayload({ schema: continuation, mode: "replace" }, { nextLink: params.nextLink }, { statusCode: 422 });
      return { method: "GET", url: params.nextLink };
    }
  };
}

function microsoftProvider(definition, authority, checkOperation, operations) {
  return Object.freeze({
    ...definition,
    oauth: ({ tenantId = authority } = {}) => ({
      issuer: "https://login.microsoftonline.com/{tenantid}/v2.0",
      authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      token_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
    }),
    authorizationParameters: { response_mode: "query" }, apiOrigins: [graphOrigin], checkOperation, operations
  });
}

function microsoftDocumentProvider(definition, extensions) {
  const fields = "id,name,size,webUrl,file,folder,parentReference,lastModifiedDateTime,eTag";
  const facet = (value) => value === undefined || (value !== null && typeof value === "object" && !Array.isArray(value));
  const metadata = (value) => typeof value?.id === "string" && value.id.length > 0 &&
    typeof value.name === "string" && value.name.length > 0 && facet(value.file) && facet(value.folder);
  const matches = (value) => value?.file && extensions.includes(value.name.split(".").at(-1).toLowerCase());
  const list = graphRead("Files.Read", { pageSize, folderId: { ...driveItemId, required: false } }, (params) => ({
    pathname: params.folderId ? `/me/drive/items/${encodeURIComponent(params.folderId)}/children` : "/me/drive/root/children",
    query: { $top: params.pageSize, $select: fields }
  }));
  const itemSchema = createSchema({ itemId: driveItemId });
  const provider = microsoftProvider(definition, "common", "items.list", {
    "items.list": { ...list, validateResult: (value) => list.validateResult(value) && value.value.every(metadata) },
    "items.get": { scopes: ["Files.Read"], validateResult: metadata, request(input) {
      const { itemId } = validateSchemaPayload({ schema: itemSchema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`/v1.0/me/drive/items/${encodeURIComponent(itemId)}`, graphOrigin);
      url.searchParams.set("$select", fields);
      return { method: "GET", url: url.href };
    } }
  });
  return Object.freeze({ ...provider, async exchange(address, options, { request }) {
    const result = await request(address, options);
    if (new URL(address).pathname.endsWith("/children")) {
      if (!provider.operations["items.list"].validateResult(result)) {
        throw new ConnectorError("connector_response_invalid", "Microsoft returned an invalid file list.", { statusCode: 502 });
      }
      return { ...result, value: result.value.filter((item) => item.folder || matches(item)) };
    }
    if (!metadata(result)) throw new ConnectorError("connector_response_invalid", "Microsoft returned invalid file metadata.", { statusCode: 502 });
    if (!matches(result)) throw new ConnectorError("connector_document_type_invalid", `Choose a ${definition.name} file.`);
    return result;
  } });
}
export { graphRead, microsoftProvider, microsoftDocumentProvider, pageSize, driveItemId };
