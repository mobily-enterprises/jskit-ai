import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { xTwitterDefinition } from "../shared/x-twitter.js";

const validId = (value) => typeof value === "string" && /^[0-9]{1,19}$/u.test(value);
const validUsername = (value) => typeof value === "string" && /^[A-Za-z0-9_]{1,15}$/u.test(value);
const validCursor = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\p{Cc}]/u.test(value);
const lookupSchema = createSchema({ username: { type: "string", required: true, noTrim: true,
  validator: (value) => validUsername(value) || "Enter an X username without @, spaces or a URL." } });
const postsSchema = createSchema({
  userId: { type: "string", required: true, noTrim: true, validator: (value) => validId(value) || "Enter an X user ID as a string of 1–19 digits." },
  maxResults: { type: "integer", min: 5, max: 100, defaultTo: 10 },
  paginationToken: { type: "string", noTrim: true, validator: (value) => validCursor(value) || "Use the returned pagination token (up to 4096 characters)." }
});

const searchSchema = createSchema({
  query: { type: "string", required: true, noTrim: true,
    validator: (value) => value.trim().length > 0 && value.length <= 512 && !/[\p{Cc}]/u.test(value) || "Enter a search query of 1–512 characters without control characters." },
  maxResults: { type: "integer", min: 10, max: 100, defaultTo: 10 },
  nextToken: { type: "string", noTrim: true, validator: (value) => validCursor(value) || "Use the returned next token." }
});

const xTwitterProvider = Object.freeze({
  ...xTwitterDefinition, apiOrigins: ["https://api.x.com"],
  apiKey: { headers: (key) => {
    if (!/^[\x21-\x7e]+$/u.test(key) || key.length > 8192) {
      throw new ConnectorError("connector_binding_missing", "Use the X app-only token without spaces, control characters or a Bearer prefix.");
    }
    return { Authorization: `Bearer ${key}` };
  } },
  checkOperation: "users.lookup",
  operations: {
    "posts.searchRecent": {
      scopes: [],
      request(input) {
        const values = validateSchemaPayload({ schema: searchSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL("https://api.x.com/2/tweets/search/recent");
        url.searchParams.set("query", values.query);
        url.searchParams.set("max_results", String(values.maxResults));
        if (values.nextToken !== undefined) url.searchParams.set("next_token", values.nextToken);
        url.searchParams.set("tweet.fields", "created_at,author_id,attachments,entities,public_metrics");
        url.searchParams.set("expansions", "author_id,attachments.media_keys");
        url.searchParams.set("user.fields", "name,username,profile_image_url");
        url.searchParams.set("media.fields", "type,url,preview_image_url,alt_text");
        return { method: "GET", url: url.href };
      }
    },
    "users.lookup": {
      scopes: [],
      request(input) {
        const { username } = validateSchemaPayload({ schema: lookupSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL(`https://api.x.com/2/users/by/username/${username}`);
        url.searchParams.set("user.fields", "description,profile_image_url,public_metrics");
        return { method: "GET", url: url.href };
      }
    },
    "users.posts": {
      scopes: [],
      request(input) {
        // Snowflake IDs exceed JS's safe integer range; reject numbers before the schema can coerce them.
        if (typeof input?.userId !== "string") {
          const error = new ConnectorError("connector_input_invalid", "Pass the X user ID as a string.", { statusCode: 422 });
          error.fieldErrors = { userId: "Pass the X user ID as a string." };
          throw error;
        }
        const values = validateSchemaPayload({ schema: postsSchema, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL(`https://api.x.com/2/users/${values.userId}/tweets`);
        url.searchParams.set("max_results", String(values.maxResults));
        if (values.paginationToken !== undefined) url.searchParams.set("pagination_token", values.paginationToken);
        return { method: "GET", url: url.href };
      }
    }
  },
  async exchange(address, options, { request }) {
    let result;
    try { result = await request(address, options); } catch (error) {
      const status = Number(error?.status || error?.statusCode);
      if (status === 402) throw new ConnectorError("connector_billing_required", "Check this X application's API credits and billing access.", { statusCode: 402 });
      if (status === 404) throw new ConnectorError("connector_resource_not_found", "The X resource was not found or is not available.", { statusCode: 404 });
      throw error;
    }
    if (Array.isArray(result?.errors) && result.errors.length) {
      if (!result.data && result.errors.every((error) => [
        "https://api.x.com/2/problems/resource-not-found", "https://api.twitter.com/2/problems/resource-not-found"
      ].includes(error?.type))) {
        throw new ConnectorError("connector_resource_not_found", "The X resource was not found or is not available.", { statusCode: 404 });
      }
      throw new ConnectorError("connector_response_incomplete", "X could not return the complete requested data.", { statusCode: 502 });
    }
    const url = new URL(address);
    let valid = result && typeof result === "object" && !Array.isArray(result) &&
      (result.errors === undefined || Array.isArray(result.errors));
    if (url.pathname.startsWith("/2/users/by/username/")) {
      valid &&= validId(result.data?.id) && validUsername(result.data?.username) && typeof result.data.name === "string" &&
        result.data.username.toLowerCase() === url.pathname.split("/").at(-1).toLowerCase();
    } else {
      const count = result?.meta?.result_count;
      valid &&= Number.isSafeInteger(count) && count >= 0 && count <= Number(url.searchParams.get("max_results")) &&
        (result.data === undefined ? count === 0 : Array.isArray(result.data) && result.data.length === count &&
          result.data.every((post) => validId(post?.id) && typeof post.text === "string")) &&
        ["next_token", "previous_token"].every((field) => result.meta[field] === undefined || validCursor(result.meta[field])) &&
        ["newest_id", "oldest_id"].every((field) => result.meta[field] === undefined || validId(result.meta[field]));
    }
    if (!valid) throw new ConnectorError("connector_response_invalid", "X returned unexpected data.", { statusCode: 502 });
    return result;
  }
});

export { xTwitterProvider };
