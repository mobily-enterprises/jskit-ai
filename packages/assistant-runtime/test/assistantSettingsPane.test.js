import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// A settings pane: the app bar carries the assistant settings' title and their Save, which submits the card's form.
test("the assistant settings put their title and Save in the app bar", async () => {
  const source = await readFile(new URL("../src/client/components/AssistantSettingsClientElement.vue", import.meta.url), "utf8");
  assert.match(source, /useShellPageTitle\(\(\) => t\("jskit\.assistant\.runtime\.settings\.title"\)\)/u);
  assert.match(source, /<ShellPageActions v-if="showsBarSave">\s*<ShellPageAction\s+primary\s+type="submit"\s+:form="SETTINGS_FORM_ID"/u);
  assert.match(source, /:form-id="SETTINGS_FORM_ID"/u);
  assert.match(source, /const SETTINGS_FORM_ID = "assistant-settings-form";/u);
});
