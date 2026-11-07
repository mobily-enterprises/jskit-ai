// The checks that keep a handle's calls inside their scope: a call never reaches rows beyond
// the caller's because a context, a filter value or an expression was missing or misused.

// The ways a Knex raw expression runs as a statement of its own. raw() answers a value for a scoped query, so each of
// these throws: an awaited raw expression would run its SQL with no ownership scope at all.
const STATEMENT_METHODS = Object.freeze(new Set(["then", "catch", "finally", "asCallback", "stream", "pipe"]));

/**
 * A Knex raw expression that works only as a value: in a select, a where or a write.
 * @param {string} name The resource's name.
 * @param {object} expression
 */
function valueOnly(name, expression) {
  return new Proxy(expression, {
    get(target, property, receiver) {
      if (STATEMENT_METHODS.has(property)) {
        return () => {
          throw new TypeError(`${name}.raw() is a value inside a scoped query or a write; it never runs as a statement of its own.`);
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

export { valueOnly };
