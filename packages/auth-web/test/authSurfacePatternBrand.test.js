import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The auth-surface pattern shows the app's identity on its sign-in, reset and sign-out screens: each page renders the
// app's view wrapper, and the wrapper fills the default view's brand slot with AppBrand.vue, the app's name.
const EXAMPLE = new URL("../patterns/auth-surface/example/src/", import.meta.url);
const SCREENS = Object.freeze([
  { page: "login", view: "LoginView" },
  { page: "reset-password", view: "ResetPasswordView" },
  { page: "signout", view: "SignOutView" }
]);
const read = (relative) => readFile(new URL(relative, EXAMPLE), "utf8");

test("the auth-surface pages render the app's view wrappers, which fill the brand slot with AppBrand", async () => {
  for (const { page, view } of SCREENS) {
    const pageSource = await read(`pages/auth/${page}.vue`);
    assert.match(pageSource, new RegExp(`import ${view} from "@/views/auth/${view}\\.vue";`, "u"), `${page}.vue imports the app's wrapper`);
    assert.match(pageSource, new RegExp(`<${view} />`, "u"), `${page}.vue renders the app's wrapper`);
    assert.doesNotMatch(pageSource, /Default\w+View/u, `${page}.vue does not render the default view itself`);

    const viewSource = await read(`views/auth/${view}.vue`);
    assert.match(viewSource, new RegExp(`import Default${view} from "@jskit-ai/auth-web/client/views/Default${view}";`, "u"));
    assert.match(viewSource, /import AppBrand from "@\/components\/AppBrand\.vue";/u);
    assert.match(viewSource, /<template #brand="\{ compact \}">\s*<AppBrand :compact="compact" \/>\s*<\/template>/u, `${view}.vue fills the brand slot`);
  }
});

test("AppBrand shows the app's name and no heading", async () => {
  const source = await read("components/AppBrand.vue");
  assert.match(source, /const APP_NAME = "Reading Room";/u);
  assert.match(source, /compact \? 'text-title-medium' : 'text-title-large'/u);
  assert.doesNotMatch(source, /<h[1-6]\b/u);
});
