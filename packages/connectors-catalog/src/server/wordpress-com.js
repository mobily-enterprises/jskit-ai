import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { wordpressComDefinition } from "../shared/wordpress-com.js";
import { jsonOperation } from "./jsonOperation.js";

const postsSchema = createSchema({
  siteId: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  number: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  page_handle: { type: "string", minLength: 1, maxLength: 4096 },
  search: { type: "string", minLength: 1, maxLength: 500 },
  status: { type: "string", enum: ["publish", "private", "draft", "pending", "future", "trash", "any"], defaultTo: "publish" },
  context: { type: "string", enum: ["display", "edit"], defaultTo: "display" },
  type: { type: "string", enum: ["post", "page"] }
});

const resourceId = { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER };
const batchSchema = createSchema({
  siteId: resourceId,
  resources: { type: "array", required: true, items: { type: "string", enum: ["posts", "media", "comments", "categories", "tags", "stats"] },
    validator: values => values.length >= 1 && values.length <= 6 && new Set(values).size === values.length || "Select one to six distinct site resources." }
});
const editContext = { type: "string", enum: ["display", "edit"], defaultTo: "edit" };
const contentFields = {
  title: { type: "string", noTrim: true, maxLength: 10000 },
  content: { type: "string", noTrim: true, maxLength: 1000000 },
  excerpt: { type: "string", noTrim: true, maxLength: 100000 },
  slug: { type: "string", minLength: 1, maxLength: 200 },
  status: { type: "string", enum: ["draft", "pending", "publish", "private"] },
  type: { type: "string", enum: ["post", "page"] },
  parent: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
  categories: { type: "array", items: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER }, validator: values => values.length <= 100 || "Use at most 100 category IDs." },
  tags: { type: "array", items: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER }, validator: values => values.length <= 100 || "Use at most 100 tag IDs." },
  featured_image: { type: "string", maxLength: 20, validator: value => value === "" || /^[1-9][0-9]*$/u.test(value) || "Use an attachment ID or an empty string to clear it." },
  publicize: { type: "boolean" }
};
const postRecord = value => Number.isSafeInteger(value?.ID) && value.ID > 0 &&
  Number.isSafeInteger(value.site_ID) && value.site_ID > 0 && typeof value.title === "string" && typeof value.status === "string";
function siteOperation(action, fields, { resource = "posts", scope = resource, read = false, changesRequired = false, collection = false, validateResult = postRecord } = {}) {
  const schema = createSchema({ siteId: resourceId, ...fields, context: editContext });
  return {
    scopes: [scope],
    request(input) {
      const { siteId, postId, mediaId, commentId, termSlug, context, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      delete values.confirmDeletion;
      if (changesRequired && !Object.keys(values).length) {
        throw new ConnectorError("connector_input_invalid", "Supply at least one change.", { statusCode: 422 });
      }
      const target = termSlug === undefined ? postId ?? mediaId ?? commentId ?? (collection ? "" : "new") : `slug:${encodeURIComponent(termSlug)}`;
      const url = new URL(`https://public-api.wordpress.com/rest/v1.1/sites/${siteId}/${resource}/${target}${action ? `/${action}` : ""}`);
      url.searchParams.set("context", context);
      if (read) {
        for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
        return { method: "GET", url: url.href };
      }
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(values)) body.set(key, String(value));
      return { method: "POST", url: url.href, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() };
    },
    validateResult
  };
}

const mediaRecord = value => Number.isSafeInteger(value?.ID) && value.ID > 0 && typeof value.URL === "string" && typeof value.title === "string";
const commentRecord = value => Number.isSafeInteger(value?.ID) && value.ID > 0 && typeof value.content === "string" && typeof value.status === "string";
const commentOptions = { resource: "comments", validateResult: commentRecord };
const commentText = { type: "string", required: true, minLength: 1, maxLength: 100000, noTrim: true };
const termRecord = value => Number.isSafeInteger(value?.ID) && value.ID > 0 && typeof value.name === "string" && typeof value.slug === "string";
const termSlug = { type: "string", required: true, minLength: 1, maxLength: 600,
  validator: value => !/[\\/\p{Cc}]/u.test(value) && ![".", ".."].includes(value) || "Use a term slug, not a path." };
const taxonomyOperations = Object.fromEntries(["categories", "tags"].flatMap(resource => {
  const fields = {
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 100000, noTrim: true },
    ...(resource === "categories" ? { parent: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER } } : {})
  };
  const options = { resource, scope: "taxonomy", validateResult: termRecord };
  return [
    [`${resource}.list`, siteOperation("", {
      number: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
      search: { type: "string", minLength: 1, maxLength: 500 }
    }, { ...options, read: true, collection: true,
      validateResult: value => Number.isSafeInteger(value?.found) && value.found >= 0 && Array.isArray(value[resource]) && value[resource].every(termRecord) })],
    [`${resource}.get`, siteOperation("", { termSlug }, { ...options, read: true })],
    [`${resource}.create`, siteOperation("", { ...fields, name: { ...fields.name, required: true } }, options)],
    [`${resource}.update`, siteOperation("", { termSlug, ...fields }, { ...options, changesRequired: true })],
    [`${resource}.delete`, siteOperation("delete", {
      termSlug, confirmDeletion: { type: "boolean", required: true, validator: value => value === true || "Confirm removal of this category or tag." }
    }, options)]
  ];
}));
const mediaOptions = { resource: "media", validateResult: mediaRecord };
const mediaFields = {
  title: contentFields.title, caption: contentFields.excerpt, description: contentFields.content,
  alt: { type: "string", maxLength: 10000, noTrim: true },
  parent_id: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER }
};
const mediaUploadSchema = createSchema({
  siteId: resourceId, ...mediaFields,
  filename: { type: "string", required: true, minLength: 1, maxLength: 255,
    validator: value => !/[\\/\p{Cc}"]/u.test(value) && ![".", ".."].includes(value) || "Use a filename without paths, quotes or control characters." },
  mimeType: { type: "string", required: true, maxLength: 150, pattern: "^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$" },
  contentBase64: { type: "string", required: true, minLength: 4, maxLength: 6990508, noTrim: true }
});

const wordpressComProvider = Object.freeze({
  ...wordpressComDefinition,
  oauth: {
    issuer: "https://public-api.wordpress.com",
    authorization_endpoint: "https://public-api.wordpress.com/oauth2/authorize",
    token_endpoint: "https://public-api.wordpress.com/oauth2/token"
  },
  scopeSeparator: ",",
  apiOrigins: ["https://public-api.wordpress.com"], checkOperation: "profile.read",
  grantedScopesFromVerification(profile, { clientId }) {
    if (String(profile.token_client_id) !== clientId) {
      throw new ConnectorError("connector_response_invalid", "The verified token belongs to a different application.", { statusCode: 502 });
    }
    return profile.token_scope;
  },
  operations: {
    ...taxonomyOperations,
    "batch.read": {
      scopes: ["batch"],
      request(input) {
        const { siteId, resources } = validateSchemaPayload({ schema: batchSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL("https://public-api.wordpress.com/rest/v1.3/batch/");
        for (const resource of resources) {
          url.searchParams.append("urls[]", `/sites/${siteId}/${resource}?context=edit${resource === "stats" ? "" : "&number=20"}`);
        }
        return { method: "GET", url: url.href };
      },
      validateResult: value => value !== null && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).length > 0 && Object.values(value).every(entry => entry !== null && typeof entry === "object")
    },
    "stats.read": siteOperation("", {}, {
      resource: "stats", read: true, collection: true,
      validateResult: value => typeof value?.date === "string" && value.stats !== null && typeof value.stats === "object" &&
        value.visits !== null && typeof value.visits === "object"
    }),
    "comments.list": siteOperation("", {
      number: { type: "integer", min: 1, max: 100, defaultTo: 20 },
      page: { type: "integer", min: 1, max: 100000, defaultTo: 1 },
      status: { type: "string", enum: ["approved", "unapproved", "spam", "trash", "all"], defaultTo: "approved" },
      order: { type: "string", enum: ["ASC", "DESC"], defaultTo: "DESC" }
    }, { ...commentOptions, read: true, collection: true,
      validateResult: value => Number.isSafeInteger(value?.found) && value.found >= 0 && Array.isArray(value.comments) && value.comments.every(commentRecord) }),
    "comments.get": siteOperation("", { commentId: resourceId }, { ...commentOptions, read: true }),
    "comments.create": siteOperation("replies/new", { postId: resourceId, content: commentText }, {
      resource: "posts", scope: "comments", validateResult: commentRecord
    }),
    "comments.reply": siteOperation("replies/new", { commentId: resourceId, content: commentText }, commentOptions),
    "comments.update": siteOperation("", {
      commentId: resourceId, content: { ...commentText, required: false },
      status: { type: "string", required: true, enum: ["approved", "unapproved", "spam", "unspam", "trash", "untrash"] }
    }, commentOptions),
    "comments.delete": siteOperation("delete", {
      commentId: resourceId,
      confirmDeletion: { type: "boolean", required: true, validator: value => value === true || "Confirm deletion, which may permanently remove the comment." }
    }, commentOptions),
    "posts.get": siteOperation("", { postId: resourceId }, { read: true }),
    "posts.create": siteOperation("", {
      ...contentFields,
      title: { ...contentFields.title, required: true, minLength: 1 },
      status: { ...contentFields.status, defaultTo: "draft" },
      type: { ...contentFields.type, defaultTo: "post" },
      publicize: { ...contentFields.publicize, defaultTo: false }
    }),
    "posts.update": siteOperation("", { ...contentFields, postId: resourceId }, { changesRequired: true }),
    "posts.delete": siteOperation("delete", {
      postId: resourceId,
      confirmDeletion: { type: "boolean", required: true, validator: value => value === true || "Confirm deletion, which may be permanent on this site or for an already-trashed post." }
    }),
    "posts.restore": siteOperation("restore", { postId: resourceId }),
    "media.list": siteOperation("", {
      number: { type: "integer", min: 1, max: 100, defaultTo: 20 },
      page_handle: { type: "string", minLength: 1, maxLength: 4096 },
      search: { type: "string", minLength: 1, maxLength: 500 },
      post_ID: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER },
      mime_type: { type: "string", minLength: 1, maxLength: 150 }
    }, { ...mediaOptions, read: true, collection: true,
      validateResult: value => Number.isSafeInteger(value?.found) && value.found >= 0 && Array.isArray(value.media) && value.media.every(mediaRecord) &&
        (value.meta?.next_page == null || typeof value.meta.next_page === "string") }),
    "media.get": siteOperation("", { mediaId: resourceId }, { ...mediaOptions, read: true }),
    "media.update": siteOperation("", { mediaId: resourceId, ...mediaFields }, { ...mediaOptions, changesRequired: true }),
    "media.delete": siteOperation("delete", {
      mediaId: resourceId,
      confirmDeletion: { type: "boolean", required: true, validator: value => value === true || "Confirm permanent media deletion." }
    }, { ...mediaOptions, validateResult: value => mediaRecord(value) && value.status === "deleted" }),
    "media.upload": {
      scopes: ["media"],
      request(input) {
        const { siteId, filename, mimeType, contentBase64, ...metadata } = validateSchemaPayload({ schema: mediaUploadSchema, mode: "replace" }, input, { statusCode: 422 });
        const bytes = Buffer.from(contentBase64, "base64");
        if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString("base64") !== contentBase64) {
          throw new ConnectorError("connector_input_invalid", "Supply canonical base64 for a nonempty file of at most 5 MiB.", { statusCode: 422 });
        }
        const body = new FormData();
        body.append("media[0]", new Blob([bytes], { type: mimeType }), filename);
        for (const [key, value] of Object.entries(metadata)) body.append(`attrs[0][${key}]`, String(value));
        return { method: "POST", url: `https://public-api.wordpress.com/rest/v1.1/sites/${siteId}/media/new?context=edit`, body };
      },
      validateResult: value => Array.isArray(value?.media) && value.media.every(mediaRecord) &&
        (value.media_errors == null || Array.isArray(value.media_errors) || typeof value.media_errors === "object")
    },
    "profile.read": {
      ...jsonOperation("https://public-api.wordpress.com/rest/v1.1/me?fields=ID,username,display_name,token_scope,token_client_id,token_site_id", {},
        (result) => Number.isSafeInteger(result?.ID) && result.ID > 0 && typeof result.username === "string" &&
          typeof result.display_name === "string" && Number.isSafeInteger(result.token_client_id) && result.token_client_id > 0 &&
          Number.isSafeInteger(result.token_site_id) && result.token_site_id >= 0 &&
          Array.isArray(result.token_scope) && result.token_scope.every((scope) => typeof scope === "string" && scope.length > 0)),
      scopes: ["users"]
    },
    "sites.list": {
      ...jsonOperation("https://public-api.wordpress.com/rest/v1.1/me/sites", {
        site_visibility: { type: "string", enum: ["all", "visible", "hidden"], defaultTo: "all" },
        site_activity: { type: "string", enum: ["all", "active", "inactive"], defaultTo: "all" }
      }, (result) => Array.isArray(result?.sites) && result.sites.every((site) => Number.isSafeInteger(site?.ID) && site.ID > 0 && typeof site.URL === "string")),
      scopes: ["sites"]
    },
    "posts.list": {
      scopes: ["posts"],
      request(input) {
        const { siteId, ...values } = validateSchemaPayload({ schema: postsSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL(`https://public-api.wordpress.com/rest/v1.1/sites/${siteId}/posts/`);
        for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
        return { method: "GET", url: url.href };
      },
      validateResult: (result) => Number.isSafeInteger(result?.found) && result.found >= 0 && Array.isArray(result.posts) &&
        result.posts.every((post) => Number.isSafeInteger(post?.ID) && post.ID > 0 && typeof post.title === "string") &&
        (result.meta?.next_page == null || typeof result.meta.next_page === "string")
    }
  }
});
export { wordpressComProvider };
