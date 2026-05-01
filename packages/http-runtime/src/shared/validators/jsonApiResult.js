const JSON_API_RESULT_MARKER = "__jskitJsonApiResult";
const JSON_API_RESULT_KINDS = Object.freeze([
  "data",
  "document",
  "meta"
]);

function normalizeJsonApiResultKind(kind = "") {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  if (!JSON_API_RESULT_KINDS.includes(normalizedKind)) {
    throw new TypeError(`Unsupported JSON:API result kind: ${normalizedKind || "<empty>"}.`);
  }

  return normalizedKind;
}

function createJsonApiResult(kind, value) {
  return Object.freeze({
    [JSON_API_RESULT_MARKER]: true,
    kind: normalizeJsonApiResultKind(kind),
    value
  });
}

function isJsonApiResult(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value[JSON_API_RESULT_MARKER] === true &&
    JSON_API_RESULT_KINDS.includes(String(value.kind || "").trim().toLowerCase());
}

function isJsonApiResultKind(value, kind) {
  return isJsonApiResult(value) && value.kind === normalizeJsonApiResultKind(kind);
}

function returnJsonApiData(data) {
  return createJsonApiResult("data", data);
}

function returnJsonApiDocument(document) {
  return createJsonApiResult("document", document);
}

function returnJsonApiMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new TypeError("returnJsonApiMeta requires a meta object.");
  }

  return createJsonApiResult("meta", meta);
}

function isJsonApiDataResult(value) {
  return isJsonApiResultKind(value, "data");
}

function isJsonApiDocumentResult(value) {
  return isJsonApiResultKind(value, "document");
}

function isJsonApiMetaResult(value) {
  return isJsonApiResultKind(value, "meta");
}

function unwrapJsonApiResult(value) {
  if (!isJsonApiResult(value)) {
    return null;
  }

  return value;
}

export {
  JSON_API_RESULT_MARKER,
  returnJsonApiData,
  returnJsonApiDocument,
  returnJsonApiMeta,
  isJsonApiResult,
  isJsonApiDataResult,
  isJsonApiDocumentResult,
  isJsonApiMetaResult,
  unwrapJsonApiResult
};
