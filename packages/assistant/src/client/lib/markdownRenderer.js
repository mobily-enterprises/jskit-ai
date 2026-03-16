import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions(
  Object.freeze({
    gfm: true,
    breaks: true
  })
);

function normalizeMarkdownText(value) {
  return typeof value === "string" ? value : String(value || "");
}

function renderMarkdownToSafeHtml(value = "") {
  const markdownText = normalizeMarkdownText(value);
  if (!markdownText) {
    return "";
  }

  const unsafeHtml = String(marked.parse(markdownText) || "");
  return String(
    DOMPurify.sanitize(unsafeHtml, {
      USE_PROFILES: {
        html: true
      }
    }) || ""
  );
}

export { renderMarkdownToSafeHtml };
