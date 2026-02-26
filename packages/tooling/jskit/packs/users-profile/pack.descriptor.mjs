export default Object.freeze({
  packVersion: 2,
  packId: "users-profile",
  version: "0.1.0",
  description: "User profile core, storage, and client elements.",
  options: {},
  packages: [
    "@jskit-ai/user-profile-core",
    "@jskit-ai/user-profile-knex-mysql",
    "@jskit-ai/profile-client-element",
    "@jskit-ai/members-admin-client-element"
  ]
});
