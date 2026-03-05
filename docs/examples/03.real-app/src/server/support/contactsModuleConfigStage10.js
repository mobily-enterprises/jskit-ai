import { Type } from "typebox";
import { defineModuleConfig } from "@jskit-ai/kernel/server/runtime";

const DEFAULT_ALLOWED_COUNTRIES = Object.freeze(["US", "CA", "GB", "DE", "FR", "ES", "IT"]);

const contactsModuleConfigSchema = Type.Object(
  {
    mode: Type.Union([Type.Literal("standard"), Type.Literal("strict")]),
    allowedCountries: Type.Array(Type.String({ minLength: 2, maxLength: 2 }), {
      minItems: 1
    }),
    maxStarterEmployees: Type.Integer({ minimum: 1 }),
    blockDisposableEmailDomains: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const contactsModuleConfig = defineModuleConfig({
  moduleId: "docs.examples.03.contacts",
  schema: contactsModuleConfigSchema,
  coerce: true,
  load({ env }) {
    return {
      mode: env.CONTACTS_MODE,
      allowedCountries: env.CONTACTS_ALLOWED_COUNTRIES,
      maxStarterEmployees: env.CONTACTS_MAX_STARTER_EMPLOYEES,
      blockDisposableEmailDomains: env.CONTACTS_BLOCK_DISPOSABLE_EMAILS
    };
  },
  transform(raw) {
    const allowedCountriesRaw = String(
      raw?.allowedCountries || DEFAULT_ALLOWED_COUNTRIES.join(",")
    );

    return {
      mode: raw?.mode || "standard",
      allowedCountries: allowedCountriesRaw
        .split(",")
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean),
      maxStarterEmployees: raw?.maxStarterEmployees ?? 2000,
      blockDisposableEmailDomains: raw?.blockDisposableEmailDomains ?? true
    };
  },
  validate(config) {
    if (config.mode === "strict" && config.maxStarterEmployees > 1000) {
      return [
        {
          path: "maxStarterEmployees",
          message: "must be <= 1000 when mode is strict"
        }
      ];
    }

    return true;
  }
});

export {
  DEFAULT_ALLOWED_COUNTRIES,
  contactsModuleConfigSchema,
  contactsModuleConfig
};
