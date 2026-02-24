import { schema } from "./schema.js";
import { withStandardErrorResponses } from "@jskit-ai/http-contracts/errorResponses";

function buildRoutes(controllers, { missingHandler } = {}) {
  return [
    {
      path: "/api/workspace/sms/send",
      method: "POST",
      auth: "required",
      workspacePolicy: "required",
      workspaceSurface: "admin",
      permission: "workspace.members.invite",
      schema: {
        tags: ["communications"],
        summary: "Send SMS using configured provider",
        body: schema.body.sendSms,
        response: withStandardErrorResponses(
          {
            200: schema.response.sendSms
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.communications?.sendSms || missingHandler
    }
  ];
}

export { buildRoutes };
