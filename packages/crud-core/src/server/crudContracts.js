import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";

/**
 * The CRUD contracts an application serves, by the JSON:API type of their
 * records (their table resource's name) and by namespace. Each CRUD feature
 * registers its contract during setup; the registry is sealed at boot, and
 * read only after that, so a CRUD service can show an included record of
 * another table only as that table's own contract shows it.
 */
function createCrudContracts() {
  /** @type {import("./types.js").CrudContract[]} */
  const registered = [];
  /** @type {Map<string, import("./types.js").CrudContract[]> | null} */
  let byType = null;
  /** @type {Map<string, import("./types.js").CrudContract> | null} */
  let byNamespace = null;

  /**
   * Adds a served contract. One contract served on several surfaces registers once; two contracts under one namespace
   * are refused, since an include that names the namespace could not tell them apart.
   * @param {import("./types.js").CrudContract} crud
   */
  function register(crud) {
    if (byType) {
      throw new Error(`CRUD contract "${crud.namespace}" registered after boot: CRUD features register their contracts during setup.`);
    }
    const same = registered.find((entry) => entry.namespace === crud.namespace);
    if (same && same !== crud) {
      throw new Error(`Two CRUD contracts are served under the namespace "${crud.namespace}". Give each contract its own namespace.`);
    }
    if (!same) {
      registered.push(crud);
    }
  }

  function seal() {
    byType = Map.groupBy(registered, (crud) => crud.resource.name);
    byNamespace = new Map(registered.map((crud) => [crud.namespace, crud]));
  }

  function sealedIndex() {
    if (!byType || !byNamespace) {
      throw new Error("CRUD contracts are read after boot, once every CRUD feature has registered its contract.");
    }
    return { byType, byNamespace };
  }

  /**
   * The contracts on the table whose records have this JSON:API type.
   * @param {string} type
   */
  function forType(type) {
    return sealedIndex().byType.get(type) ?? [];
  }

  /**
   * The contract served under a namespace, or null.
   * @param {string} namespace
   */
  function forNamespace(namespace) {
    return sealedIndex().byNamespace.get(namespace) ?? null;
  }

  return Object.freeze({
    register,
    seal,
    forType,
    forNamespace
  });
}

const CrudContractsProvider = defineProvider({
  id: "crud.contracts",
  provides: {
    contracts: "crud.contracts"
  },
  setup: () => ({ contracts: createCrudContracts() }),
  /** @param {object} _dependencies @param {{ outputs: { contracts: ReturnType<typeof createCrudContracts> } }} context */
  boot(_dependencies, { outputs }) {
    outputs.contracts.seal();
  }
});

export { CrudContractsProvider, createCrudContracts };
