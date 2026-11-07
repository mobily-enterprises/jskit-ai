import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { userProfileResource } from "@jskit-ai/users-core/shared/resources/userProfileResource";

// The users list and view. The users table has one table resource, users-core's
// userProfileResource; this contract chooses the operations and the fields they
// return, and the list searches with the resource's q (display name, email and
// username).
const userCrud = defineCrudContract(userProfileResource, {
  namespace: "users",
  operations: ["list", "view"],
  fields: {
    displayName: { output: "optional" },
    email: { output: "optional" },
    username: { output: "optional" },
    createdAt: { output: "required" },
    updatedAt: { output: "required" },
    // The sign-in identity and the avatar's storage stay out of administration.
    authProvider: {},
    authProviderUserSid: {},
    avatarStorageKey: {},
    avatarVersion: {},
    avatarUpdatedAt: {}
  }
});

export { userCrud };
