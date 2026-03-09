import { Type } from "typebox";
import {
  buildResourceRequiredMetadata,
  normalizeObjectInput
} from "../contractUtils.js";

const profileAvatarSchema = Type.Object({}, { additionalProperties: true });

const userProfileRecordSchema = Type.Object(
  {
    displayName: Type.String(),
    email: Type.String(),
    emailManagedBy: Type.Optional(Type.String()),
    emailChangeFlow: Type.Optional(Type.String()),
    avatar: Type.Optional(profileAvatarSchema)
  },
  { additionalProperties: true }
);

const userProfileCreateSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 })
  },
  { additionalProperties: false }
);

const userProfileReplaceSchema = userProfileCreateSchema;
const userProfilePatchSchema = Type.Partial(userProfileCreateSchema, {
  additionalProperties: false
});

const userProfileListSchema = Type.Object(
  {
    items: Type.Array(userProfileRecordSchema),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);

const userProfileSchema = Object.freeze({
  resource: "userProfile",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: userProfileRecordSchema
      })
    }),
    list: Object.freeze({
      method: "GET",
      response: Object.freeze({
        schema: userProfileListSchema
      })
    }),
    create: Object.freeze({
      method: "POST",
      body: Object.freeze({
        schema: userProfileCreateSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: userProfileRecordSchema
      })
    }),
    replace: Object.freeze({
      method: "PUT",
      body: Object.freeze({
        schema: userProfileReplaceSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: userProfileRecordSchema
      })
    }),
    patch: Object.freeze({
      method: "PATCH",
      body: Object.freeze({
        schema: userProfilePatchSchema,
        normalize: normalizeObjectInput
      }),
      response: Object.freeze({
        schema: userProfileRecordSchema
      })
    })
  }),
  required: buildResourceRequiredMetadata({
    create: userProfileCreateSchema,
    replace: userProfileReplaceSchema,
    patch: userProfilePatchSchema
  })
});

export {
  profileAvatarSchema,
  userProfileRecordSchema,
  userProfileCreateSchema,
  userProfileReplaceSchema,
  userProfilePatchSchema,
  userProfileListSchema,
  userProfileSchema
};
