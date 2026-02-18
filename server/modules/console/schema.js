import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "../../../shared/auth/authConstraints.js";
import { enumSchema } from "../api/schema.js";

const roleDescriptor = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    assignable: Type.Boolean(),
    permissions: Type.Array(Type.String({ minLength: 1 }))
  },
  {
    additionalProperties: false
  }
);

const roleCatalog = Type.Object(
  {
    defaultInviteRole: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    roles: Type.Array(roleDescriptor),
    assignableRoleIds: Type.Array(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const membershipSummary = Type.Object(
  {
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 })
  },
  {
    additionalProperties: false
  }
);

const inviteSummary = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    invitedByDisplayName: Type.String(),
    invitedByEmail: Type.String()
  },
  {
    additionalProperties: false
  }
);

const pendingInviteSummary = Type.Object(
  {
    ...inviteSummary.properties,
    token: Type.String({ minLength: 16, maxLength: 256 })
  },
  {
    additionalProperties: false
  }
);

const memberSummary = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    displayName: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    isConsole: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const bootstrap = Type.Object(
  {
    session: Type.Object(
      {
        authenticated: Type.Boolean(),
        userId: Type.Optional(Type.Integer({ minimum: 1 })),
        username: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]))
      },
      {
        additionalProperties: false
      }
    ),
    membership: Type.Union([membershipSummary, Type.Null()]),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    roleCatalog,
    pendingInvites: Type.Array(pendingInviteSummary),
    isConsole: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const members = Type.Object(
  {
    members: Type.Array(memberSummary),
    roleCatalog
  },
  {
    additionalProperties: false
  }
);

const invites = Type.Object(
  {
    invites: Type.Array(inviteSummary),
    roleCatalog,
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

const roles = Type.Object(
  {
    roleCatalog
  },
  {
    additionalProperties: false
  }
);

const pendingInvites = Type.Object(
  {
    pendingInvites: Type.Array(pendingInviteSummary)
  },
  {
    additionalProperties: false
  }
);

const respondToInvite = Type.Object(
  {
    ok: Type.Boolean(),
    decision: enumSchema(["accepted", "refused"]),
    inviteId: Type.Integer({ minimum: 1 }),
    membership: Type.Optional(membershipSummary)
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

const memberRoleUpdate = Type.Object(
  {
    roleId: Type.String({ minLength: 1, maxLength: 64 })
  },
  {
    additionalProperties: false
  }
);

const redeemInvite = Type.Object(
  {
    token: Type.String({ minLength: 16, maxLength: 256 }),
    decision: enumSchema(["accept", "refuse"])
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

const invite = Type.Object(
  {
    inviteId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const schema = {
  response: {
    bootstrap,
    members,
    invites,
    roles,
    pendingInvites,
    respondToInvite
  },
  body: {
    createInvite,
    memberRoleUpdate,
    redeemInvite
  },
  params: {
    member,
    invite
  }
};

export { schema };
