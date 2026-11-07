// A handle answers records; the stores answer rows, as they did when they read the tables
// directly: keyed by column, the conversation's id under conversation_id where it is the key,
// big integers as strings and timestamps as Dates.

/**
 * One record as its row, or the record itself when there is none (null or undefined).
 * @param {{ schema: Record<string, { type?: string }>, idProperty?: string }} resource
 * @param {Record<string, unknown> | null | undefined} record
 * @returns {Record<string, any> | null | undefined}
 */
export function rowOf(resource, record) {
  if (!record) {
    return record;
  }
  const row = {};
  for (const [field, value] of Object.entries(record)) {
    const type = field === "id" ? "id" : resource.schema[field]?.type;
    const column = field === "id" ? resource.idProperty || "id" : field;
    if (value === null || value === undefined) {
      row[column] = value;
    } else if (type === "dateTime") {
      row[column] = new Date(String(value));
    } else {
      row[column] = type === "id" ? String(value) : value;
    }
  }
  return row;
}

/**
 * The conversation's id, refused when it is missing: a filter on a missing id would select every
 * conversation's rows, and a write on it would change them all.
 * @template T
 * @param {T} conversationId
 * @returns {T}
 */
export function conversationKey(conversationId) {
  if (conversationId === null || conversationId === undefined || conversationId === "") {
    throw new TypeError("An agent store call needs the conversation's id.");
  }
  return conversationId;
}

/**
 * The first record of a page as its row, or undefined when the page is empty.
 * @param {{ schema: Record<string, { type?: string }>, idProperty?: string }} resource
 * @param {{ records: ReadonlyArray<Record<string, unknown>> }} page
 */
export function firstRow(resource, page) {
  return rowOf(resource, page.records[0]);
}
