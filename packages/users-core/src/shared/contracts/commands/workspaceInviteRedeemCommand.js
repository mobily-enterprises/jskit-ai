import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const workspaceInviteRedeemInputSchema = Type.Object(
  {
    token: Type.String({ minLength: 1 }),
    decision: Type.Union([Type.Literal("accept"), Type.Literal("refuse")])
  },
  { additionalProperties: false }
);

const workspaceInviteRedeemOutputSchema = Type.Object({}, { additionalProperties: true });

const workspaceInviteRedeemCommand = Object.freeze({
  command: "workspace.invite.redeem",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: workspaceInviteRedeemInputSchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: workspaceInviteRedeemOutputSchema
    }),
    idempotent: false,
    invalidates: Object.freeze([
      "workspace.invitations.pending.list",
      "workspace.workspaces.list",
      "workspace.bootstrap.read"
    ])
  })
});

export {
  workspaceInviteRedeemInputSchema,
  workspaceInviteRedeemOutputSchema,
  workspaceInviteRedeemCommand
};
