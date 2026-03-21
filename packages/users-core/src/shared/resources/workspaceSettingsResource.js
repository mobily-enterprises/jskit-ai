import { Type } from "typebox";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  normalizeObjectInput,
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import { workspaceSettingsFields } from "./workspaceSettingsFields.js";
import {
  createWorkspaceRoleCatalogOutputSchema,
  hasWorkspaceRoleCatalog
} from "./workspaceRoleCatalogSchema.js";
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
  const roleCatalogSchema = createWorkspaceRoleCatalogOutputSchema(Type);
  return Type.Object(
    {
      workspace: Type.Object(
        {
          id: Type.Integer({ minimum: 1 }),
          slug: Type.String({ minLength: 1 }),
          ownerUserId: Type.Integer({ minimum: 1 })
        },
        { additionalProperties: false }
      ),
      settings: buildSettingsOutputSchema(),
      roleCatalog: roleCatalogSchema
    },
    { additionalProperties: false }
  );
}

function normalizeInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  for (const field of workspaceSettingsFields) {
    if (!Object.hasOwn(source, field.key)) {
      continue;
    }
    normalized[field.key] = field.normalizeInput(source[field.key], {
      payload: source
    });
  }

  return normalized;
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

  return {
    workspace: {
      id: Number(workspace.id),
      slug: normalizeText(workspace.slug),
      ownerUserId: Number(workspace.ownerUserId)
    },
    settings: normalizedSettings,
    roleCatalog: hasWorkspaceRoleCatalog(roleCatalog) ? roleCatalog : createWorkspaceRoleCatalog()
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
