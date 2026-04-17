// @jskit-contract console.settings-fields.v1
// Append-only settings field registrations for console settings.

import {
  defineField,
  resetConsoleSettingsFields
} from "@jskit-ai/console-core/shared/resources/consoleSettingsFields";

resetConsoleSettingsFields();

void defineField;
