/**
 * The `auth.profile.projector` default when no feature provides one: the
 * application keeps no profiles of its own, so an auth provider's actors carry
 * only the provider's user.
 * @type {import("./types.js").AuthProfileProjector}
 */
const noAppProfiles = Object.freeze({
  async syncIdentityProfile() {
    return null;
  },
  async findByIdentity() {
    return null;
  }
});

export { noAppProfiles };
