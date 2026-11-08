// The ways a Knex raw expression runs as a statement of its own. A raw expression the runtime hands out is a value for
// a scoped query, a write or a query field's select, so each of these throws: a raw expression run on its own would run
// its SQL with no ownership scope at all.
const STATEMENT_METHODS = Object.freeze(new Set(["catch", "finally", "asCallback", "stream", "pipe"]));

/**
 * A Knex raw expression that works only as a value: in a select, a where or a write. It is no promise: its `then` is
 * undefined, so awaiting it answers the value itself and runs nothing, and code that tells a promise by its `then` (a
 * repository wrapper awaiting what a method answers) never mistakes it for one.
 * @param {string} label The call that made it, such as "notes.raw()".
 * @param {object} expression
 */
function valueOnly(label, expression) {
  return new Proxy(expression, {
    get(target, property, receiver) {
      if (property === "then") {
        return undefined;
      }
      if (STATEMENT_METHODS.has(property)) {
        return () => {
          throw new TypeError(`${label} is a value inside a scoped query or a write; it never runs as a statement of its own.`);
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

/**
 * One SQL expression as a value (see valueOnly): a string, with its values (and its identifiers, as `??` with
 * column()) as an array of bindings. Lint (jskit/sql-literal) keeps the string one literal in the source.
 * @param {string} label The call, such as "notes.raw()", that errors name.
 * @param {{ raw: (sql: string, bindings: unknown[]) => object }} knex The Knex client or transaction that builds it.
 * @param {unknown[]} args The call's arguments: the SQL, then its bindings.
 */
function valueOnlyRaw(label, knex, args) {
  const [sql, bindings, ...rest] = args;
  if (typeof sql !== "string" || !sql.trim()) {
    throw new TypeError(`${label} takes one SQL expression as a string.`);
  }
  if (rest.length > 0 || (bindings !== undefined && !Array.isArray(bindings))) {
    throw new TypeError(`${label} takes (sql, bindings): one SQL expression, then its bindings as an array.`);
  }
  if (/\?/u.test(sql) && !Array.isArray(bindings)) {
    throw new TypeError(`${label} needs the bindings of its placeholders.`);
  }
  return valueOnly(label, knex.raw(sql, bindings || []));
}

export { valueOnlyRaw };
