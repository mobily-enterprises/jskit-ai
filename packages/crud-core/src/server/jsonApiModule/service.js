import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { buildJsonRestQueryParams } from "@jskit-ai/resource-runtime/server";
import {
  resolveDeclaredLookupContainerKey,
  resolveJsonApiRelationshipEntries,
  resolveSchemaFieldDefinitions
} from "../jsonApiResourceContract.js";

// A record that is missing or out of the caller's scope.
function documentNotFound() {
  return new AppError(404, "Document not found.", { code: "crud.document.notFound" });
}

function requireDocument(document) {
  if (!document) {
    throw documentNotFound();
  }
  return document;
}

// json-rest-api's not-found error, classified by its code.
function isNotFound(error) {
  return error?.code === "REST_API_RESOURCE" && error?.subtype === "not_found";
}

/**
 * A contract's record output: its view (or create, replace, patch) output, or a list-only contract's list item.
 * @param {import("../types.js").CrudContract} crud
 */
function recordOutput(crud) {
  const record = ["view", "create", "replace", "patch"].map((name) => crud.operations[name]?.output).find(Boolean);
  return record || { schema: resolveSchemaFieldDefinitions(crud.operations.list?.output).items?.items };
}

/**
 * What a contract shows of its own records: the attributes its record output names, and the relationships of the
 * fields it names.
 * @param {import("../types.js").CrudContract} crud
 */
function contractShape(crud) {
  const output = recordOutput(crud);
  const lookupContainerKey = resolveDeclaredLookupContainerKey(crud);
  const relationships = resolveJsonApiRelationshipEntries(output);
  return {
    attributes: new Set(Object.keys(resolveSchemaFieldDefinitions(output)).filter((key) => key !== lookupContainerKey)),
    relationshipNames: new Set(relationships.map(({ relationshipName }) => relationshipName)),
    relationships
  };
}

/**
 * What the documents of a contract show of each JSON:API type its includes reach. An included record shows only its
 * id, its lookup's `labelKey` and the fields this contract's relation lists in `includeFields`, and no relationships;
 * it never takes another contract's output, so a contract served to another surface or behind another permission
 * shapes nothing here. A type no relation of this contract reaches shows only its id.
 * @param {import("../types.js").CrudContract} crud
 */
function documentShapes(crud) {
  /** @type {Map<string, { attributes: Set<string>, relationshipNames: Set<string> }>} */
  const shapes = new Map();
  for (const entry of contractShape(crud).relationships) {
    const attributes = shapes.get(entry.relationshipType)?.attributes ?? new Set();
    for (const key of [entry.labelKey, ...entry.includeFields]) {
      if (key) attributes.add(key);
    }
    shapes.set(entry.relationshipType, { attributes, relationshipNames: new Set() });
  }
  return shapes;
}

const NOTHING_SHOWN = Object.freeze({ attributes: new Set(), relationshipNames: new Set() });

/**
 * The CRUD service: the HTTP edge of a CRUD feature. It takes an operation's
 * HTTP query and body, calls the feature's repository (its table's handle, as
 * decorated) with the call's options and `format: "jsonapi"`, and answers
 * JSON:API documents that show only what the CRUD contract names: its records'
 * attributes and relationships, and each included record with only what its
 * relation names (see documentShapes), so a column or relationship the
 * contract does not name is never answered.
 * Server code calls the repository instead. The handle stamps the table's
 * createdAt and updatedAt, as it does for every write.
 * @param {object} dependencies
 * @param {import("../types.js").CrudRepository} dependencies.repository
 * @param {import("../types.js").CrudContract} dependencies.crud The CRUD contract the service answers for.
 */
function createCrudService({ repository, crud }) {
  const resourceName = crud.resource.name;
  const own = contractShape(crud);
  const shapes = documentShapes(crud);

  /**
   * @param {Record<string, any>} record A JSON:API resource object.
   * @param {{ attributes: Set<string>, relationshipNames: Set<string> }} shape
   */
  function shownRecord(record, shape) {
    const shown = { ...record };
    if (record.attributes) {
      shown.attributes = Object.fromEntries(Object.entries(record.attributes).filter(([key]) => shape.attributes.has(key)));
    }
    if (record.relationships) {
      shown.relationships = Object.fromEntries(Object.entries(record.relationships).filter(([name]) => shape.relationshipNames.has(name)));
    }
    return shown;
  }

  /**
   * The (type, id) keys a record's kept relationships point to.
   * @param {Record<string, any>} record
   */
  function linkedKeys(record) {
    return Object.values(record.relationships || {}).flatMap(({ data }) => (Array.isArray(data) ? data : data ? [data] : []))
      .map(({ type, id }) => `${type}:${id}`);
  }

  /**
   * The document as the contract shows it: its records, and only the included records a kept relationship reaches,
   * each shaped by its type.
   * @param {Record<string, any> | null} document
   */
  function answer(document) {
    if (!document?.data) {
      return returnJsonApiDocument(document);
    }
    const records = (Array.isArray(document.data) ? document.data : [document.data]).map((record) => shownRecord(record, own));
    const shown = { ...document, data: Array.isArray(document.data) ? records : records[0] };
    if (document.included) {
      const included = new Map(document.included.map((record) => [`${record.type}:${record.id}`, record]));
      const kept = new Map();
      const reached = records.flatMap(linkedKeys);
      while (reached.length > 0) {
        const key = reached.pop();
        if (kept.has(key) || !included.has(key)) continue;
        const record = included.get(key);
        const shaped = shownRecord(record, shapes.get(record.type) ?? NOTHING_SHOWN);
        kept.set(key, shaped);
        reached.push(...linkedKeys(shaped));
      }
      shown.included = document.included.map((record) => kept.get(`${record.type}:${record.id}`)).filter(Boolean);
    }
    return returnJsonApiDocument(shown);
  }

  /** @param {{ context?: object | null, trx?: object | null }} options */
  function documentOptions(options) {
    return { ...options, format: "jsonapi" };
  }

  /**
   * One page of the records the HTTP query matches: its filters, `include`,
   * `fields`, `sort`, `limit` and `cursor`.
   * @param {Record<string, unknown>} query
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function list(query, options) {
    return answer(await repository.query(buildJsonRestQueryParams(resourceName, query), documentOptions(options)));
  }

  /**
   * @param {unknown} recordId
   * @param {Record<string, unknown>} query `include` and `fields`.
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function view(recordId, query, options) {
    if (options && Object.hasOwn(options, "forUpdate")) {
      throw new TypeError(
        "The CRUD service's view() no longer takes forUpdate: lock the record with the repository's " +
        "lock(recordId, txOptions) inside repository.withTransaction(options, (txOptions) => ...)."
      );
    }
    return answer(requireDocument(
      await repository.get(recordId, buildJsonRestQueryParams(resourceName, query), { ...documentOptions(options), missing: "skip" })
    ));
  }

  /**
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function create(payload, options) {
    return answer(await repository.create(payload, documentOptions(options)));
  }

  /**
   * @param {unknown} recordId
   * @param {Record<string, unknown>} payload
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function patch(recordId, payload, options) {
    try {
      return answer(requireDocument(
        await repository.patch(recordId, payload, documentOptions(options))
      ));
    } catch (error) {
      throw isNotFound(error) ? documentNotFound() : error;
    }
  }

  /**
   * Deletes the record and answers its id; a record that is already gone answers null.
   * @param {unknown} recordId
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function deleteRecord(recordId, options) {
    return repository.delete(recordId, { ...options, missing: "skip" });
  }

  return Object.freeze({
    list,
    view,
    create,
    patch,
    delete: deleteRecord
  });
}

export { createCrudService };
