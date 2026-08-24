function normalizeContributor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Profile synchronization lifecycle contributor must be an object.");
  }
  const contributorId = String(value.contributorId || "").trim();
  if (!contributorId) {
    throw new TypeError("Profile synchronization lifecycle contributor requires contributorId.");
  }
  if (typeof value.afterIdentityProfileSynced !== "function") {
    throw new TypeError(`Profile synchronization lifecycle contributor "${contributorId}" requires afterIdentityProfileSynced().`);
  }
  return Object.freeze({
    ...value,
    contributorId,
    order: Number.isFinite(value.order) ? Number(value.order) : 0,
    afterIdentityProfileSynced: value.afterIdentityProfileSynced
  });
}

function createUsersExtensions() {
  const contributors = [];
  const contributorIds = new Set();
  let sealed = false;

  function registerProfileSyncLifecycleContributor(value) {
    if (sealed) {
      throw new Error("User extension registration is closed after profile synchronization starts.");
    }
    const contributor = normalizeContributor(value);
    if (contributorIds.has(contributor.contributorId)) {
      throw new Error(`Profile synchronization lifecycle contributor "${contributor.contributorId}" is duplicated.`);
    }
    contributorIds.add(contributor.contributorId);
    contributors.push(contributor);
    return api;
  }

  function profileSyncLifecycleContributors() {
    sealed = true;
    return Object.freeze(
      contributors
        .map((contributor, index) => ({ contributor, index }))
        .sort((left, right) => left.contributor.order - right.contributor.order || left.index - right.index)
        .map(({ contributor }) => contributor)
    );
  }

  function diagnostics() {
    return Object.freeze({
      sealed,
      profileSyncLifecycleContributorIds: Object.freeze(
        contributors.map((entry) => entry.contributorId).sort()
      )
    });
  }

  const api = Object.freeze({
    registerProfileSyncLifecycleContributor,
    profileSyncLifecycleContributors,
    diagnostics
  });
  return api;
}

export { createUsersExtensions };
