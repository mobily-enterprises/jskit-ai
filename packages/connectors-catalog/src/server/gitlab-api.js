import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { gitlabApiDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const origin = (settings = {}) => new URL(settings.instanceUrl || "https://gitlab.com").origin;

const pageFields = { per_page: { type: "integer", min: 1, max: 100, defaultTo: 20 }, page: { type: "integer", min: 1, max: 1000000, defaultTo: 1 } };
const iidField = { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER };
const changes = { title: { type: "string", minLength: 1, maxLength: 255 }, description: { type: "string", maxLength: 65536 }, state_event: { type: "string", enum: ["close", "reopen"] } };
const itemResult = value => Number.isSafeInteger(value?.iid) && typeof value.title === "string";
function projectOperation(suffix, fields, validateResult, method = "GET") {
  const schema = createSchema({ project: { type: "string", required: true, minLength: 1, maxLength: 512,
    validator: value => value.split("/").every(part => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part)) || "Use a numeric project ID or full namespace/project path." }, ...fields });
  return { scopes: [], request(input, settings) {
    const { project, iid, filePath, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const tail = typeof suffix === "function" ? suffix({ iid, filePath }) : suffix;
    const url = new URL(`${origin(settings)}/api/v4/projects/${encodeURIComponent(project)}${tail}`);
    if (method === "GET") {
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
      return { method, url: url.href };
    }
    if (!Object.keys(values).length) throw new ConnectorError("connector_input_invalid", "Supply at least one change.");
    return { method, url: url.href, body: values };
  }, validateResult };
}

const gitlabApiProvider = Object.freeze({
  ...gitlabApiDefinition, apiOrigins: (settings) => [origin(settings)],
  oauth: (settings) => ({ issuer: origin(settings), authorization_endpoint: `${origin(settings)}/oauth/authorize`, token_endpoint: `${origin(settings)}/oauth/token` }),
  refreshRequiresRedirectUri: true,
  apiKey: { headers: (key) => ({ "PRIVATE-TOKEN": key }) },
  checkOperation: "profile.read",
  operations: {
    "projects.get": projectOperation("", {}, value => Number.isSafeInteger(value?.id) && typeof value.path_with_namespace === "string"),
    "branches.list": projectOperation("/repository/branches", pageFields, Array.isArray),
    "commits.list": projectOperation("/repository/commits", pageFields, Array.isArray),
    "pipelines.list": projectOperation("/pipelines", pageFields, Array.isArray),
    "files.get": projectOperation(({ filePath }) => `/repository/files/${encodeURIComponent(filePath)}`, {
      filePath: { type: "string", required: true, minLength: 1, maxLength: 4096,
        validator: value => !value.includes("\\") && value.split("/").every(part => part && part !== "." && part !== "..") || "Use a repository-relative file path." },
      ref: { type: "string", required: true, minLength: 1, maxLength: 256 }
    }, value => typeof value?.file_path === "string" && typeof value.content === "string"),
    "issues.list": projectOperation("/issues", { ...pageFields, state: { type: "string", enum: ["opened", "closed", "all"], defaultTo: "opened" }, search: { type: "string", maxLength: 256 } }, Array.isArray),
    "issues.get": projectOperation(({ iid }) => `/issues/${iid}`, { iid: iidField }, itemResult),
    "issues.notes": projectOperation(({ iid }) => `/issues/${iid}/notes`, { iid: iidField, ...pageFields }, Array.isArray),
    "issues.create": projectOperation("/issues", { title: { ...changes.title, required: true }, description: changes.description }, itemResult, "POST"),
    "issues.update": projectOperation(({ iid }) => `/issues/${iid}`, { iid: iidField, ...changes }, itemResult, "PUT"),
    "mergeRequests.list": projectOperation("/merge_requests", { ...pageFields, state: { type: "string", enum: ["opened", "closed", "merged", "all"], defaultTo: "opened" } }, Array.isArray),
    "mergeRequests.get": projectOperation(({ iid }) => `/merge_requests/${iid}`, { iid: iidField }, itemResult),
    "mergeRequests.notes": projectOperation(({ iid }) => `/merge_requests/${iid}/notes`, { iid: iidField, ...pageFields }, Array.isArray),
    "mergeRequests.create": projectOperation("/merge_requests", { title: { ...changes.title, required: true }, description: changes.description,
      source_branch: { type: "string", required: true, minLength: 1, maxLength: 256 }, target_branch: { type: "string", required: true, minLength: 1, maxLength: 256 }
    }, itemResult, "POST"),
    "mergeRequests.update": projectOperation(({ iid }) => `/merge_requests/${iid}`, { iid: iidField, ...changes }, itemResult, "PUT"),
    "profile.read": jsonOperation((settings) => `${origin(settings)}/api/v4/user`, {},
      (result) => Number.isInteger(result?.id) && typeof result.username === "string"),
    "projects.list": jsonOperation((settings) => `${origin(settings)}/api/v4/projects`, {
      per_page: { type: "integer", min: 1, max: 100, defaultTo: 20 },
      page: { type: "integer", min: 1, defaultTo: 1 },
      membership: { type: "boolean", enum: [true], defaultTo: true },
      simple: { type: "boolean", enum: [true], defaultTo: true }
    }, Array.isArray)
  }
});
export { gitlabApiProvider };
