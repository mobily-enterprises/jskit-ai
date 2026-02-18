import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "../../../../shared/auth/authConstraints.js";
import { SETTINGS_MODE_OPTIONS, SETTINGS_TIMING_OPTIONS } from "../../../../shared/settings/index.js";
import { enumSchema } from "../../api/schemas.js";
import { schema as sharedSchema } from "./shared.schema.js";

const settings = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        color: Type.String({ minLength: 7, maxLength: 7, pattern: sharedSchema.fields.colorPattern }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    settings: sharedSchema.settingsSummary,
    roleCatalog: sharedSchema.roleCatalog
  },
  {
    additionalProperties: false
  }
);

const settingsUpdate = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    color: Type.Optional(
      Type.String({ minLength: 7, maxLength: 7, pattern: sharedSchema.fields.colorPattern })
    ),
    avatarUrl: Type.Optional(Type.String()),
    invitesEnabled: Type.Optional(Type.Boolean()),
    defaultMode: Type.Optional(enumSchema(SETTINGS_MODE_OPTIONS)),
    defaultTiming: Type.Optional(enumSchema(SETTINGS_TIMING_OPTIONS)),
    defaultPaymentsPerYear: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    defaultHistoryPageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    appDenyEmails: Type.Optional(
      Type.Array(
        Type.String({
          minLength: AUTH_EMAIL_MIN_LENGTH,
          maxLength: AUTH_EMAIL_MAX_LENGTH,
          pattern: AUTH_EMAIL_PATTERN
        })
      )
    ),
    appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 })))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const members = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    members: Type.Array(sharedSchema.member),
    roleCatalog: sharedSchema.roleCatalog
  },
  {
    additionalProperties: false
  }
);

const memberRoleUpdate = Type.Object(
  {
    roleId: Type.String({ minLength: 1, maxLength: 64 })
  },
  {
    additionalProperties: false
  }
);

const invites = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    invites: Type.Array(sharedSchema.invite),
    roleCatalog: sharedSchema.roleCatalog,
    createdInvite: Type.Optional(
      Type.Object(
        {
          inviteId: Type.Integer({ minimum: 1 }),
          email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
          token: Type.String({ minLength: 16, maxLength: 256 })
        },
        {
          additionalProperties: false
        }
      )
    )
  },
  {
    additionalProperties: false
  }
);

const createInvite = Type.Object(
  {
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    roleId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const roles = Type.Object(
  {
    roleCatalog: sharedSchema.roleCatalog
  },
  {
    additionalProperties: false
  }
);

const invite = Type.Object(
  {
    inviteId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const member = Type.Object(
  {
    memberUserId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const schema = {
  response: {
    settings,
    members,
    invites,
    roles
  },
  body: {
    settingsUpdate,
    memberRoleUpdate,
    createInvite
  },
  params: {
    invite,
    member
  }
};

export { schema };
