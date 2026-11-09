import { Buffer } from "node:buffer";
import { RestApiValidationError } from "json-rest-api";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";

// A blob field (`type: "blob"`, with the `maxBytes` defineTableResource requires) is a value the process holds whole:
// a write takes bytes within the limit, checked before any statement, a read answers it only when its fields name it,
// and no read holds more than BLOB_READ_BYTES of them, but one record's, or answers them as JSON.

// The most bytes of named blobs one read holds when it answers more than one record: query() pages and lockMany() ids
// are refused past it, and queryPages() pages shrink until their blobs fit.
const BLOB_READ_BYTES = 16 * 1024 * 1024;

/**
 * The resource's blob fields.
 * @param {{ schema: Record<string, any> }} resource
 * @returns {string[]}
 */
function blobFields(resource) {
  return Object.keys(resource.schema).filter((field) => resource.schema[field]?.type === "blob");
}

/**
 * Checks each blob value a write sends, at the top of the write, before any statement (a transaction's BEGIN, a lock):
 * null, or a Buffer or Uint8Array of at most the field's maxBytes. Anything else is a validation error on the field
 * (422 at the HTTP edge). A row that is not a record is left to the write, which refuses it.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {ReadonlyArray<unknown>} rows The write's attributes, one record each.
 */
function checkBlobValues(resource, rows) {
  const fields = blobFields(resource);
  for (const row of rows.filter(isRecord)) {
    for (const field of fields) {
      const value = row[field];
      if (value === undefined || value === null) {
        continue;
      }
      const refuse = (rule, message) => {
        throw new RestApiValidationError(`${resource.name}.${field} ${message}`, { fields: [field], violations: [{ field, rule, message }] });
      };
      if (!(value instanceof Uint8Array)) {
        refuse("blob", "is a blob, whose value is a Buffer or a Uint8Array.");
      }
      if (value.byteLength > resource.schema[field].maxBytes) {
        refuse("max_bytes", `holds at most ${resource.schema[field].maxBytes} bytes; this value has ${value.byteLength}.`);
      }
    }
  }
}

/**
 * A write's data with each Uint8Array blob as a Buffer, as every driver takes it.
 * @param {{ schema: Record<string, any> }} resource
 * @param {Record<string, unknown>} data The write's own copy of its attributes, which this changes in place.
 */
function blobBuffers(resource, data) {
  for (const field of blobFields(resource)) {
    const value = data[field];
    if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
      data[field] = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
  }
  return data;
}

/**
 * The blob fields a read's `fields` names, of the resource (a list of names, or its entry in a sparse fieldset) and of
 * any other resource a sparse fieldset names, an included one, each as `{ label, maxBytes, included }`.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown} fields
 * @param {(name: string) => ({ name: string, schema: Record<string, any> } | null)} resourceNamed
 */
function namedBlobs(resource, fields, resourceNamed) {
  const lists = Array.isArray(fields) || typeof fields === "string" ? [[resource, String(fields).split(",")]]
    : isRecord(fields) ? Object.entries(fields).map(([name, list]) => [name === resource.name ? resource : resourceNamed(name), String(list).split(",")])
      : [];
  return lists.flatMap(([table, list]) => (table === null ? [] : list
    .map((field) => String(field).trim())
    .filter((field) => table.schema[field]?.type === "blob")
    .map((field) => ({ label: `${table.name}.${field}`, maxBytes: table.schema[field].maxBytes, included: table !== resource }))));
}

const labelsOf = (blobs) => blobs.map(({ label }) => label).join(", ");

/**
 * Checks the blobs a read names before anything runs, so that it holds at most BLOB_READ_BYTES of them, or one
 * record's, and answers the most rows of them that fit. `rows` is the most rows the read answers: 1 for get() and
 * lock(), the page size for query(), the ids for lockMany(), Infinity for a read of every matching row (queryAll,
 * lockWhere, claim), which names none. A blob of an included table is refused, since an include holds any number of
 * records.
 * @param {string} name The resource's name.
 * @param {string} caller The handle method, for the message.
 * @param {ReadonlyArray<{ label: string, maxBytes: number, included: boolean }>} blobs
 * @param {number} [rows]
 * @returns {number} The most rows a read of them holds: Infinity when it names none.
 */
function checkBlobReads(name, caller, blobs, rows = 1) {
  const included = blobs.filter((blob) => blob.included);
  if (included.length > 0) {
    throw new TypeError(
      `${name}.${caller}() fields name ${labelsOf(included)}, a blob of an included table, of whose records an include ` +
        "holds any number: read it through that table's own handle, one record's with get() or a page at a time with queryPages()."
    );
  }
  const bytes = blobs.reduce((sum, { maxBytes }) => sum + maxBytes, 0);
  const fit = bytes > 0 ? Math.max(1, Math.floor(BLOB_READ_BYTES / bytes)) : Infinity;
  if (rows === Infinity && bytes > 0) {
    throw new TypeError(
      `${name}.${caller}() reads every matching row at once, so it reads no blob (${labelsOf(blobs)}): ` +
        "read blobs a page at a time with queryPages(), whose pages hold at most 16 MiB of them, or one record's with get()."
    );
  }
  if (rows > fit) {
    throw new TypeError(
      `${name}.${caller}() reads up to ${rows} records, and ${fit} of them already hold 16 MiB of ${labelsOf(blobs)}: ` +
        `read at most ${fit} at a time, or read them a page at a time with queryPages().`
    );
  }
  return fit;
}

/**
 * Refuses blob fields in a JSON:API read, whose JSON holds no binary: a 400, since a client's sparse fieldset names them.
 * @param {string} name The resource's name.
 * @param {ReadonlyArray<{ label: string }>} blobs
 */
function refuseBlobsInJson(name, blobs) {
  if (blobs.length > 0) {
    const fields = labelsOf(blobs);
    throw new AppError(
      400,
      `${name} answers JSON:API documents, whose JSON holds no binary, so their fields name no blob (${fields}). ` +
        "A route of its own serves a blob: it reads it with get(id, { fields }) and answers it as the response body.",
      { code: "JSON_API_FIELDSET_INVALID", messageCode: "resource.blobFields", messageParams: { fields } }
    );
  }
}

export { blobBuffers, blobFields, checkBlobReads, checkBlobValues, namedBlobs, refuseBlobsInJson };
