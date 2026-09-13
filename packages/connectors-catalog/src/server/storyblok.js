import { storyblokDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const origins = {
  eu: "https://api.storyblok.com", us: "https://api-us.storyblok.com",
  ca: "https://api-ca.storyblok.com", ap: "https://api-ap.storyblok.com",
  cn: "https://app.storyblokchina.cn"
};
const contentFields = {
  version: { type: "string", enum: ["published", "draft"], defaultTo: "published" },
  language: { type: "string", maxLength: 64 },
  cv: { type: "integer", min: 0 },
  resolve_relations: { type: "string", minLength: 1, maxLength: 2048 },
  resolve_links: { type: "string", enum: ["url", "link", "story"] },
  resolve_assets: { type: "integer", enum: [0, 1] }
};
const story = (value) => Number.isSafeInteger(value?.id) && value.id > 0 &&
  value.content !== null && typeof value.content === "object" && !Array.isArray(value.content);
const getStory = jsonOperation((settings) => `${origins[settings.region]}/v2/cdn/stories`, {
  ...contentFields,
  id: { type: "string", required: true, minLength: 1, maxLength: 1024,
    validator: (value) => value.split("/").every((part) => part && part !== "." && part !== "..") || "Use a story ID or full slug without empty or relative path segments." },
  find_by: { type: "string", enum: ["uuid"] }
}, (result) => story(result?.story), "POST");
const storyblokProvider = Object.freeze({
  ...storyblokDefinition, apiOrigins: Object.values(origins),
  apiKey: { queryParameter: "token" },
  checkOperation: "space.read",
  operations: {
    "space.read": jsonOperation((settings) => `${origins[settings.region]}/v2/cdn/spaces/me`, {},
      (result) => Number.isInteger(result?.space?.id) && typeof result.space.name === "string" &&
        Array.isArray(result.space.language_codes)),
    "stories.list": jsonOperation((settings) => `${origins[settings.region]}/v2/cdn/stories`, {
      ...contentFields,
      page: { type: "integer", min: 1, max: 2147483647, defaultTo: 1 },
      per_page: { type: "integer", min: 1, max: 100, defaultTo: 25 },
      starts_with: { type: "string", maxLength: 1024 },
      search_term: { type: "string", maxLength: 1024 },
      content_type: { type: "string", maxLength: 255 },
    }, (result) => Array.isArray(result?.stories) && result.stories.every(story)),
    "stories.get": { ...getStory, request(input, settings) {
      const { url, body: { id, ...query } } = getStory.request(input, settings);
      const destination = new URL(`${url}/${id.split("/").map(encodeURIComponent).join("/")}`);
      for (const [key, value] of Object.entries(query)) destination.searchParams.set(key, String(value));
      return { method: "GET", url: destination.href };
    } }
  }
});
export { storyblokProvider };
