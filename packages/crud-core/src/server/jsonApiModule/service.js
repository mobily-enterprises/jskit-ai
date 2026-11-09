import { returnJsonApiDocument } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";
import { buildJsonRestQueryParams, passedOn } from "@jskit-ai/resource-runtime/server";
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
// A not-found naming another resource, such as a link to a record that does not exist, is that resource's own
// refusal, not this record missing.
function isNotFound(error, resourceName) {
  const type = error?.details?.resourceType;
  return error?.code === "REST_API_RESOURCE" && error?.subtype === "not_found" && (type == null || type === resourceName);
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
 * What an included record shows, from what its relation lists (see includeFieldsOf): its label and listed fields, the
 * relationships the list names, and for each of those what its records show.
 * @param {{ attributes: ReadonlyArray<string>, relationships: Readonly<Record<string, any>> }} include
 * @param {string} [labelKey]
 */
function includedShape({ attributes, relationships }, labelKey = "") {
  return Object.freeze({
    attributes: new Set([labelKey, ...attributes].filter(Boolean)),
    relationshipNames: new Set(Object.keys(relationships)),
    linked: new Map(Object.entries(relationships).map(([name, nested]) => [name, includedShape(nested)]))
  });
}

/**
 * What the documents of a contract show of the records its includes reach, by relationship. An included record shows
 * its id, its relation's `labelKey` and what the contract's relation lists in `includeFields`, at every depth; it
 * never takes another contract's output, so a contract served to another surface or behind another permission shapes
 * nothing here.
 * @param {import("../types.js").CrudContract} crud
 * @returns {Map<string, ReturnType<typeof includedShape>>}
 */
function documentShapes(crud) {
  return new Map(contractShape(crud).relationships.map((entry) => [entry.relationshipName, includedShape(entry.include, entry.labelKey)]));
}

/**
 * The links a table resource's records carry in a JSON:API document, by relationship name: each belongs-to field's
 * (its `as`, or its key) and each collection relation's, with the field that declares it and the resource it links to.
 * @param {{ schema?: Record<string, any> }} resource
 * @returns {Map<string, { fieldKey: string, target: string }>}
 */
function linksOf(resource) {
  const links = new Map();
  for (const [fieldKey, definition] of Object.entries(resource.schema ?? {})) {
    const belongsTo = normalizeText(definition?.belongsTo);
    const relation = isRecord(definition?.relation) ? definition.relation : {};
    if (belongsTo) {
      links.set(normalizeText(definition.as) || fieldKey, { fieldKey, target: belongsTo });
    } else if (normalizeText(relation.kind).toLowerCase() === "collection") {
      links.set(normalizeText(relation.as || definition.as) || fieldKey, {
        fieldKey,
        target: resolveCrudResourceScopeName(relation.target || relation.targetResource || relation.namespace || relation.apiPath)
      });
    }
  }
  return links;
}

/**
 * Refuses a field an include lists that is a link of the included record: a belongs-to field, by its key
 * (`locationId`) or its relationship (`location`), or a collection relation. A JSON:API document answers a link
 * under the record's relationships, never among its attributes, so the field would never show and the record would
 * read as if it had no link. The list names a link as `{ location: [] }`, which answers the linked record's id, with
 * the fields to show of that record inside it. Each level is checked against its own table resource; a level whose
 * resource no feature owns is left to the request.
 * @param {import("../types.js").CrudContract} crud
 * @param {(name: string) => ({ name: string, schema: Record<string, any> } | null)} tableResource The resource runtime's
 *   owned table resources, by name.
 */
function checkIncludedFields(crud, tableResource) {
  const check = (label, resourceName, { attributes, relationships }) => {
    const resource = tableResource(resourceName);
    if (!resource) {
      return;
    }
    const links = linksOf(resource);
    for (const name of attributes) {
      const relationshipName = links.has(name) ? name : [...links].find(([, { fieldKey }]) => fieldKey === name)?.[0];
      if (relationshipName) {
        throw new TypeError(
          `A CRUD contract's ${label} lists "${name}", which is a link of ${resourceName} to ` +
          `${links.get(relationshipName).target}, not one of its fields: a document answers a link under its ` +
          `relationship, never as a field, so "${name}" would never show. List it as { ${relationshipName}: [] }, ` +
          `which answers the linked record's id, and put the fields to show of that record inside it, such as ` +
          `{ ${relationshipName}: ["name"] }.`
        );
      }
    }
    for (const [relationshipName, nested] of Object.entries(relationships)) {
      const link = links.get(relationshipName);
      if (link?.target) {
        check(`${label}.${relationshipName}`, link.target, nested);
      }
    }
  };
  for (const { attributeKey, relationshipType, include } of contractShape(crud).relationships) {
    check(`${attributeKey}.includeFields`, relationshipType, include);
  }
}

// What each CRUD contract shows, by contract. defineCrudContract deep-freezes a contract, so what it shows is worked
// out once and every service on it reads the same shapes; a contract whose shapes throw keeps nothing.
const shapesByContract = new WeakMap();

/**
 * What a contract's documents show: its own records' shape and its includes' shapes.
 * @param {import("../types.js").CrudContract} crud
 */
function contractShapes(crud) {
  if (!shapesByContract.has(crud)) {
    shapesByContract.set(crud, Object.freeze({ own: contractShape(crud), linked: documentShapes(crud) }));
  }
  return shapesByContract.get(crud);
}

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
  const { own, linked: shapes } = contractShapes(crud);

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
   * Each record a relationship the shapes name links to, with what it shows: [(type, id) key, shape] pairs.
   * @param {Record<string, any>} record
   * @param {Map<string, ReturnType<typeof includedShape>>} linked The shapes of the relationships kept, by name.
   */
  function linkedRecords(record, linked) {
    return Object.entries(record.relationships || {}).flatMap(([name, { data }]) => {
      const shape = linked.get(name);
      return shape ? (Array.isArray(data) ? data : data ? [data] : []).map(({ type, id }) => [`${type}:${id}`, shape]) : [];
    });
  }

  /**
   * The document as the contract shows it: its records, and only the included records a kept relationship reaches,
   * each shaped by what the contract lists for every relationship that reaches it.
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
      /** @type {Map<string, Set<ReturnType<typeof includedShape>>>} The shapes that reach each included record. */
      const reachedBy = new Map();
      const pending = records.flatMap((record) => linkedRecords(record, shapes));
      while (pending.length > 0) {
        const [key, shape] = pending.pop();
        const shapesOfRecord = reachedBy.get(key) ?? new Set();
        if (!included.has(key) || shapesOfRecord.has(shape)) continue;
        reachedBy.set(key, shapesOfRecord.add(shape));
        pending.push(...linkedRecords(included.get(key), shape.linked));
      }
      shown.included = document.included.flatMap((record) => {
        const reaching = [...(reachedBy.get(`${record.type}:${record.id}`) ?? [])];
        return reaching.length < 1 ? [] : [shownRecord(record, {
          attributes: new Set(reaching.flatMap((shape) => [...shape.attributes])),
          relationshipNames: new Set(reaching.flatMap((shape) => [...shape.relationshipNames]))
        })];
      });
    }
    return returnJsonApiDocument(shown);
  }

  /**
   * What the repository, or a decorator over it, receives: the caller's context and transaction, and the one setting
   * the service names, JSON:API documents. A decorator passes only `{ context, trx }` on to another table.
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  function documentOptions(options) {
    return { ...passedOn(options), format: "jsonapi" };
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
    try {
      return answer(requireDocument(await repository.get(recordId, buildJsonRestQueryParams(resourceName, query), documentOptions(options))));
    } catch (error) {
      throw isNotFound(error, resourceName) ? documentNotFound() : error;
    }
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
      throw isNotFound(error, resourceName) ? documentNotFound() : error;
    }
  }

  /**
   * Deletes the record and answers its id; a record that is already gone answers null.
   * @param {unknown} recordId
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function deleteRecord(recordId, options) {
    try {
      return await repository.delete(recordId, passedOn(options));
    } catch (error) {
      if (isNotFound(error, resourceName)) return null;
      throw error;
    }
  }

  return Object.freeze({
    list,
    view,
    create,
    patch,
    delete: deleteRecord
  });
}

export { checkIncludedFields, createCrudService };
