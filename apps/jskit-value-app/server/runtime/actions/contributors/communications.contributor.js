function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function requireServiceMethod(service, methodName, contributorId) {
  if (!service || typeof service[methodName] !== "function") {
    throw new Error(`${contributorId} requires ${methodName}().`);
  }
}

const OBJECT_INPUT_SCHEMA = Object.freeze({
  parse(value) {
    return normalizeObject(value);
  }
});

function createCommunicationsActionContributor({ communicationsService } = {}) {
  const contributorId = "app.communications";

  requireServiceMethod(communicationsService, "sendSms", contributorId);

  return {
    contributorId,
    domain: "workspace",
    actions: Object.freeze([
      {
        id: "workspace.sms.send",
        version: 1,
        kind: "command",
        channels: ["api", "internal"],
        surfaces: ["admin"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: ["workspace.members.invite"],
        idempotency: "none",
        audit: {
          actionName: "workspace.sms.send"
        },
        observability: {},
        async execute(input) {
          return communicationsService.sendSms(normalizeObject(input));
        }
      }
    ])
  };
}

export { createCommunicationsActionContributor };
