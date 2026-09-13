import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { wordpressSelfHostedDefinition } from "../shared/wordpress.js";
import { jsonOperation } from "./jsonOperation.js";

const baseUrl = (settings) => `${settings.siteUrl.replace(/\/+$/u, "")}/wp-json/wp/v2`;
const id = { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER, required: true };
const view = { type: "string", enum: ["view", "edit", "embed"], defaultTo: "view" };
const status = { type: "string", enum: ["publish", "draft", "pending", "private"] };
const contentRecord = (value) => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.title?.rendered === "string";
const contentFields = {
  title: { type: "string", maxLength: 10000, noTrim: true },
  content: { type: "string", maxLength: 1000000, noTrim: true },
  excerpt: { type: "string", maxLength: 100000, noTrim: true },
  slug: { type: "string", minLength: 1, maxLength: 200 },
  status,
  featured_media: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
  comment_status: { type: "string", enum: ["open", "closed"] }
};
function wordpressOperation(resource, fields, method, validateResult, { write = false } = {}) {
  const schema = createSchema(fields);
  return { scopes: [], request(input, settings) {
    const { id: resourceId, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const url = new URL(`${baseUrl(settings)}/${resource}${resourceId ? `/${resourceId}` : ""}`);
    if (write) {
      if (!Object.keys(values).length) throw new ConnectorError("connector_input_invalid", "Supply at least one change.", { statusCode: 422 });
      return { method, url: url.href, body: values };
    }
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
    if (method === "DELETE" && !url.searchParams.has("force")) url.searchParams.set("force", "false");
    return { method, url: url.href };
  }, validateResult };
}
const contentOperations = Object.fromEntries(["posts", "pages"].flatMap((resource) => {
  const fields = { ...contentFields, ...(resource === "pages" ? {
    parent: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
    menu_order: { type: "integer", min: -2147483648, max: 2147483647 }
  } : {}) };
  return [
    [`${resource}.get`, wordpressOperation(resource, { id, context: view }, "GET", contentRecord)],
    [`${resource}.create`, wordpressOperation(resource, { ...fields,
      title: { ...fields.title, required: true, minLength: 1 }, status: { ...status, defaultTo: "draft" }
    }, "POST", contentRecord, { write: true })],
    [`${resource}.update`, wordpressOperation(resource, { id, ...fields }, "POST", contentRecord, { write: true })],
    [`${resource}.trash`, wordpressOperation(resource, { id }, "DELETE",
      value => contentRecord(value) && value.status === "trash")]
  ];
}));
const listFields = {
  page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
  per_page: { type: "integer", min: 1, max: 100, defaultTo: 10 },
  search: { type: "string", minLength: 1, maxLength: 500 }, context: view
};
const mediaRecord = (value) => contentRecord(value) && typeof value.source_url === "string";
const userRecord = (value) => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.name === "string" &&
  typeof value.slug === "string" && !Object.hasOwn(value, "password");
const permanent = { type: "boolean", required: true, validator: value => value === true || "Explicitly confirm permanent deletion with force: true." };
const mediaFields = {
  title: contentFields.title,
  caption: contentFields.excerpt,
  description: contentFields.content,
  alt_text: { type: "string", maxLength: 10000, noTrim: true },
  post: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER }
};
const uploadSchema = createSchema({ ...mediaFields,
  filename: { type: "string", required: true, minLength: 1, maxLength: 255,
    validator: value => !/[\\/\p{Cc}"]/u.test(value) && ![".", ".."].includes(value) || "Use a filename without paths, quotes or control characters." },
  mimeType: { type: "string", required: true, maxLength: 150, pattern: "^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$" },
  contentBase64: { type: "string", required: true, minLength: 4, maxLength: 6990508, noTrim: true }
});
const userFields = {
  name: { type: "string", maxLength: 250 }, first_name: { type: "string", maxLength: 250 },
  last_name: { type: "string", maxLength: 250 }, nickname: { type: "string", maxLength: 250 },
  description: { type: "string", maxLength: 10000, noTrim: true },
  email: { type: "string", maxLength: 320, validator: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) || "Enter an email address." },
  password: { type: "string", minLength: 1, maxLength: 4096, noTrim: true },
  roles: { type: "array", items: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9_-]+$" },
    validator: values => values.length >= 1 && values.length <= 10 && new Set(values).size === values.length || "Choose one to ten distinct WordPress roles." }
};
const wordpressSelfHostedProvider = Object.freeze({
  ...wordpressSelfHostedDefinition,
  apiOrigins: (settings) => [new URL(settings.siteUrl).origin],
  apiKey: { headers: (password, settings) => ({ Authorization: `Basic ${Buffer.from(`${settings.username}:${password}`).toString("base64")}` }) },
  checkOperation: "users.me",
  operations: {
    ...contentOperations,
    "media.list": wordpressOperation("media", { ...listFields,
      media_type: { type: "string", enum: ["image", "video", "text", "application", "audio"] }
    }, "GET", value => Array.isArray(value) && value.every(mediaRecord)),
    "media.get": wordpressOperation("media", { id, context: view }, "GET", mediaRecord),
    "media.update": wordpressOperation("media", { id, ...mediaFields }, "POST", mediaRecord, { write: true }),
    "media.delete": wordpressOperation("media", { id, force: permanent }, "DELETE",
      value => value?.deleted === true && mediaRecord(value.previous)),
    "media.upload": { scopes: [], request(input, settings) {
      const { filename, mimeType, contentBase64, ...metadata } = validateSchemaPayload({ schema: uploadSchema, mode: "replace" }, input, { statusCode: 422 });
      const bytes = Buffer.from(contentBase64, "base64");
      if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString("base64") !== contentBase64) {
        throw new ConnectorError("connector_input_invalid", "Supply canonical base64 for a nonempty file of at most 5 MiB.", { statusCode: 422 });
      }
      const body = new FormData();
      body.append("file", new Blob([bytes], { type: mimeType }), filename);
      for (const [name, value] of Object.entries(metadata)) body.append(name, String(value));
      return { method: "POST", url: `${baseUrl(settings)}/media`, body };
    }, validateResult: mediaRecord },
    "users.list": wordpressOperation("users", listFields, "GET", value => Array.isArray(value) && value.every(userRecord)),
    "users.get": wordpressOperation("users", { id, context: view }, "GET", userRecord),
    "users.create": wordpressOperation("users", { ...userFields,
      username: { type: "string", required: true, minLength: 1, maxLength: 60, pattern: "^[^:\\s]+$" },
      email: { ...userFields.email, required: true }, password: { ...userFields.password, required: true },
      roles: { ...userFields.roles, required: true }
    }, "POST", userRecord, { write: true }),
    "users.update": wordpressOperation("users", { id, ...userFields }, "POST", userRecord, { write: true }),
    "users.delete": wordpressOperation("users", { id, force: permanent, reassign: id }, "DELETE",
      value => value?.deleted === true && userRecord(value.previous)),
    "pages.list": wordpressOperation("pages", {
      page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
      per_page: { type: "integer", min: 1, max: 100, defaultTo: 10 },
      search: { type: "string", minLength: 1, maxLength: 500 },
      context: view, status: { ...status, defaultTo: "publish" }
    }, "GET", value => Array.isArray(value) && value.every(contentRecord)),
    "users.me": jsonOperation((settings) => `${baseUrl(settings)}/users/me`, {},
      (result) => Number.isInteger(result?.id) && result.id > 0 && typeof result.name === "string" && typeof result.slug === "string"),
    "posts.list": jsonOperation((settings) => `${baseUrl(settings)}/posts`, {
      page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
      per_page: { type: "integer", min: 1, max: 100, defaultTo: 10 },
      search: { type: "string", minLength: 1, maxLength: 500 },
      status: { type: "string", enum: ["publish", "future", "draft", "pending", "private"], defaultTo: "publish" },
      context: { type: "string", enum: ["view", "edit", "embed"], defaultTo: "view" }
    }, (result) => Array.isArray(result) && result.every((post) => Number.isInteger(post?.id) && post.id > 0 && typeof post.title?.rendered === "string"))
  }
});

export { wordpressSelfHostedProvider };
