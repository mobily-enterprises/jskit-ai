import { symlinkSafeRequire } from "@jskit-ai/kernel/server/support";

function loadKnexFactory() {
  let moduleValue;
  try {
    moduleValue = symlinkSafeRequire("knex");
  } catch {
    throw new Error("Knex package is not installed. Install the selected JSKIT database runtime package with npm.");
  }

  const knexFactory =
    typeof moduleValue === "function"
      ? moduleValue
      // readable-check: allow method-probe - platform object: a required module is the factory or an ES namespace that holds it
      : typeof moduleValue?.default === "function"
        ? moduleValue.default
        : null;
  if (!knexFactory) {
    throw new Error("Knex package resolved but did not expose a callable factory.");
  }
  return knexFactory;
}

export { loadKnexFactory };
