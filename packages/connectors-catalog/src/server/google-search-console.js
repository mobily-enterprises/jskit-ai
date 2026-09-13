import { googleSearchConsoleDefinition } from "../shared/google.js";
import { googleOperation, googleRead, googleProvider } from "./google.js";
const origin = "https://searchconsole.googleapis.com";
const readScopes = ["webmasters.readonly", "webmasters"];
const website = value => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash; } catch { return false; } };
const siteUrl = { type: "string", required: true, minLength: 1, maxLength: 2048, validator: value => /^sc-domain:[A-Za-z0-9.-]+$/.test(value) || website(value) || "Copy the exact property URL or sc-domain:name from sites.list." };
const feedpath = { type: "string", required: true, minLength: 1, maxLength: 2048, validator: value => website(value) || "Use the full sitemap URL." };
const date = { type: "string", required: true, maxLength: 10, validator: value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value || "Use a valid YYYY-MM-DD date." };
const dimensions = ["date", "country", "device", "page", "query", "searchAppearance"];
const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value) && !value.error);
function propertyPath(site) { return `${origin}/webmasters/v3/sites/${encodeURIComponent(site)}`; }
const googleSearchConsoleProvider = googleProvider(googleSearchConsoleDefinition, origin, "sites.list", {
  "sites.get": googleRead(readScopes, { siteUrl }, ({ siteUrl }) => ({ url: propertyPath(siteUrl) }), value => typeof value?.siteUrl === "string" && typeof value.permissionLevel === "string"),
  "searchAnalytics.query": googleOperation(readScopes, { siteUrl, startDate: date, endDate: date,
    dimensions: { type: "array", validator: value => value.length <= dimensions.length && new Set(value).size === value.length && value.every(dimension => dimensions.includes(dimension)) || "Choose distinct supported dimensions." },
    filters: { type: "array", validator: filters => filters.length <= 100 && filters.every(filter => filter && typeof filter === "object" && !Array.isArray(filter) && Object.keys(filter).every(key => ["dimension", "operator", "expression"].includes(key)) && dimensions.includes(filter.dimension) && filter.dimension !== "date" && ["contains", "equals", "notContains", "notEquals", "includingRegex", "excludingRegex"].includes(filter.operator) && typeof filter.expression === "string" && filter.expression.length <= 4096) || "Use supported dimension/operator/expression filters." },
    type: { type: "string", enum: ["web", "image", "video", "news", "discover", "googleNews"], defaultTo: "web" },
    rowLimit: { type: "integer", min: 1, max: 25000, defaultTo: 1000 }, startRow: { type: "integer", min: 0, defaultTo: 0 }
  }, ({ siteUrl, filters, ...body }) => {
    if (body.startDate > body.endDate) throw Object.assign(new Error("startDate must not follow endDate."), { statusCode: 422 });
    return { method: "POST", url: `${propertyPath(siteUrl)}/searchAnalytics/query`, body: { ...body, dataState: "final", ...(filters?.length ? { dimensionFilterGroups: [{ groupType: "and", filters }] } : {}) } };
  }, value => plain(value) && (value.rows === undefined || Array.isArray(value.rows))),
  "urlInspection.inspect": googleOperation(readScopes, { siteUrl, inspectionUrl: { ...feedpath }, languageCode: { type: "string", minLength: 2, maxLength: 35 } }, body => ({ method: "POST", url: `${origin}/v1/urlInspection/index:inspect`, body }), value => plain(value?.inspectionResult)),
  "sitemaps.list": googleRead(readScopes, { siteUrl }, ({ siteUrl }) => ({ url: `${propertyPath(siteUrl)}/sitemaps` }), value => plain(value) && (value.sitemap === undefined || Array.isArray(value.sitemap))),
  "sitemaps.get": googleRead(readScopes, { siteUrl, feedpath }, ({ siteUrl, feedpath }) => ({ url: `${propertyPath(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}` }), value => typeof value?.path === "string"),
  "sitemaps.submit": googleOperation(["webmasters"], { siteUrl, feedpath }, ({ siteUrl, feedpath }) => ({ method: "PUT", url: `${propertyPath(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}` }), value => value === null || plain(value) && !Object.keys(value).length),
  "sitemaps.delete": googleOperation(["webmasters"], { siteUrl, feedpath }, ({ siteUrl, feedpath }) => ({ method: "DELETE", url: `${propertyPath(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}` }), value => value === null || plain(value) && !Object.keys(value).length),
  "sites.list": googleRead(["webmasters.readonly", "webmasters"], {}, () => ({ url: `${origin}/webmasters/v3/sites` }),
    (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) && !value.error && (value.siteEntry === undefined || Array.isArray(value.siteEntry))))
});
export { googleSearchConsoleProvider };
