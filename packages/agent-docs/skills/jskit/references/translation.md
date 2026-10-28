<!-- Generated from `packages/agent-docs/site/guide/framework/translation.md` by `npm run agent-docs:build`. -->

# Translating a JSKIT app

JSKIT ships every screen, message and error in English and can show all of them
in another language. An app supplies translation files only: it never copies or
overrides JSKIT components to translate them. An app that supplies no
translations looks and behaves exactly as an English-only app.

## How it fits together

- Every JSKIT package with user-visible text ships `locales/en.json`, a nested
  catalog under its own namespace: `jskit.auth.*`, `jskit.users.*`,
  `jskit.shell.*`, `jskit.http.*`, and so on.
- JSKIT components translate through the app's
  [vue-i18n](https://vue-i18n.intlify.dev/) instance when the app supplies one,
  and through the bundled English otherwise. `vue-i18n` is an optional peer
  dependency; install it only when the app is translated.
- The server never decides the language of an error. Every error response
  carries a stable `code`, its `params` and the English `message`; the client
  renders the code in the user's language.
- Choosing and switching the language is the app's job. JSKIT components follow
  vue-i18n's active locale.

## Pass the app's vue-i18n instance

Create the instance in composition mode and give it to the client bootstrap:

```js
import { createI18n } from "vue-i18n";
import { bootstrapClientShellApp } from "@jskit-ai/kernel/client";
import it from "./locales/it/jskit.json" with { type: "json" };

const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: { it }
});

await bootstrapClientShellApp({ /* existing options */, i18n });
```

The bootstrap installs the instance (unless `appPlugins` already does) and
merges every installed package's English into its `en` messages. The app's own
`en` messages win, so an app can reword a JSKIT text by defining the same key.
JSKIT refuses a legacy-mode instance (`createI18n({ legacy: true })`).

## Add a language

1. Write the merged English of the app's installed JSKIT packages to a file for
   translators:

   ```bash
   npx jskit i18n export it
   ```

   This creates `src/locales/it/jskit.json`. Running it again after upgrading
   JSKIT adds new keys in English and keeps every existing translation.
2. Translate the values. Keep every `{placeholder}` exactly; plural messages
   keep the same number of `|`-separated choices as the English.
3. Check the file against the installed packages:

   ```bash
   npx jskit i18n check it
   ```

   It reports missing and extra keys, invalid messages, placeholder and plural
   mismatches, and (as warnings) values still identical to the English. It exits
   non-zero when keys are missing, a message is invalid or placeholders differ,
   so it can run in CI.
4. Load the file into the vue-i18n instance under its locale code, as above.

Missing keys fall back to English, so a partly translated language still works.

### Message syntax

JSKIT catalogs use a subset of vue-i18n's syntax, and translations must too:

- named placeholders: `Use at least {min} characters.`
- literal text in quotes for the characters `{ } @ $ |`: `support{'@'}example.com`
- plural choices separated by `|`, chosen by `count`:
  `{count} file | {count} files` (one | other) or
  `no files | one file | {count} files` (zero | one | other)

Linked messages (`@:key`), list placeholders (`{0}`) and HTML are not used.

## Use the user's saved language

Account preferences store the user's language in `user_settings.locale` as a
BCP 47 code (for example `it-IT`). The "Language / locale" select offers the
app's configured languages:

```js
// config/public.js
config.languages = [
  { code: "en-US", name: "English (US)" },
  { code: "it-IT", name: "Italiano" }
];
```

Each `name` may also be a message key. Without `config.languages` the select
keeps JSKIT's built-in list. A saved locale that is not in the list stays
selectable under its language name.

JSKIT never switches the app's language itself. `useAccountLocale()` from
`@jskit-ai/users-web/client` is a read-only ref holding the signed-in user's
saved locale (`""` when nobody is signed in); it updates after sign-in and after
the preferences are saved. Follow it in the app:

```js
import { watch } from "vue";
import { useAccountLocale } from "@jskit-ai/users-web/client";

watch(useAccountLocale(), (locale) => {
  if (locale) i18n.global.locale.value = pickSupportedLocale(locale);
}, { immediate: true });
```

`pickSupportedLocale` is the app's own choice, for example `it-IT` → `it` when
the app ships only `src/locales/it/jskit.json`.

## How errors are shown

Every error response from a JSKIT HTTP API has a `code` and `params` next to
the English `message`:

```json
{ "error": "Invalid email or password.", "code": "auth.login.invalidCredentials", "params": {} }
```

- Codes added for translation are dotted (`<namespace>.<area>.<name>`) and
  render from the key `jskit.<code>`.
- Older codes such as `ACTION_PERMISSION_DENIED` or `not_found` keep their
  values and render from `jskit.errors.<code>`.
- Validation errors keep `details.fieldErrors` (English) and add
  `details.fieldErrorCodes: { field: { code, params } }`.
- Where one code covers several different sentences (for example
  `connector_input_invalid`), the response also has `messageCode` and
  `messageParams` for the exact sentence.

The client translates a code only when the English the server sent is JSKIT's
English for that code. An app's own sentence under a shared code (for example
`throw new NotFoundError("Contact not found.")`) is shown exactly as written, and
so is any text whose code has no catalog entry.

App code that shows errors uses the same helper JSKIT's components use:

```js
import { useJskitText } from "@jskit-ai/kernel/client";

const { serverMessage, fieldErrorMessages } = useJskitText();
const message = serverMessage(error);          // translated, or the English sent
const fieldMessages = fieldErrorMessages(error); // { field: text }
```

To give the app's own errors codes, throw them with a code and params and add
the app's English and translations to its vue-i18n messages under the key the
code maps to:

```js
throw new AppError(409, "That slug is taken.", { code: "app.project.slugTaken" });
// en: { jskit: { app: { project: { slugTaken: "That slug is taken." } } } }
```

## Placement labels

A placement `label` or `title` may be a message key, `{ key, fallback, params }`
or plain text. JSKIT's menus, tabs, profile menu and account-settings sections
translate a key and show any other string as written:

```js
{ label: "jskit.users.accountSettings.menuLabel" }
{ label: { key: "app.menu.reports", fallback: "Reports" } }
{ label: "Reports" }
```

## Dates and numbers

JSKIT formats dates, times, numbers and relative times with `Intl` in the
active vue-i18n locale (the browser's default when no instance is supplied).
App code can use the same helpers from `useJskitText()`: `formatDate`,
`formatTime`, `formatDateTime`, `formatNumber` and `formatRelativeTime`.

## Emails

The workspace invitation email is rendered in the recipient's saved
`user_settings.locale` when the recipient already has an account, and in English
otherwise. The server reads the same `src/locales/<code>/jskit.json` files the
client uses, so translating `jskit.workspaces.inviteEmail.*` there translates
the email too. It looks for the exact locale (`it-IT`), then the language
(`it`), then English. The app's invite mailer also receives the chosen `locale`.

Server code that renders JSKIT-style messages itself uses the same lookup:

```js
import { createServerI18n } from "@jskit-ai/kernel/server/i18n";

const i18n = createServerI18n({ appRoot, catalogs: [english] });
i18n.t("it-IT", "jskit.workspaces.inviteEmail.subject", { workspace: "Acme" });
```

Password-reset emails are sent by the app's own recovery sender (local
accounts) or by the identity provider (Supabase, OIDC), so their language is
the app's or the provider's choice.

## What the app translates itself

JSKIT's catalogs cover JSKIT's own code. These texts belong to the app:

- Vuetify's built-in texts (close buttons, pagination, "No data available").
  Translate them through Vuetify's locale options, or let Vuetify share the
  vue-i18n instance with its `createVueI18nAdapter`.
- Files the app copied from a JSKIT starter or pattern, such as its
  account-settings sections, placement entries and pages. Once copied they are
  app code: give their texts the app's own keys.
- The startup HTML in `index.html` (for example "Loading application…"), shown
  before any JavaScript runs.

## Checks inside JSKIT

Each JSKIT package with a catalog has a test that compiles every message with
vue-i18n, requires every key and dotted code its source uses to exist, rejects
unused keys and refuses a key another package already defines. ESLint's
`@intlify/vue-i18n/no-raw-text` rule rejects untranslated template text in JSKIT
client code.
