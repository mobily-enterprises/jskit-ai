import { normalizeObject } from "../../shared/support/normalize.js";
import { normalizeContributorEntry, registerTaggedSingleton, resolveTaggedEntries } from "./primitives.js";

function registerBootstrapPayloadContributor(app, token, factory) {
  registerTaggedSingleton(app, token, factory, "jskit.runtime.bootstrap.payloadContributors", {
    context: "registerBootstrapPayloadContributor"
  });
}

function resolveBootstrapPayloadContributors(scope) {
  return resolveTaggedEntries(scope, "jskit.runtime.bootstrap.payloadContributors")
    .map((entry, index) => ({
      contributor: normalizeContributorEntry(entry),
      index
    }))
    .filter((entry) => Boolean(entry.contributor))
    .sort((left, right) => {
      const leftOrder = Number.isFinite(left.contributor?.order) ? Number(left.contributor.order) : 0;
      const rightOrder = Number.isFinite(right.contributor?.order) ? Number(right.contributor.order) : 0;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.contributor);
}

async function resolveBootstrapPayload(scope, context = {}) {
  const contributors = resolveBootstrapPayloadContributors(scope);
  let payload = {};

  for (const contributor of contributors) {
    const contribution = await contributor.contribute({
      ...normalizeObject(context),
      payload: Object.freeze({ ...payload })
    });
    payload = {
      ...payload,
      ...normalizeObject(contribution)
    };
  }

  return payload;
}

export {
  registerBootstrapPayloadContributor,
  resolveBootstrapPayloadContributors,
  resolveBootstrapPayload
};
