import { Type } from "typebox";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  normalizeObjectInput,
  createCursorListValidator,
  normalizeSettingsFieldInput,
  recordIdSchema
} from "@jskit-ai/kernel/shared/validators";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { workspaceSettingsFields } from "./workspaceSettingsFields.js";
import { createWorkspaceRoleCatalog } from "../roles.js";

function buildCreateBodySchema() {
  const properties = {};
  for (const field of workspaceSettingsFields) {
    properties[field.key] = field.required === false ? Type.Optional(field.inputSchema) : field.inputSchema;
  }

  return Type.Object(properties, {
    additionalProperties: false,
    messages: {
      additionalProperties: "Unexpected field.",
      default: "Invalid value."
    }
  });
}

function buildSettingsOutputSchema() {
  const properties = {};
  for (const field of workspaceSettingsFields) {
    properties[field.key] = field.outputSchema;
  }
  properties.invitesAvailable = Type.Boolean();
  properties.invitesEffective = Type.Boolean();

  return Type.Object(properties, { additionalProperties: false });
}

function buildResponseRecordSchema() {
  return Type.Object(
    {
      workspace: Type.Object(
        {
          id: recordIdSchema,
          slug: Type.String({ minLength: 1 }),
          ownerUserId: recordIdSchema
        },
        { additionalProperties: false }
      ),
      settings: buildSettingsOutputSchema(),
      roleCatalog: Type.Object(
        {
          collaborationEnabled: Type.Boolean(),
          defaultInviteRole: Type.String(),
          roles: Type.Array(Type.Object({}, { additionalProperties: true })),
          assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
        },
        { additionalProperties: true }
      )
    },
    { additionalProperties: false }
  );
}

function normalizeInput(payload = {}) {
  return normalizeSettingsFieldInput(payload, workspaceSettingsFields);
}

function normalizeOutput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const workspace = normalizeObjectInput(source.workspace);
  const settings = normalizeObjectInput(source.settings);
  const normalizedSettings = {};

  for (const field of workspaceSettingsFields) {
    const rawValue = Object.hasOwn(settings, field.key)
      ? settings[field.key]
      : field.resolveDefault({
          workspace,
          settings
        });
    normalizedSettings[field.key] = field.normalizeOutput(rawValue, {
      workspace,
      settings
    });
  }

  const invitesEnabled = normalizedSettings.invitesEnabled !== false;
  const invitesAvailable = settings.invitesAvailable !== false;
  const invitesEffective =
    typeof settings.invitesEffective === "boolean" ? settings.invitesEffective : invitesEnabled;
  normalizedSettings.invitesEnabled = invitesEnabled;
  normalizedSettings.invitesAvailable = invitesAvailable;
  normalizedSettings.invitesEffective = invitesEffective;
  const roleCatalog = normalizeObjectInput(source.roleCatalog);
  const hasRoleCatalog =
    Array.isArray(roleCatalog.roles) &&
    roleCatalog.roles.length > 0 &&
    Array.isArray(roleCatalog.assignableRoleIds);

  return {
    workspace: {
      id: normalizeRecordId(workspace.id, { fallback: "" }),
      slug: normalizeText(workspace.slug),
      ownerUserId: normalizeRecordId(workspace.ownerUserId, { fallback: "" })
    },
    settings: normalizedSettings,
    roleCatalog: hasRoleCatalog ? roleCatalog : createWorkspaceRoleCatalog()
  };
}

const responseRecordValidator = Object.freeze({
  get schema() {
    return buildResponseRecordSchema();
  },
  normalize: normalizeOutput
});

const resource = {
  resource: "workspaceSettings",
  messages: {
    validation: "Fix invalid workspace settings values and try again.",
    saveSuccess: "Workspace settings updated.",
    saveError: "Unable to update workspace settings.",
    apiValidation: "Validation failed."
  },
  operations: {
    view: {
      method: "GET",
      outputValidator: responseRecordValidator
    },
    list: {
      method: "GET",
      outputValidator: createCursorListValidator(responseRecordValidator)
    },
    create: {
      method: "POST",
      bodyValidator: {
        get schema() {
          return buildCreateBodySchema();
        },
        normalize: normalizeInput
      },
      outputValidator: responseRecordValidator
    },
    replace: {
      method: "PUT",
      bodyValidator: {
        get schema() {
          return buildCreateBodySchema();
        },
        normalize: normalizeInput
      },
      outputValidator: responseRecordValidator
    },
    patch: {
      method: "PATCH",
      bodyValidator: {
        get schema() {
          return Type.Partial(buildCreateBodySchema(), { additionalProperties: false });
        },
        normalize: normalizeInput
      },
      outputValidator: responseRecordValidator
    }
  }
};

export { resource as workspaceSettingsResource };
