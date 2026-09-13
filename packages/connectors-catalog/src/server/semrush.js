import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { semrushDefinition } from "../shared/semrush.js";
import { jsonOperation } from "./jsonOperation.js";

const projectsUrl = "https://api.semrush.com/apis/v4/projects/v1/projects";
const projectSchema = createSchema({ projectId: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } });
const projectName = { type: "string", required: true, minLength: 1,
  pattern: /^[^~`!#%'\^&*=\[\]\\/{}|":<>?\p{Cc}]+$/u };
const renameSchema = createSchema({
  projectId: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  project_name: projectName
});

const backlinkTarget = {
  url: { type: "string", required: true, minLength: 1, maxLength: 2000 },
  scope: { type: "string", required: true, enum: ["ROOT_DOMAIN", "SUBDOMAIN", "SUBFOLDER", "PAGE"] },
  format: { type: "string", enum: ["json"], defaultTo: "json" }
};
const backlinkPage = {
  ...backlinkTarget,
  limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
  offset: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER, defaultTo: 0 },
  order_by: { type: "string", pattern: /^[a-z_]+$/u },
  direction: { type: "string", enum: ["ASC", "DESC"], defaultTo: "DESC" },
  filter: { type: "string", minLength: 1, maxLength: 4000 }
};

const domainColumns = ["Domain", "Rank", "Organic Keywords", "Organic Traffic", "Organic Cost", "Adwords Keywords", "Adwords Traffic", "Adwords Cost"];

const keywordColumns = ["Keyword", "Position", "Search Volume", "CPC", "Competition", "Traffic (%)", "Number of Results"];

function semrushKeywordReport(target, kind) {
  const operation = jsonOperation("https://api.semrush.com/", {
    [target]: { type: "string", required: true, minLength: 1, maxLength: target === "domain" ? 253 : 2000 },
    database: { type: "string", required: true, pattern: /^[a-z]{2}$/u },
    limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
    offset: { type: "integer", min: 0, max: 3_999_999, defaultTo: 0 },
    display_sort: { type: "string", enum: ["po_asc", "po_desc", "tr_asc", "tr_desc", "nq_asc", "nq_desc"] },
    display_filter: { type: "string", minLength: 1, maxLength: 4000 },
    display_date: { type: "string", pattern: /^\d{4}(0[1-9]|1[0-2])15$/u }
  });
  return {
    scopes: [],
    request(input, settings) {
      if (!settings.v3ApiKeyRef) throw new ConnectorError("connector_binding_missing", "Configure the separate Semrush V3 API key reference for keyword reports.");
      const result = operation.request(input);
      const url = new URL(result.url);
      const limit = Number(url.searchParams.get("limit")), offset = Number(url.searchParams.get("offset"));
      if (limit + offset > 4_000_000) throw new ConnectorError("connector_input_invalid", "The requested Semrush page exceeds the provider's result window.", { statusCode: 422 });
      url.searchParams.delete("limit"); url.searchParams.delete("offset");
      url.searchParams.set("display_limit", String(limit + offset));
      url.searchParams.set("display_offset", String(offset));
      url.searchParams.set("type", `${target}_${kind}`);
      url.searchParams.set("export_columns", "Ph,Po,Nq,Cp,Co,Tr,Nr");
      url.searchParams.set("export_escape", "1"); url.searchParams.set("export_decode", "1");
      return { ...result, url: url.href };
    }
  };
}

function semrushTrackingReport(type, positions = false) {
  const operation = jsonOperation("https://api.semrush.com/", {
    campaignId: { type: "string", required: true, pattern: /^\d+(?:_\d+)?$/u, maxLength: 80 },
    ...(positions ? {
      url: { type: "string", minLength: 1, maxLength: 2000 },
      date_begin: { type: "string", pattern: /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/u },
      date_end: { type: "string", pattern: /^\d{4}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/u },
      display_limit: { type: "integer", min: 1, max: 1000, defaultTo: 10 },
      display_offset: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER, defaultTo: 0 },
      display_filter: { type: "string", minLength: 1, maxLength: 4000 }
    } : {})
  });
  return { scopes: [], request(input, settings) {
    if (!settings.v3ApiKeyRef) throw new ConnectorError("connector_binding_missing", "Configure the Semrush V3 key for position tracking.");
    const result = operation.request(input);
    const url = new URL(result.url);
    url.pathname = `/reports/v1/projects/${url.searchParams.get("campaignId")}/tracking/`;
    url.searchParams.delete("campaignId");
    if (url.searchParams.has("date_begin") && url.searchParams.has("date_end") && url.searchParams.get("date_begin") > url.searchParams.get("date_end")) {
      throw new ConnectorError("connector_input_invalid", "The tracking start date must not follow its end date.", { statusCode: 422 });
    }
    url.searchParams.set("action", "report"); url.searchParams.set("type", type);
    return { ...result, url: url.href };
  } };
}

function parseSemrushCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (char === ";" || char === "\n" || char === "\r") {
      row.push(field); field = ""; closed = false;
      if (char !== ";") { rows.push(row); row = []; if (char === "\r" && text[i + 1] === "\n") i++; }
    } else {
      if (closed || char === '"') throw new ConnectorError("connector_response_invalid", "Semrush returned malformed CSV.", { statusCode: 502 });
      field += char;
    }
  }
  if (quoted) throw new ConnectorError("connector_response_invalid", "Semrush returned incomplete CSV.", { statusCode: 502 });
  if (field !== "" || closed || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function validProject(project) {
  return Number.isSafeInteger(project?.project_id) && project.project_id > 0 &&
    typeof project.project_name === "string" && project.project_name.length > 0 &&
    typeof project.domain === "string" && project.domain.length > 0 &&
    Number.isSafeInteger(project.owner_id) && project.owner_id > 0 &&
    ["read", "edit", "delete", "share", "downgraded"].every((permission) => typeof project.permissions?.[permission] === "boolean") &&
    Array.isArray(project.tools) && project.tools.every((tool) => typeof tool?.name === "string" && tool.name.length > 0);
}

const semrushProvider = Object.freeze({
  ...semrushDefinition, apiOrigins: ["https://api.semrush.com"],
  apiKey: { headers: (key) => {
    if (/[\s\p{Cc}]/u.test(key)) {
      throw new ConnectorError("connector_binding_missing", "Use the Semrush V4 API key without spaces or control characters.");
    }
    return { Authorization: `Apikey ${key}` };
  } },
  checkOperation: "projects.list",
  operations: {
    "tracking.campaigns": { scopes: [], request(input, settings) {
      const { projectId } = validateSchemaPayload({ schema: projectSchema, mode: "replace" }, input, { statusCode: 422 });
      if (!settings.v3ApiKeyRef) throw new ConnectorError("connector_binding_missing", "Configure the Semrush V3 key for campaign discovery.");
      return { method: "GET", url: `https://api.semrush.com/management/v1/projects/${projectId}/tracking/campaigns` };
    } },
    "tracking.dates": semrushTrackingReport("tracking_campaign_dates"),
    "tracking.organicPositions": semrushTrackingReport("tracking_position_organic", true),
    "tracking.paidPositions": semrushTrackingReport("tracking_position_adwords", true),
    "domains.organicKeywords": semrushKeywordReport("domain", "organic"),
    "domains.paidKeywords": semrushKeywordReport("domain", "adwords"),
    "urls.organicKeywords": semrushKeywordReport("url", "organic"),
    "urls.paidKeywords": semrushKeywordReport("url", "adwords"),
    "subfolders.organicKeywords": semrushKeywordReport("subfolder", "organic"),
    "subfolders.paidKeywords": semrushKeywordReport("subfolder", "adwords"),
    "domains.overview": {
      scopes: [],
      request(input, settings) {
        if (!settings.v3ApiKeyRef) throw new ConnectorError("connector_binding_missing", "Configure the separate Semrush V3 API key reference for domain reports.");
        const operation = jsonOperation("https://api.semrush.com/", {
          domain: { type: "string", required: true, minLength: 1, maxLength: 253, pattern: /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu },
          database: { type: "string", required: true, pattern: /^[a-z]{2}$/u }
        });
        const result = operation.request(input);
        const url = new URL(result.url);
        url.searchParams.set("type", "domain_rank");
        url.searchParams.set("export_columns", "Dn,Rk,Or,Ot,Oc,Ad,At,Ac");
        url.searchParams.set("export_escape", "1");
        url.searchParams.set("export_decode", "1");
        return { ...result, url: url.href };
      }
    },
    "backlinks.overview": jsonOperation("https://api.semrush.com/apis/v4/backlinks/v1/overview", backlinkTarget),
    "backlinks.list": jsonOperation("https://api.semrush.com/apis/v4/backlinks/v1/links", backlinkPage),
    "backlinks.referringDomains": jsonOperation("https://api.semrush.com/apis/v4/backlinks/v1/ref-domains", backlinkPage),
    "backlinks.anchors": jsonOperation("https://api.semrush.com/apis/v4/backlinks/v1/anchors", backlinkPage),
    "keywords.metrics": {
      scopes: [],
      request(input) {
        const operation = jsonOperation("https://api.semrush.com/apis/v4/keywords/v1/metrics", {
          keyword: { type: "string", required: true, minLength: 1, maxLength: 255 },
          country: { type: "string", required: true, pattern: /^[A-Z]{2}$/u },
          month: { type: "string", pattern: /^\d{4}-(0[1-9]|1[0-2])$/u }
        });
        const result = operation.request(input);
        const url = new URL(result.url);
        const month = url.searchParams.get("month");
        if (month && (month < "2012-01" || month > new Date().toISOString().slice(0, 7))) {
          throw new ConnectorError("connector_input_invalid", "Choose a month from 2012-01 through the current month.", { statusCode: 422 });
        }
        url.searchParams.set("format", "json");
        return { ...result, url: url.href };
      }
    },
    "projects.create": jsonOperation(projectsUrl, {
      domain: { type: "string", required: true, minLength: 1, maxLength: 253, pattern: /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/iu },
      project_name: projectName
    }, undefined, "POST"),
    "projects.update": {
      scopes: [],
      request(input) {
        const { projectId, project_name } = validateSchemaPayload({ schema: renameSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "PATCH", url: `${projectsUrl}/${projectId}`, body: { project_name } };
      }
    },
    "projects.list": jsonOperation(projectsUrl, {
      scope: { type: "string", enum: ["OWN", "ALL", "SHARED", "CORPORATE"], defaultTo: "OWN" },
      limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      offset: { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER, defaultTo: 0 }
    }),
    "projects.delete": {
      scopes: [],
      request(input) {
        const { projectId } = validateSchemaPayload({ schema: projectSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "DELETE", url: `${projectsUrl}/${projectId}` };
      }
    },
    "projects.get": {
      scopes: [],
      request(input) {
        const { projectId } = validateSchemaPayload({ schema: projectSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "GET", url: `${projectsUrl}/${projectId}` };
      }
    }
  },
  async exchange(address, options, { request, fetchImpl, settings, resolveReference }) {
    const path = new URL(address).pathname;
    if (path === "/" || path.startsWith("/management/v1/projects/") || path.startsWith("/reports/v1/projects/")) {
      let key;
      try { key = await resolveReference(settings.v3ApiKeyRef); } catch {
        throw new ConnectorError("connector_binding_missing", "Provide the Semrush V3 API key through its private Env reference.");
      }
      if (typeof key !== "string" || !key || key === "MISSING" || /[\s\p{Cc}]/u.test(key)) {
        throw new ConnectorError("connector_binding_missing", "Provide a valid Semrush V3 API key.");
      }
      const url = new URL(address);
      url.searchParams.set("key", key);
      let response, text;
      try {
        response = await fetchImpl(url.href, { method: "GET", headers: { Accept: "text/csv" },
          credentials: "omit", redirect: "error", signal: options.signal });
        if (!response.ok) throw new Error("Provider failure");
        text = await response.text();
      } catch {
        options.signal.throwIfAborted();
        const status = response?.status;
        throw new ConnectorError(status === 429 ? "connector_rate_limited" : status === 403 ? "connector_permission_denied" : "connector_provider_failed",
          "Semrush could not return the V3 report.", { statusCode: status === 429 ? 429 : status === 403 ? 403 : 502 });
      }
      if (text.length > 2_000_000) throw new ConnectorError("connector_response_invalid", "Semrush returned an oversized V3 report.", { statusCode: 502 });
      if (path !== "/") {
        let result;
        try { result = JSON.parse(text); } catch {
          throw new ConnectorError("connector_response_invalid", "Semrush returned invalid tracking JSON.", { statusCode: 502 });
        }
        let valid = result && typeof result === "object" && !Array.isArray(result) && result.error === undefined;
        if (path.endsWith("/campaigns")) {
          valid &&= String(result.project_id) === path.split("/")[4] && Array.isArray(result.campaigns) &&
            result.campaigns.every((campaign) => typeof campaign?.id === "string" && /^\d+(?:_\d+)?$/u.test(campaign.id) &&
              typeof campaign.url === "string" && typeof campaign.device === "string" && typeof campaign.isGathering === "boolean");
        } else {
          valid &&= result.data !== null && typeof result.data === "object" &&
            /^(0|[1-9]\d*)$/u.test(String(result.total));
          if (url.searchParams.get("type") === "tracking_campaign_dates") {
            valid &&= Object.values(result.data).every((entry) => /^\d{8}$/u.test(String(entry?.Dt)));
          } else {
            valid &&= String(result.limit) === url.searchParams.get("display_limit") && String(result.offset) === url.searchParams.get("display_offset") &&
              Object.values(result.data).length <= Number(url.searchParams.get("display_limit")) &&
              Object.values(result.data).every((entry) => typeof entry?.Ph === "string" && typeof entry.Pi === "string" && entry.Dt !== null && typeof entry.Dt === "object");
          }
        }
        if (!valid) throw new ConnectorError("connector_response_invalid", "Semrush returned unexpected tracking data.", { statusCode: 502 });
        return result;
      }
      const columns = url.searchParams.get("type") === "domain_rank" ? domainColumns : keywordColumns;
      const rowLimit = columns === domainColumns ? 1 : Number(url.searchParams.get("display_limit")) - Number(url.searchParams.get("display_offset"));
      const error = /^ERROR\s+(\d+)/u.exec(text.trim());
      if (error) {
        if (error[1] === "50") return { columns, rows: [] };
        const code = Number(error[1]);
        if ([110, 120].includes(code)) throw new ConnectorError("connector_binding_missing", "Replace the separate Semrush V3 key in Env.");
        if ([130, 133, 135].includes(code)) throw new ConnectorError("connector_permission_denied", "Check Semrush V3 API, database and report entitlement.", { statusCode: 403 });
        if ([131, 132, 134].includes(code)) throw new ConnectorError("connector_quota_limited", "Check Semrush V3 API units and report limits.", { statusCode: 429 });
        throw new ConnectorError("connector_provider_failed", "Semrush rejected the V3 report. Check its inputs and account access.", { statusCode: 502 });
      }
      const rows = parseSemrushCsv(text);
      if (JSON.stringify(rows.shift()) !== JSON.stringify(columns) || rows.length > rowLimit ||
        rows.some((row) => row.length !== columns.length)) {
        throw new ConnectorError("connector_response_invalid", "Semrush returned unexpected V3 report columns or rows.", { statusCode: 502 });
      }
      return { columns, rows };
    }
    const result = await request(address, options);
    if (result?.meta?.success === false) {
      const code = result.error?.code;
      if ([70, 120, 121, 122].includes(code)) {
        throw new ConnectorError("connector_reconnect_required", "Replace the Semrush V4 key and connect again.", { statusCode: 401 });
      }
      if (code === 130) {
        throw new ConnectorError("connector_permission_denied", "Semrush API access is disabled for this account.", { statusCode: 403 });
      }
      if ([131, 132, 134].includes(code)) {
        throw new ConnectorError("connector_quota_limited", "Semrush API capacity is exhausted. Check the account's subscription and available units.", { statusCode: 429 });
      }
      if (code === 512) {
        throw new ConnectorError("connector_resource_not_found", "The Semrush project was not found or is not accessible.", { statusCode: 404 });
      }
      throw new ConnectorError("connector_provider_failed", "Semrush could not complete this request.", { statusCode: 502 });
    }
    const url = new URL(address);
    const meta = result?.meta;
    const creating = options.method === "POST" && url.pathname === "/apis/v4/projects/v1/projects";
    let valid = meta?.success === true && meta.status_code === (creating ? 201 : 200) &&
      typeof meta.request_id === "string" && meta.request_id.length > 0 && result.error === undefined;
    if (url.pathname === "/apis/v4/keywords/v1/metrics") {
      const data = result?.data;
      valid &&= meta.keyword === url.searchParams.get("keyword") && meta.country === url.searchParams.get("country") &&
        typeof meta.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/u.test(meta.month) &&
        (!url.searchParams.has("month") || meta.month === url.searchParams.get("month")) &&
        data !== null && typeof data === "object" && !Array.isArray(data) &&
        ["cpc", "number_of_results", "search_volume"].every((key) => typeof data[key] === "string" && /^\d+$/u.test(data[key])) &&
        ["competitive_density", "keyword_difficulty"].every((key) => Number.isFinite(data[key])) &&
        ["intents", "serp_features"].every((key) => Array.isArray(data[key]) && data[key].every((value) => typeof value === "string")) &&
        Array.isArray(data.trends) && data.trends.every(Number.isFinite);
    } else if (url.pathname.startsWith("/apis/v4/backlinks/v1/")) {
      const report = url.pathname.split("/").at(-1);
      const count = (value) => Number.isSafeInteger(value) && value >= 0;
      if (report === "overview") {
        valid &&= ["backlinks_count", "domains_count", "urls_count", "score"].every((field) => count(result.data?.[field]));
      } else {
        valid &&= Array.isArray(result.data) && result.data.length <= Number(url.searchParams.get("limit")) &&
          result.data.every((row) => {
            if (!row || typeof row !== "object" || Array.isArray(row)) return false;
            if (report === "links") return typeof row.source_url === "string" && typeof row.target_url === "string" &&
              typeof row.anchor === "string" && typeof row.is_nofollow === "boolean";
            if (report === "ref-domains") return typeof row.domain === "string" && count(row.backlinks_count) && count(row.domain_score);
            return typeof row.anchor === "string" && count(row.backlinks_count) && count(row.domains_count);
          });
        // Some report envelopes omit pagination metadata; validate it when supplied.
        for (const field of ["limit", "offset"]) {
          if (meta?.[field] !== undefined) valid &&= String(meta[field]) === url.searchParams.get(field);
        }
        if (meta?.total !== undefined) valid &&= count(meta.total);
      }
      if (meta?.scope !== undefined) valid &&= meta.scope === url.searchParams.get("scope");
    } else if (creating) {
      const submitted = options.body;
      valid &&= validProject(result.data) && result.data.project_name === submitted.project_name &&
        result.data.domain.toLowerCase() === submitted.domain.toLowerCase();
    } else if (url.pathname === "/apis/v4/projects/v1/projects") {
      const limit = Number(url.searchParams.get("limit"));
      valid &&= meta.scope === url.searchParams.get("scope") && meta.limit === limit &&
        meta.offset === Number(url.searchParams.get("offset")) &&
        Number.isSafeInteger(meta.total_count) && meta.total_count >= 0 &&
        Array.isArray(result.data) && result.data.length <= limit && result.data.length <= meta.total_count &&
        result.data.every(validProject);
    } else if (options.method === "DELETE") {
      valid &&= Number.isSafeInteger(result.data?.project_id) &&
        result.data.project_id === Number(url.pathname.split("/").at(-1));
    } else {
      valid &&= validProject(result.data) && result.data.project_id === Number(url.pathname.split("/").at(-1));
      if (options.method === "PATCH") valid &&= result.data.project_name === options.body.project_name;
    }
    if (!valid) {
      throw new ConnectorError("connector_response_invalid", "Semrush returned unexpected report or project data.", { statusCode: 502 });
    }
    return result;
  }
});
export { semrushProvider };
