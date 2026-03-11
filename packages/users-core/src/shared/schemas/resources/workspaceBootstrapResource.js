import { Type } from "typebox";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { createOperationMessages } from "../../contracts/contractUtils.js";
import { workspaceResource } from "../../resources/workspaceResource.js";
import { workspaceSettingsResource } from "./workspaceSettingsResource.js";
import { workspacePendingInvitationsResource } from "./workspacePendingInvitationsResource.js";

const workspaceSummarySchema = workspaceResource.operations.list.output.schema.properties.items.items;
const membershipSummarySchema = Type.Object(
  {
    workspaceId: Type.Integer({ minimum: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const oauthProviderSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    label: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const bootstrapSessionSchema = Type.Object(
  {
    authenticated: Type.Boolean(),
    userId: Type.Optional(Type.Integer({ minimum: 1 })),
    oauthProviders: Type.Optional(Type.Array(oauthProviderSchema)),
    oauthDefaultProvider: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()]))
  },
  { additionalProperties: false }
);

const bootstrapProfileSchema = Type.Object(
  {
    displayName: Type.String(),
    email: Type.String(),
    avatar: Type.Optional(Type.Object({}, { additionalProperties: true }))
  },
  { additionalProperties: true }
);

const bootstrapOutputSchema = Type.Object(
  {
    session: bootstrapSessionSchema,
    profile: Type.Union([bootstrapProfileSchema, Type.Null()]),
    app: Type.Object({}, { additionalProperties: true }),
    workspaces: Type.Array(workspaceSummarySchema),
    pendingInvites: workspacePendingInvitationsResource.operations.list.output.schema.properties.pendingInvites,
    activeWorkspace: Type.Union([workspaceSummarySchema, Type.Null()]),
    membership: Type.Union([membershipSummarySchema, Type.Null()]),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    workspaceSettings: Type.Union([
      workspaceSettingsResource.operations.view.output.schema.properties.settings,
      Type.Null()
    ]),
    userSettings: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
    requestMeta: Type.Optional(Type.Object({}, { additionalProperties: true }))
  },
  { additionalProperties: false }
);

function normalizeBootstrapInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "workspaceSlug")) {
    normalized.workspaceSlug = normalizeLowerText(source.workspaceSlug);
  }
  if (Object.hasOwn(source, "user")) {
    const user = source.user;
    normalized.user = user && typeof user === "object" ? user : null;
  }

  return normalized;
}

function normalizeBootstrapOutput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const sessionSource = normalizeObjectInput(source.session);
  const oauthProviders = Array.isArray(sessionSource.oauthProviders)
    ? sessionSource.oauthProviders
        .map((entry) => normalizeObjectInput(entry))
        .map((entry) => ({
          id: normalizeLowerText(entry.id),
          label: normalizeText(entry.label)
        }))
        .filter((entry) => entry.id && entry.label)
    : [];
  const pendingInvites = workspacePendingInvitationsResource.operations.list.output.normalize({
    pendingInvites: source.pendingInvites
  }).pendingInvites;

  return {
    session: {
      authenticated: sessionSource.authenticated === true,
      ...(Number.isInteger(Number(sessionSource.userId)) && Number(sessionSource.userId) > 0
        ? { userId: Number(sessionSource.userId) }
        : {}),
      ...(oauthProviders.length > 0 ? { oauthProviders } : {}),
      ...(Object.hasOwn(sessionSource, "oauthDefaultProvider")
        ? {
            oauthDefaultProvider: normalizeLowerText(sessionSource.oauthDefaultProvider) || null
          }
        : {})
    },
    profile: source.profile && typeof source.profile === "object" ? source.profile : null,
    app: normalizeObjectInput(source.app),
    workspaces: Array.isArray(source.workspaces) ? source.workspaces : [],
    pendingInvites,
    activeWorkspace: source.activeWorkspace && typeof source.activeWorkspace === "object" ? source.activeWorkspace : null,
    membership: source.membership && typeof source.membership === "object" ? source.membership : null,
    permissions: Array.isArray(source.permissions)
      ? source.permissions.map((entry) => normalizeText(entry)).filter(Boolean)
      : [],
    workspaceSettings:
      source.workspaceSettings && typeof source.workspaceSettings === "object"
        ? source.workspaceSettings
        : null,
    userSettings: source.userSettings && typeof source.userSettings === "object" ? source.userSettings : null,
    ...(source.requestMeta && typeof source.requestMeta === "object"
      ? { requestMeta: source.requestMeta }
      : {})
  };
}

const workspaceBootstrapMessages = createOperationMessages();

const workspaceBootstrapResource = Object.freeze({
  resource: "workspaceBootstrap",
  messages: workspaceBootstrapMessages,
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: workspaceBootstrapMessages,
      query: Object.freeze({
        schema: Type.Object(
          {
            workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
          },
          { additionalProperties: false }
        ),
        normalize(payload = {}) {
          const source = normalizeObjectInput(payload);
          if (!Object.hasOwn(source, "workspaceSlug")) {
            return {};
          }

          return {
            workspaceSlug: normalizeLowerText(source.workspaceSlug)
          };
        }
      }),
      input: Object.freeze({
        schema: Type.Object(
          {
            workspaceSlug: Type.Optional(Type.String({ minLength: 1 })),
            user: Type.Optional(Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]))
          },
          { additionalProperties: false }
        ),
        normalize: normalizeBootstrapInput
      }),
      output: Object.freeze({
        schema: bootstrapOutputSchema,
        normalize: normalizeBootstrapOutput
      })
    })
  })
});

export { workspaceBootstrapResource };
