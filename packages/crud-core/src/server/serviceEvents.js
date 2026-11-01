import { isJsonApiDataResult, isJsonApiDocumentResult } from "@jskit-ai/http-runtime/shared";

/**
 * The created record's id, for a create event, from the tagged JSON:API result
 * the action or service returned: a document result's `value.data.id`
 * (returnJsonApiDocument, what a CRUD service's createDocument returns) or a
 * data result's record `value.id` (returnJsonApiData(record), whose id the
 * HTTP route transport reads the same way). "" for anything else.
 * @param {{ result?: unknown }} [execution]
 */
function resolveCrudJsonApiEntityIdFromResult({ result } = {}) {
  let id = null;
  if (isJsonApiDocumentResult(result)) {
    // data: a document result's data may be null
    id = result.value?.data?.id;
  } else if (isJsonApiDataResult(result)) {
    // data: a data result's record may be null
    id = result.value?.id;
  }
  return id == null ? "" : String(id).trim();
}

export { resolveCrudJsonApiEntityIdFromResult };
