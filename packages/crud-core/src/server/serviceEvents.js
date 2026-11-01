/**
 * The created record's id, for a create event: the id in the JSON:API document
 * result the action or service returned (returnJsonApiDocument, which a CRUD
 * service's createDocument and a CRUD feature's create action return).
 * @param {{ result?: { value?: { data?: { id?: unknown } | null } } | null }} [execution]
 */
function resolveCrudJsonApiEntityIdFromResult({ result } = {}) {
  // data: a document result's data may be null
  const id = result?.value?.data?.id;
  return id == null ? "" : String(id).trim();
}

export { resolveCrudJsonApiEntityIdFromResult };
