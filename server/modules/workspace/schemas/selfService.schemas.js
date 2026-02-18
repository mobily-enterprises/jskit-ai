import { Type } from "@fastify/type-provider-typebox";
import { enumSchema } from "../../api/schemas.js";
import { schema as sharedSchema } from "./shared.schemas.js";

const pendingInvites = Type.Object(
  {
    pendingInvites: Type.Array(sharedSchema.pendingInviteSummary)
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

const respondToInvite = Type.Object(
  {
    ok: Type.Boolean(),
    decision: enumSchema(["accepted", "refused"]),
    inviteId: Type.Integer({ minimum: 1 }),
    workspace: Type.Union([sharedSchema.active, Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const workspacesList = Type.Object(
  {
    workspaces: Type.Array(sharedSchema.summary)
  },
  {
    additionalProperties: false
  }
);

const select = Type.Object(
  {
    workspaceSlug: Type.String({ minLength: 1, maxLength: 160 })
  },
  {
    additionalProperties: false
  }
);

const selectResponse = Type.Object(
  {
    ok: Type.Boolean(),
    workspace: sharedSchema.active,
    membership: Type.Union([sharedSchema.membershipSummary, Type.Null()]),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    workspaceSettings: sharedSchema.settingsSummary
  },
  {
    additionalProperties: false
  }
);

const schema = {
  response: {
    pendingInvites,
    respondToInvite,
    workspacesList,
    select: selectResponse
  },
  body: {
    redeemInvite,
    select
  }
};

export { schema };
