import { schema as communicationsSchema } from "@jskit-ai/communications-contracts/server";

function buildRoutes(controllers, { missingHandler, withStandardErrorResponses } = {}) {
  if (typeof withStandardErrorResponses !== "function") {
    throw new Error("withStandardErrorResponses is required.");
  }

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
        body: communicationsSchema.body.sendSms,
        response: withStandardErrorResponses(
          {
            200: communicationsSchema.response.sendSms
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
