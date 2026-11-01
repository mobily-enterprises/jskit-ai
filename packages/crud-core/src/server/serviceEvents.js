import { isJsonApiDataResult, isJsonApiDocumentResult } from "@jskit-ai/http-runtime/shared";
import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { resolveCrudRecordChangedEvent } from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";

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

/**
 * The action event a CRUD record mutation announces: an entity change of the "crud" source's "record", published
 * in realtime as the namespace's record-changed event (`<namespace>.record.changed`) to the audience. operation and
 * entityId may be functions of the action's execution, as createEntityChangedActionEvent takes them.
 * @param {object} change
 * @param {string} change.namespace The CRUD resource's namespace.
 * @param {string | ((execution: any) => string)} change.operation "created", "updated" or "deleted".
 * @param {unknown} change.entityId
 * @param {unknown} [change.audience] The realtime audience; the kernel's default when absent.
 */
function buildCrudRecordChangedEvent({ namespace, operation, entityId, audience }) {
  return createEntityChangedActionEvent({
    source: "crud",
    entity: "record",
    operation,
    entityId,
    realtime: {
      event: resolveCrudRecordChangedEvent(namespace),
      audience
    }
  });
}

export { buildCrudRecordChangedEvent, resolveCrudJsonApiEntityIdFromResult };
