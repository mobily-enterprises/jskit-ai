import { Type } from "typebox";
import { createOperationMessages } from "../contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

const workspaceInviteRedeemInputSchema = Type.Object(
  {
    token: Type.String({
      minLength: 1,
      messages: {
        required: "Invite token is required.",
        minLength: "Invite token is required.",
        default: "Invite token is invalid."
      }
    }),
    decision: Type.Union([Type.Literal("accept"), Type.Literal("refuse")], {
      messages: {
        required: "Decision is required.",
        default: "Decision must be accept or refuse."
      }
    })
  },
  {
    additionalProperties: false,
    messages: {
      additionalProperties: "Unexpected field."
    }
  }
);

const workspaceInviteRedeemOutputSchema = Type.Object({}, { additionalProperties: true });

const WORKSPACE_INVITE_REDEEM_MESSAGES = createOperationMessages();

const workspaceInviteRedeemCommand = Object.freeze({
  command: "workspace.invite.redeem",
  operation: Object.freeze({
    method: "POST",
    messages: WORKSPACE_INVITE_REDEEM_MESSAGES,
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
  WORKSPACE_INVITE_REDEEM_MESSAGES,
  workspaceInviteRedeemCommand
};
