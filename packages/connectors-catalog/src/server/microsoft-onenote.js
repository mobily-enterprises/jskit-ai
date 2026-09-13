import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { microsoftOneNoteDefinition } from "../shared/microsoft.js";
import { graphRead, microsoftProvider, pageSize } from "./microsoft.js";

const id = { type: "string", required: true, minLength: 1, maxLength: 1024,
  validator: value => /^[A-Za-z0-9!_{}:.-]+$/u.test(value) && value !== "." && value !== ".." || "Use the returned OneNote resource ID." };
const text = { type: "string", required: true, minLength: 1, maxLength: 100000, noTrim: true };
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const createSchemaPage = createSchema({ sectionId: id, title: { ...text, maxLength: 255 }, text });
const appendSchema = createSchema({ pageId: id, text });
const contentSchema = createSchema({ pageId: id });
const origin = "https://graph.microsoft.com/v1.0/me/onenote";
const base = microsoftProvider(microsoftOneNoteDefinition, "common", "notebooks.list", {
  "notebooks.list": graphRead("Notes.Read", {}, () => ({ pathname: "/me/onenote/notebooks" })),
  "sections.list": graphRead("Notes.Read", { notebookId: id }, ({ notebookId }) => ({ pathname: `/me/onenote/notebooks/${encodeURIComponent(notebookId)}/sections` })),
  "pages.list": graphRead("Notes.Read", { sectionId: id, pageSize }, ({ sectionId, pageSize }) => ({ pathname: `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages`, query: { $top: pageSize } })),
  "pages.content": { scopes: ["Notes.Read"], validateResult: value => typeof value?.html === "string", request(input) {
    const { pageId } = validateSchemaPayload({ schema: contentSchema, mode: "replace" }, input, { statusCode: 422 });
    return { method: "GET", url: `${origin}/pages/${encodeURIComponent(pageId)}/content?includeIDs=true` };
  } },
  "pages.create": { scopes: ["Notes.Create", "Notes.ReadWrite", "Notes.ReadWrite.All"], validateResult: value => typeof value?.id === "string", request(input) {
    const { sectionId, title, text } = validateSchemaPayload({ schema: createSchemaPage, mode: "replace" }, input, { statusCode: 422 });
    return { method: "POST", url: `${origin}/sections/${encodeURIComponent(sectionId)}/pages`, headers: { "Content-Type": "text/html" },
      body: `<!DOCTYPE html><html><head><title>${escape(title)}</title></head><body><p>${escape(text).replaceAll("\n", "<br />")}</p></body></html>` };
  } },
  "pages.append": { scopes: ["Notes.ReadWrite", "Notes.ReadWrite.All"], request(input) {
    const { pageId, text } = validateSchemaPayload({ schema: appendSchema, mode: "replace" }, input, { statusCode: 422 });
    return { method: "PATCH", url: `${origin}/pages/${encodeURIComponent(pageId)}/content`,
      body: [{ target: "body", action: "append", content: `<p>${escape(text).replaceAll("\n", "<br />")}</p>` }] };
  } }
});
const microsoftOneNoteProvider = Object.freeze({ ...base,
  async exchange(address, options, { request, fetchImpl }) {
    const content = options.method === "GET" && new URL(address).pathname.endsWith("/content");
    const create = new Headers(options.headers).get("content-type") === "text/html";
    if (!content && !create) return request(address, options);
    const response = await fetchImpl(address, { ...options, credentials: "omit", redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error("OneNote request failed."), { status: response.status }); }
    if (create) return response.json();
    const reader = response.body?.getReader(); const chunks = []; let size = 0;
    if (reader) try { while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1048576) { await reader.cancel(); throw new ConnectorError("connector_response_too_large", "Use the native OneNote client for pages above 1 MiB.", { statusCode: 413 }); }
      chunks.push(value);
    } } finally { reader.releaseLock(); }
    return { html: Buffer.concat(chunks).toString("utf8") };
  }
});
export { microsoftOneNoteProvider };
