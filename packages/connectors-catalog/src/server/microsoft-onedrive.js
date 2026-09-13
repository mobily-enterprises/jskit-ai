import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { microsoftOneDriveDefinition } from "../shared/microsoft.js";
import { graphRead, microsoftProvider, pageSize, driveItemId } from "./microsoft.js";

const fields = "id,name,size,webUrl,file,folder,parentReference";
const item = (value) => {
  if (typeof value?.id !== "string" || typeof value.name !== "string") return false;
  if (value["@microsoft.graph.downloadUrl"] === undefined) return true;
  try {
    const url = new URL(value["@microsoft.graph.downloadUrl"]);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch { return false; }
};
const getSchema = createSchema({ itemId: driveItemId });
const uploadSchema = createSchema({
  parentId: driveItemId,
  name: { type: "string", required: true, minLength: 1, maxLength: 255,
    validator: (value) => !/[\\/\x00-\x1f"*:<>?|]/u.test(value) && ![".", ".."].includes(value) || "Use a simple file name without reserved characters." },
  bodyBase64: { type: "string", required: true, noTrim: true, maxLength: 6666668 },
  conflictBehavior: { type: "string", enum: ["fail", "replace", "rename"], defaultTo: "fail" }
});
const base = microsoftProvider(microsoftOneDriveDefinition, "common", "items.list", {
  "items.list": graphRead("Files.Read", { pageSize, folderId: { ...driveItemId, required: false } }, ({ pageSize, folderId }) => ({
    pathname: folderId ? `/me/drive/items/${encodeURIComponent(folderId)}/children` : "/me/drive/root/children",
    query: { $top: pageSize, $select: fields }
  })),
  "items.get": { scopes: ["Files.Read"], validateResult: item, request(input) {
    const { itemId } = validateSchemaPayload({ schema: getSchema, mode: "replace" }, input, { statusCode: 422 });
    const url = new URL(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`);
    url.searchParams.set("$select", `${fields},@microsoft.graph.downloadUrl`);
    return { method: "GET", url: url.href };
  } },
  "files.upload": { scopes: ["Files.ReadWrite"], validateResult: item, request(input) {
    const { parentId, name, bodyBase64, conflictBehavior } = validateSchemaPayload({ schema: uploadSchema, mode: "replace" }, input, { statusCode: 422 });
    const body = Buffer.from(bodyBase64, "base64");
    if (body.toString("base64") !== bodyBase64 || body.length > 5_000_000) {
      throw new ConnectorError("connector_input_invalid", "Use standard padded base64 up to 5 MB; larger files need a native upload session.", { statusCode: 422 });
    }
    const url = new URL(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(name)}:/content`);
    url.searchParams.set("@microsoft.graph.conflictBehavior", conflictBehavior);
    return { method: "PUT", url: url.href, headers: { "Content-Type": "application/octet-stream" }, body };
  } }
});
const microsoftOneDriveProvider = Object.freeze({ ...base,
  async exchange(address, options, { request, fetchImpl }) {
    if (options.method !== "PUT") return request(address, options);
    const response = await fetchImpl(address, { ...options, credentials: "omit", redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error("OneDrive upload failed; inspect the folder before retrying."), { status: response.status });
    }
    return response.json();
  }
});
export { microsoftOneDriveProvider };
