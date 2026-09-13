import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { githubApiDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

async function normalizeTokenResponse(response) {
  if (!response.ok) return response;
  let value;
  try { value = await response.clone().json(); } catch {
    throw new ConnectorError("connector_response_invalid", "GitHub returned an invalid token response.", { statusCode: 502 });
  }
  if (value.error || value.scope === undefined) return response;
  if (typeof value.scope !== "string" || !/^[a-zA-Z0-9_:.-]*(?:,[a-zA-Z0-9_:.-]+)*$/u.test(value.scope)) {
    throw new ConnectorError("connector_response_invalid", "GitHub returned an invalid permission grant.", { statusCode: 502 });
  }
  return Response.json({ ...value, scope: value.scope.replaceAll(",", " ") }, { status: response.status });
}

const repositoryFields = {
  owner: { type: "string", required: true, minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$" },
  repo: { type: "string", required: true, minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_][A-Za-z0-9_.-]*$" }
};
const pageFields = { per_page: { type: "integer", min: 1, max: 100, defaultTo: 30 }, page: { type: "integer", min: 1, max: 1000000, defaultTo: 1 } };
const numberField = { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER };
const issueResult = value => Number.isSafeInteger(value?.number) && typeof value.title === "string";
function repositoryOperation(suffix, fields, validateResult, method = "GET") {
  const schema = createSchema({ ...repositoryFields, ...fields });
  return { scopes: [], request(input) {
    const { owner, repo, number, path, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const tail = typeof suffix === "function" ? suffix({ number, path }) : suffix;
    const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${tail}`);
    if (method === "GET") {
      for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
      return { method, url: url.href };
    }
    if (!Object.keys(values).length) throw new ConnectorError("connector_input_invalid", "Supply at least one change.");
    return { method, url: url.href, body: values };
  }, validateResult };
}
const issueChanges = { title: { type: "string", minLength: 1, maxLength: 256 }, body: { type: "string", maxLength: 65536 }, state: { type: "string", enum: ["open", "closed"] } };

const githubApiProvider = Object.freeze({
  ...githubApiDefinition, apiOrigins: ["https://api.github.com"],
  apiKey: { headers: (key) => ({
    Authorization: `Bearer ${key}`, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "jskit-connectors"
  }) },
  oauth: {
    issuer: "https://github.com",
    authorization_endpoint: "https://github.com/login/oauth/authorize",
    token_endpoint: "https://github.com/login/oauth/access_token"
  },
  normalizeTokenResponse,
  oauthHeaders: () => ({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "jskit-connectors" }),
  checkOperation: "account.read",
  operations: {
    "repositories.get": repositoryOperation("", {}, value => Number.isSafeInteger(value?.id) && typeof value.full_name === "string"),
    "branches.list": repositoryOperation("/branches", pageFields, Array.isArray),
    "commits.list": repositoryOperation("/commits", pageFields, Array.isArray),
    "releases.list": repositoryOperation("/releases", pageFields, Array.isArray),
    "workflows.runs": repositoryOperation("/actions/runs", pageFields, value => Array.isArray(value?.workflow_runs)),
    "contents.get": repositoryOperation(({ path }) => `/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
      path: { type: "string", required: true, minLength: 1, maxLength: 4096,
        validator: value => !value.includes("\\") && value.split("/").every(segment => segment && segment !== "." && segment !== "..") || "Use a repository-relative file path." },
      ref: { type: "string", minLength: 1, maxLength: 256 }
    }, value => Array.isArray(value) || typeof value?.type === "string" && typeof value.path === "string"),
    "issues.list": repositoryOperation("/issues", { ...pageFields, state: { type: "string", enum: ["open", "closed", "all"], defaultTo: "open" } }, Array.isArray),
    "issues.get": repositoryOperation(({ number }) => `/issues/${number}`, { number: numberField }, issueResult),
    "issues.create": repositoryOperation("/issues", { title: { ...issueChanges.title, required: true }, body: issueChanges.body }, issueResult, "POST"),
    "issues.update": repositoryOperation(({ number }) => `/issues/${number}`, { number: numberField, ...issueChanges }, issueResult, "PATCH"),
    "pulls.list": repositoryOperation("/pulls", { ...pageFields, state: { type: "string", enum: ["open", "closed", "all"], defaultTo: "open" } }, Array.isArray),
    "pulls.reviews": repositoryOperation(({ number }) => `/pulls/${number}/reviews`, { number: numberField, ...pageFields }, Array.isArray),
    "issues.comments": repositoryOperation(({ number }) => `/issues/${number}/comments`, { number: numberField, ...pageFields }, Array.isArray),
    "pulls.get": repositoryOperation(({ number }) => `/pulls/${number}`, { number: numberField }, issueResult),
    "pulls.create": repositoryOperation("/pulls", {
      title: { ...issueChanges.title, required: true }, body: issueChanges.body,
      head: { type: "string", required: true, minLength: 1, maxLength: 256 }, base: { type: "string", required: true, minLength: 1, maxLength: 256 }, draft: { type: "boolean", defaultTo: false }
    }, issueResult, "POST"),
    "pulls.update": repositoryOperation(({ number }) => `/pulls/${number}`, { number: numberField, ...issueChanges }, issueResult, "PATCH"),
    "account.read": jsonOperation("https://api.github.com/user", {}, (result) => Number.isInteger(result?.id) && typeof result.login === "string"),
    "repositories.list": jsonOperation("https://api.github.com/user/repos", {
      per_page: { type: "integer", min: 1, max: 100, defaultTo: 30 },
      page: { type: "integer", min: 1, defaultTo: 1 },
      sort: { type: "string", enum: ["created", "updated", "pushed", "full_name"], defaultTo: "full_name" },
      direction: { type: "string", enum: ["asc", "desc"], defaultTo: "asc" }
    }, (result) => Array.isArray(result))
  }
});
export { githubApiProvider };
