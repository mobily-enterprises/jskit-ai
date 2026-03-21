// @jskit-contract users.settings-fields.console.v1
// Append-only settings field registrations for console settings.

import {
  defineField,
  resetConsoleSettingsFields
} from "@jskit-ai/users-core/shared/resources/consoleSettingsFields";

resetConsoleSettingsFields();

void defineField;
