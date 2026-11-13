import { detectDialectFromClient } from "@jskit-ai/database-runtime/shared";
import { checkBlobReads, namedBlobs } from "./handleBlobs.js";
import { missingOf, requireDefinedFilters } from "./handleGuards.js";
import { defaultFieldList, handleRecords, includedRelationships, sparseFieldset, textList } from "./handleRecords.js";
import { resolveJsonRestCollectionRelationships } from "./jsonRestValues.js";

// The row lock a locking read takes. "update" (the default) is FOR UPDATE. "noKeyUpdate" is PostgreSQL's FOR NO KEY
// UPDATE, which still keeps every other lock and write of the row out but lets other transactions insert rows that
// reference it (a foreign key's check takes FOR KEY SHARE); MySQL, MariaDB and SQLite have no weaker exclusive lock and
// lock as for "update".
const LOCK_MODES = Object.freeze(["update", "noKeyUpdate"]);
// lock, lockMany and lockWhere also take "share": FOR SHARE (LOCK IN SHARE MODE on MySQL and MariaDB), which other
// reads and shared locks pass and writes and exclusive locks wait for, for a read check whose rows must not change until
// the transaction ends. A row held shared is never written in the same transaction: two transactions that each hold it
// shared and then write it deadlock.
const SHARED_LOCK_MODES = Object.freeze([...LOCK_MODES, "share"]);
// Why the methods that take or write their rows refuse "share".
const NO_SHARE = Object.freeze({
  claim: "a claimed row is taken to be worked on, and a shared lock would let another worker claim it too",
  patchWhere: "it writes the rows it selects, and two transactions that each hold a row shared and then write it deadlock",
  lockOrCreate: "its work writes the record it locks, and two transactions that each hold it shared and then write it deadlock"
});

/**
 * json-rest-api's lock mode for a locking read: none when the call names none, so json-rest-api takes its default.
 * Another value is a TypeError naming the handle method, before anything runs: "share" too for claim, patchWhere and
 * lockOrCreate, which take or write their rows.
 * @param {string} name The resource's name.
 * @param {string} caller The handle method, for the message.
 * @param {unknown} lockMode
 */
function lockModeOf(name, caller, lockMode) {
  if (lockMode === undefined) {
    return {};
  }
  const refusal = Object.hasOwn(NO_SHARE, caller) ? NO_SHARE[/** @type {keyof typeof NO_SHARE} */ (caller)] : null;
  if (lockMode === "share" && refusal) {
    throw new TypeError(`${name}.${caller}() takes lockMode "update" (the default) or "noKeyUpdate", not "share": ${refusal}.`);
  }
  if (!(refusal ? LOCK_MODES : SHARED_LOCK_MODES).includes(/** @type {string} */ (lockMode))) {
    const modes = refusal ? '"update" (the default) or "noKeyUpdate"' : '"update" (the default), "noKeyUpdate" or "share"';
    throw new TypeError(`${name}.${caller}() lockMode is ${modes}. Received: ${JSON.stringify(lockMode)}`);
  }
  return { lockMode };
}

// The most rows one read of the locked rows' links names, as the lock itself reads its ids in chunks of 1,000.
const LINKS_PER_READ = 1000;

/**
 * The relationships a locking read includes, each a belongs-to field of the resource named by its relationship (`as`,
 * or the field's own name): `{ relationshipName, field, target, below }`, `below` the include paths under it. A lock
 * includes the records its rows name, each locked after them; a collection, or a name that is no belongs-to
 * relationship, is a TypeError before anything runs.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {string} caller The handle method, for the message.
 * @param {unknown} include
 */
function lockedIncludes(resource, caller, include) {
  const links = new Map(Object.entries(resource.schema)
    .filter(([, definition]) => typeof definition?.belongsTo === "string")
    .map(([field, definition]) => [definition.as || field, { field, target: definition.belongsTo }]));
  return [...includedRelationships(include)].map(([relationshipName, below]) => {
    const link = links.get(relationshipName);
    if (!link) {
      throw new TypeError(
        `${resource.name}.${caller}() includes "${relationshipName}", which is no belongs-to relationship of ` +
          `${resource.name}: a lock includes only the records its rows name, and locks each of them after its rows. ` +
          "Lock a collection's rows with that table's own lockWhere() in the same transaction."
      );
    }
    return Object.freeze({
      relationshipName,
      ...link,
      below
    });
  });
}

/**
 * A handle's locking reads: lock, lockMany, lockWhere and claim. Each needs the
 * caller's transaction (`options.trx`), locks only rows the caller may see, and
 * reads the fields `options.fields` names, or every field a one-record read
 * answers, so a belongs-to field left out costs no check that its related
 * record is visible. `include` names belongs-to relationships whose records the
 * lock locks too, after its own rows (see withLockedIncludes).
 * @param {object} dependencies
 * @param {{ knex: { instance: any, helpers: { getStorageAdapter(scopeName: string): any } } }} dependencies.api
 *   The table's json-rest-api host, whose storage adapter names the table's columns.
 * @param {string} dependencies.name The resource's name.
 * @param {{ name: string, tableName: string, schema: Record<string, any> }} dependencies.resource
 * @param {() => Record<string, any>} dependencies.jsonRest The table's json-rest-api resource.
 * @param {(params: { fields?: unknown }, kind: "view") => unknown} dependencies.readFields The fields a read names.
 * @param {(options: object) => object} dependencies.contextOf The call's json-rest-api context, after its scope checks.
 * @param {import("./types.js").HiddenFieldReads} dependencies.hiddenFields The hidden
 *   fields `options.fields` names, read after the lock.
 * @param {(name: string) => ({ lockMany: Function } | null)} dependencies.handleNamed The handles of the application's
 *   owned tables by resource name, which lock included records.
 * @param {(name: string) => ({ schema: Record<string, any>, relationships?: Record<string, any> } | null)} dependencies.resourceNamed
 *   The application's table resources by name, whose collections an included record leaves out.
 */
function createLockReads({ api, name, resource, jsonRest, readFields, contextOf, hiddenFields, handleNamed, resourceNamed }) {
  /**
   * The collections of a related table an included record leaves out, as a read's include does (see handleRecord):
   * every one it does not include itself.
   * @param {string} target
   * @param {string[]} below The include paths under the relationship.
   */
  function collectionsLeftOut(target, below) {
    const included = includedRelationships(below);
    return Object.keys(resolveJsonRestCollectionRelationships(resourceNamed(target))).filter((relationshipName) => !included.has(relationshipName));
  }

  /**
   * The fields a locking read with includes names: the caller's own, or every field a one-record read answers, less
   * the included relationships, whose links withLockedIncludes reads itself.
   * @param {unknown} fields
   * @param {ReadonlyArray<{ relationshipName: string, field: string }>} includes
   */
  function fieldsBeside(fields, includes) {
    const left = new Set(includes.flatMap(({ relationshipName, field }) => [relationshipName, field]));
    const named = fields === undefined ? defaultFieldList(jsonRest().vars.schemaInfo) : fields;
    return Array.isArray(named) ? named.filter((field) => !left.has(field)) : named;
  }

  /**
   * The locked rows' links as the database holds them now, `{ [field]: id | null }` by row id, for the belongs-to
   * fields named: on MySQL and MariaDB a locking read (FOR SHARE, of rows this transaction already holds), which sees
   * them as locked whatever snapshot the transaction's plain reads keep; elsewhere a plain read, which sees them too.
   * The rows are the lock's own, so its scope already applied: only their links are read.
   * @param {string[]} ids
   * @param {string[]} fields
   * @param {{ trx: any }} options
   */
  async function currentLinks(ids, fields, options) {
    const adapter = api.knex.helpers.getStorageAdapter(name);
    const idColumn = adapter.getIdColumn();
    const locking = detectDialectFromClient(options.trx) === "mysql";
    const links = new Map();
    for (let start = 0; start < ids.length; start += LINKS_PER_READ) {
      const part = ids.slice(start, start + LINKS_PER_READ).map((id) => adapter.translateFilterValue("id", id));
      const read = options.trx(resource.tableName)
        .whereIn(idColumn, part)
        .select({ id: idColumn, ...Object.fromEntries(fields.map((field) => [field, adapter.translateColumn(field)])) });
      for (const row of await (locking ? read.forShare() : read)) {
        links.set(String(row.id), Object.fromEntries(fields.map((field) => [field, row[field] == null ? null : String(row[field])])));
      }
    }
    return links;
  }

  /**
   * The locked records with each included record locked and nested under its relationship, as a read's include
   * nests it: through the related table's own handle (its scope, its row policy, its hidden fields), in id order,
   * after the lock's rows, with `missing: "skip"`, in the call's lock mode, each included type once however many rows
   * name it, and the paths below it included the same way. The links come from currentLinks, so a record committed
   * after the transaction's first plain read is found and locked. A link to a record the caller may not see reads as
   * a read's does: the belongs-to field null, the relationship undefined.
   * @param {Array<Record<string, any>>} records
   * @param {ReadonlyArray<{ relationshipName: string, field: string, target: string, below: string[] }>} includes
   * @param {{ context?: object | null, trx: any, lockMode?: string }} options
   */
  async function withLockedIncludes(records, includes, options) {
    if (records.length < 1) {
      return records;
    }
    const links = await currentLinks(records.map(({ id }) => String(id)), includes.map(({ field }) => field), options);
    const answered = records.map((record) => ({ ...record }));
    for (const { relationshipName, field, target, below } of includes) {
      const handle = handleNamed(target);
      if (!handle) {
        throw new TypeError(`${name} includes "${relationshipName}" from "${target}", which no feature owns.`);
      }
      const linked = (record) => links.get(String(record.id))?.[field] ?? null;
      const ids = [...new Set(answered.map(linked).filter((id) => id !== null))];
      const locked = ids.length < 1 ? [] : await handle.lockMany(ids, {
        context: options.context,
        trx: options.trx,
        missing: "skip",
        ...(options.lockMode === undefined ? {} : { lockMode: options.lockMode }),
        ...(below.length > 0 ? { include: below } : {})
      });
      const leftOut = collectionsLeftOut(target, below);
      const byId = new Map(locked.map((record) => {
        const shaped = { ...record };
        for (const relationshipName of leftOut) {
          delete shaped[relationshipName];
        }
        return [String(record.id), shaped];
      }));
      // As a read answers it: a record it may not see, or none, leaves the link null and the relationship undefined.
      for (const record of answered) {
        const related = byId.get(String(linked(record)));
        if (relationshipName !== field) {
          record[field] = related === undefined ? null : String(related.id);
        }
        record[relationshipName] = related;
      }
    }
    return answered;
  }

  // A locking read (json-rest-api's lockByIds, lockWhere or claim) of the fields options.fields names, as records, in the
  // lock mode options.lockMode names, with the records `include` names locked after it. `caller` is the handle method,
  // for the messages.
  async function lockRead(caller, method, read, options, include = options.include) {
    const includes = lockedIncludes(resource, caller, include);
    // lock() and lockMany() hold their ids' blobs, lockWhere() and claim() any number of rows, so they name none.
    checkBlobReads(name, caller, namedBlobs(resource, options.fields, () => null), method === "lockByIds" ? read.ids.length : Infinity);
    const mode = lockModeOf(name, caller, options.lockMode);
    const hidden = hiddenFields.named(options.fields, "plain");
    const named = readFields({ fields: options.fields }, "view");
    const fields = includes.length > 0 ? fieldsBeside(named, includes) : named;
    const { data } = await jsonRest()[method]({
      ...read,
      ...mode,
      transaction: options.trx,
      format: "plain",
      ...(fields ? { queryParams: { fields: sparseFieldset(resource, fields) } } : {})
    }, contextOf(options));
    const records = await hiddenFields.add(handleRecords(resource, data, { fields }), hidden, options);
    return includes.length > 0 ? withLockedIncludes(records, includes, options) : records;
  }

  /**
   * Locks the visible rows among the ids, in id order, and answers them; hidden or missing ids throw, or are
   * left out with `missing: "skip"`. MySQL locks every listed id, a hidden one too: take ids from scoped reads.
   * `fields` names the fields the lock reads, so a belongs-to field left out costs no check that its related
   * record is visible; without it every field is read. `lockMode: "noKeyUpdate"` takes PostgreSQL's FOR NO KEY
   * UPDATE, so other transactions may still insert rows that reference the locked ones (see LOCK_MODES), and
   * `lockMode: "share"` a shared lock, which other reads and shared locks pass, for rows this transaction only reads.
   * `include` names belongs-to relationships whose records are locked after the rows, through their own tables'
   * handles, and nested as a read's include nests them (see withLockedIncludes).
   * @param {unknown[]} ids
   * @param {{ context?: object | null, trx: object, missing?: "throw" | "skip", fields?: string[], lockMode?: "update" | "noKeyUpdate" | "share", include?: string | string[] }} options
   */
  async function lockMany(ids, options) {
    return lockRead("lockMany", "lockByIds", { ids, ...(options.missing ? { missing: options.missing } : {}) }, options);
  }

  // lockMany for lock(): its messages name lock().
  function lockOne(id, options) {
    return lockRead("lock", "lockByIds", { ids: [id], ...(options.missing ? { missing: options.missing } : {}) }, options);
  }

  /**
   * Locks the record's row until the transaction ends and answers it as the
   * lock saw it. Needs options.trx. A missing or hidden record throws
   * json-rest-api's not-found error, or answers null with `missing: "skip"`.
   * `fields` reads only the fields the work needs, and `lockMode` picks the lock (see lockMany).
   * @param {unknown} id
   * @param {{ context?: object | null, trx: object, missing?: "throw" | "skip", fields?: string[], lockMode?: "update" | "noKeyUpdate" | "share", include?: string | string[] }} options
   */
  async function lock(id, options) {
    missingOf(name, "lock", options.missing);
    const [record] = await lockOne(id, options);
    return record ?? null;
  }

  /**
   * Locks the caller's rows the filters select until the transaction ends and answers them; it waits for
   * transactions holding them, so a row that starts to match meanwhile is locked too. At most 1,000 rows
   * (RestApiRowLimitError past that). It does not lock rows inserted later: unique numbers take a unique index, or a
   * counter row taken with lock(). On MySQL it needs an index starting with the ownership columns (no owners: with a
   * filtered column), or it refuses.
   * Without `sort` or `limit` it locks in id order, on MySQL and MariaDB in the order of that index. `sort` (stored
   * fields, "-" for descending) locks and answers the rows in that order, then by id, so every writer that locks
   * them takes them in one order; `limit` locks only the first `limit` of them (1 to 1,000), by `sort` or else by
   * id: `limit: 1` locks one row by a unique key in one statement, as lock(id) does. On MySQL and MariaDB either
   * needs an index that reads in that order: after the ownership columns and the filters' single-value equalities,
   * the sort's columns.
   * `fields` reads only the fields the work needs, and `lockMode` picks the lock (see lockMany).
   * @param {object} filters
   * @param {{ context?: object | null, trx: object, fields?: string[], lockMode?: "update" | "noKeyUpdate" | "share", include?: string | string[], sort?: string | string[], limit?: number }} options
   */
  async function lockWhere(filters, options) {
    requireDefinedFilters(name, "lockWhere", filters);
    return lockRead("lockWhere", "lockWhere", {
      filters,
      ...(options.sort === undefined ? {} : { sort: textList(options.sort) }),
      ...(options.limit === undefined ? {} : { limit: options.limit })
    }, options);
  }

  /**
   * Takes up to `take` (default 1) of the rows the filters select that no
   * other transaction holds, in `sort` order, locked until the transaction ends.
   * `fields` reads only the fields the work needs, and `lockMode` picks the lock (see lockMany).
   * `include` (in params or options, not both) locks and nests the records the rows name, as lockMany's does.
   * @param {{ filters: object, sort?: string | string[], take?: number, include?: string | string[] }} params
   * @param {{ context?: object | null, trx: object, fields?: string[], lockMode?: "update" | "noKeyUpdate", include?: string | string[] }} options
   */
  async function claim({ filters, sort, take, include } = {}, options, ...rest) {
    if (rest.length > 0) {
      throw new TypeError(`${name}.claim() takes ({ filters, sort, take, include }, options).`);
    }
    if (include !== undefined && options?.include !== undefined) {
      throw new TypeError(`${name}.claim() takes include once: in its params or in its options, not both.`);
    }
    requireDefinedFilters(name, "claim", filters);
    return lockRead("claim", "claim", {
      filters,
      ...(take === undefined ? {} : { limit: take }),
      ...(sort === undefined ? {} : { sort: textList(sort) })
    }, options, include ?? options.include);
  }

  return Object.freeze({
    lock,
    lockMany,
    lockWhere,
    claim
  });
}

export { createLockReads, lockModeOf };
