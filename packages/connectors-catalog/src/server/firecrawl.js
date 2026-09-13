import { validatedOperation } from "./jsonOperation.js";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { firecrawlDefinition } from "../shared/definitions.js";

const empty = createSchema({});
const pageUrl = {
    type: "string", required: true, minLength: 1, maxLength: 8192,
    validator(value) {
      try {
        const url = new URL(value);
        return (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) || "Use an HTTP or HTTPS page URL without credentials.";
      } catch { return "Use an HTTP or HTTPS page URL without credentials."; }
    }
};
const scrape = createSchema({ url: pageUrl,
  onlyMainContent: { type: "boolean", defaultTo: true }
});

const jobId = { type: "string", required: true, pattern: "^[A-Za-z0-9-]{1,128}$" };
const firecrawlProvider = Object.freeze({
  ...firecrawlDefinition,
  apiOrigins: ["https://api.firecrawl.dev"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "credits.read",
  operations: {
    "pages.search": validatedOperation({ query: { type: "string", required: true, minLength: 1, maxLength: 4096 },
      limit: { type: "integer", min: 1, max: 100, defaultTo: 5 }, includeContent: { type: "boolean", defaultTo: false }
    }, ({ includeContent, ...body }) => ({ method: "POST", url: "https://api.firecrawl.dev/v2/search", body: {
      ...body, sources: ["web"], ...(includeContent ? { scrapeOptions: { formats: ["markdown"] } } : {})
    } }), result => result?.success === true && Array.isArray(result.data?.web)),
    "sites.map": validatedOperation({ url: pageUrl, limit: { type: "integer", required: true, min: 1, max: 1000 }, search: { type: "string", minLength: 1, maxLength: 1000 } },
      body => ({ method: "POST", url: "https://api.firecrawl.dev/v2/map", body }), result => result?.success === true && Array.isArray(result.links)),
    "pages.extract": validatedOperation({ url: pageUrl, schema: { type: "object", required: true, additionalProperties: true,
      validator: value => JSON.stringify(value).length <= 32000 || "Use a schema below 32,000 characters." }, prompt: { type: "string", maxLength: 4000 }
    }, ({ url, schema, prompt }) => ({ method: "POST", url: "https://api.firecrawl.dev/v2/scrape", body: { url, formats: [{ type: "json", schema, ...(prompt ? { prompt } : {}) }] } }),
      result => result?.success === true && result.data != null && Object.hasOwn(result.data, "json")),
    "crawls.start": validatedOperation({ url: pageUrl, limit: { type: "integer", required: true, min: 1, max: 1000 },
      maxDiscoveryDepth: { type: "integer", min: 0, max: 10, defaultTo: 2 }
    }, body => ({ method: "POST", url: "https://api.firecrawl.dev/v2/crawl", body: { ...body,
      allowExternalLinks: false, allowSubdomains: false, scrapeOptions: { formats: ["markdown"], onlyMainContent: true }
    } }), result => result?.success === true && typeof result.id === "string"),
    "crawls.get": validatedOperation({ id: jobId, next: { type: "string", maxLength: 8192 } }, ({ id, next }) => {
      const expected = `https://api.firecrawl.dev/v2/crawl/${id}`;
      let url; try { url = new URL(next || expected); } catch { throw new ConnectorError("connector_input_invalid", "Use the returned next-page URL for this crawl."); }
      if (url.origin + url.pathname !== expected || url.username || url.password || url.hash) throw new ConnectorError("connector_input_invalid", "Use the returned next-page URL for this crawl.");
      return { method: "GET", url: url.href };
    }, result => typeof result?.status === "string" && Array.isArray(result.data) && Number.isInteger(result.total) && result.total >= 0 && Number.isInteger(result.completed) && result.completed >= 0),
    "crawls.errors": validatedOperation({ id: jobId }, ({ id }) => ({ method: "GET", url: `https://api.firecrawl.dev/v2/crawl/${id}/errors` }), result => Array.isArray(result?.errors)),
    "crawls.cancel": validatedOperation({ id: jobId }, ({ id }) => ({ method: "DELETE", url: `https://api.firecrawl.dev/v2/crawl/${id}` }), result => result?.status === "cancelled" || result?.success === true),
    "credits.read": {
      scopes: [],
      request(input) {
        validateSchemaPayload({ schema: empty, mode: "replace" }, input, { statusCode: 422 });
        return { method: "GET", url: "https://api.firecrawl.dev/v2/team/credit-usage" };
      },
      validateResult: (result) => result?.success === true && Number.isFinite(result.data?.remainingCredits)
    },
    "pages.scrape": {
      scopes: [],
      request(input) {
        const body = validateSchemaPayload({ schema: scrape, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: "https://api.firecrawl.dev/v2/scrape", body: { ...body, formats: ["markdown"] } };
      },
      validateResult: (result) => result?.success === true && typeof result.data?.markdown === "string"
    }
  }
});
export { firecrawlProvider };
