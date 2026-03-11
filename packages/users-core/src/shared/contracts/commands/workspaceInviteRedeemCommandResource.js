import { Type } from "typebox";
import { createOperationMessages } from "../contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

const workspaceInviteRedeemInputValidator = Object.freeze({
  schema: Type.Object(
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
  ),
  normalize: normalizeObjectInput
});

const workspaceInviteRedeemOutputValidator = Object.freeze({
  schema: Type.Object(
    {
      decision: Type.Union([Type.Literal("accepted"), Type.Literal("refused")])
    },
    { additionalProperties: false }
  )
});

const WORKSPACE_INVITE_REDEEM_MESSAGES = createOperationMessages();

const workspaceInviteRedeemCommandResource = Object.freeze({
  command: "workspace.invite.redeem",
  messages: WORKSPACE_INVITE_REDEEM_MESSAGES,
  operation: Object.freeze({
    method: "POST",
    messages: WORKSPACE_INVITE_REDEEM_MESSAGES,
    body: workspaceInviteRedeemInputValidator,
    output: workspaceInviteRedeemOutputValidator,
    idempotent: false,
    invalidates: Object.freeze([
      "workspace.invitations.pending.list",
      "workspace.workspaces.list",
      "workspace.bootstrap.read"
    ])
  })
});

export { workspaceInviteRedeemCommandResource };
