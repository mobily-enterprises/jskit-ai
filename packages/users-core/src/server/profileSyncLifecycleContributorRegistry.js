import { registerTaggedSingleton, resolveTaggedEntries } from "@jskit-ai/kernel/server/registries";

const PROFILE_SYNC_LIFECYCLE_CONTRIBUTOR_TAG = "jskit.users.profileSync.lifecycleContributors";

function normalizeProfileSyncLifecycleContributor(entry) {
  if (typeof entry === "function") {
    return Object.freeze({
      contributorId: String(entry.name || "anonymous"),
      order: 0,
      afterIdentityProfileSynced: entry
    });
  }

  if (!entry || typeof entry !== "object" || typeof entry.afterIdentityProfileSynced !== "function") {
    return null;
  }

  const contributorId = String(entry.contributorId || "anonymous");
  const order = Number.isFinite(entry.order) ? Number(entry.order) : 0;

  return Object.freeze({
    ...entry,
    contributorId,
    order,
    afterIdentityProfileSynced: entry.afterIdentityProfileSynced
  });
}

function registerProfileSyncLifecycleContributor(app, token, factory) {
  registerTaggedSingleton(app, token, factory, PROFILE_SYNC_LIFECYCLE_CONTRIBUTOR_TAG, {
    context: "registerProfileSyncLifecycleContributor"
  });
}

function resolveProfileSyncLifecycleContributors(scope) {
  return resolveTaggedEntries(scope, PROFILE_SYNC_LIFECYCLE_CONTRIBUTOR_TAG)
    .map((entry, index) => ({
      contributor: normalizeProfileSyncLifecycleContributor(entry),
      index
    }))
    .filter((entry) => Boolean(entry.contributor))
    .sort((left, right) => {
      if (left.contributor.order !== right.contributor.order) {
        return left.contributor.order - right.contributor.order;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.contributor);
}

export {
  PROFILE_SYNC_LIFECYCLE_CONTRIBUTOR_TAG,
  registerProfileSyncLifecycleContributor,
  resolveProfileSyncLifecycleContributors
};
