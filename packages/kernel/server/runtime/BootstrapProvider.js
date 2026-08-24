import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { isRecord, normalizeText } from "../../shared/support/normalize.js";
import { AUTH_POLICY_PUBLIC } from "../../shared/support/policies.js";

function createBootstrapRuntime() {
  const contributors = [];
  const contributorIds = new Set();
  let sealed = false;

  function register({ id, order = 0, contribute } = {}) {
    if (sealed) throw new Error("Bootstrap registration is closed after the first payload is resolved.");
    const contributorId = normalizeText(id);
    if (!contributorId) throw new TypeError("Bootstrap contributor id is required.");
    if (typeof contribute !== "function") throw new TypeError(`Bootstrap contributor "${contributorId}" requires contribute().`);
    if (contributorIds.has(contributorId)) throw new Error(`Bootstrap contributor "${contributorId}" is duplicated.`);
    contributorIds.add(contributorId);
    contributors.push(Object.freeze({ id: contributorId, order: Number.isFinite(order) ? Number(order) : 0, contribute }));
    return api;
  }

  async function resolve(context = {}) {
    sealed = true;
    let payload = {};
    const ordered = contributors
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => left.entry.order - right.entry.order || left.index - right.index)
      .map(({ entry }) => entry);
    for (const contributor of ordered) {
      const contribution = await contributor.contribute(Object.freeze({
        ...(isRecord(context) ? context : {}),
        payload: Object.freeze({ ...payload })
      }));
      payload = { ...payload, ...(isRecord(contribution) ? contribution : {}) };
    }
    return Object.freeze(payload);
  }

  function diagnostics() {
    return Object.freeze({
      sealed,
      contributorIds: Object.freeze(contributors.map((entry) => entry.id).sort())
    });
  }

  const api = Object.freeze({ register, resolve, diagnostics });
  return api;
}

const BootstrapProvider = defineProvider({
  id: "runtime.bootstrap",
  requires: { http: "runtime.http" },
  provides: { bootstrap: "runtime.bootstrap" },
  setup({ http }) {
    const bootstrap = createBootstrapRuntime();
    http.router.register("GET", "/api/bootstrap", {
      auth: AUTH_POLICY_PUBLIC,
      meta: { tags: ["bootstrap"], summary: "Resolve app bootstrap payload" }
    }, async (request, reply) => {
      reply.code(200).send(await bootstrap.resolve({
        request,
        reply,
        query: request.query || {}
      }));
    });
    return { bootstrap };
  }
});

export { BootstrapProvider, createBootstrapRuntime };
