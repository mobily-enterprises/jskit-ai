# `@jskit-ai/config-eslint`

Shared flat ESLint config presets for monorepo apps and packages.

This package gives multiple apps the same linting baseline without copy-pasting ESLint setup in each app.

ESLint is a tool that checks code quality and consistency before code reaches production. This package is a reusable "lint rules starter kit" for all workspace apps.


## 1) What This Package Is For

Use this package when you want:

1. Shared lint behavior across many apps.
2. Fewer duplicated config files.
3. Easier upgrades (change shared config once, then update package version).
4. Predictable linting in CI across the monorepo.

Real-life example:

1. App A and App B both use Vue + Node.
2. Without this package, each app has its own local ESLint setup and rules drift over time.
3. With this package, both apps import the same presets and stay aligned.

---

## 2) What It Exports

This package exports four flat config presets:

1. `baseConfig`
2. `nodeConfig`
3. `webConfig`
4. `vueConfig`

Important:
These are config arrays, not runtime functions. You combine them in your app `eslint.config.mjs`.

---

## 3) How To Install And Use It

In an app `package.json`:

```json
{
  "devDependencies": {
    "@jskit-ai/config-eslint": "0.1.0"
  }
}
```

Then in `eslint.config.mjs`:

```js
import { baseConfig, nodeConfig, webConfig, vueConfig } from "@jskit-ai/config-eslint";

export default [
  ...baseConfig,
  ...webConfig,
  ...nodeConfig,
  ...vueConfig
];
```

Run lint:

```bash
npm run lint
```

---

## 4) Full Export Reference (What Each Export Does + Real Examples)

### `baseConfig`

What it does:

1. Enables ESLint core recommended rules (`@eslint/js` recommended set).
2. Sets modern JS parsing defaults:
   1. `ecmaVersion: "latest"`
   2. `sourceType: "module"`
3. Applies to `**/*.{js,mjs,cjs,vue}`.

When to use it:
Always. This is the foundation preset.

Practical real-life example:

1. Developer accidentally writes an undefined variable in a service file.
2. `baseConfig` catches that via ESLint recommended rules before merge.

Code example:

```js
import { baseConfig } from "@jskit-ai/config-eslint";

export default [...baseConfig];
```

### `nodeConfig`

What it does:

1. Adds Node globals (for example `process`, `Buffer`, `__dirname` behavior via environment globals).
2. Adds a `.cjs` override that sets:
   1. `sourceType: "commonjs"`
   2. Node globals for CommonJS files.

When to use it:
Use when your app/package has server code, scripts, workers, or `.cjs` files.

Practical real-life example:

1. Your app has a `knexfile.cjs` and backend files that use Node globals.
2. Without `nodeConfig`, lint may flag globals or module syntax incorrectly.
3. With `nodeConfig`, those files lint with the correct runtime assumptions.

Code example:

```js
import { baseConfig, nodeConfig } from "@jskit-ai/config-eslint";

export default [...baseConfig, ...nodeConfig];
```

### `webConfig`

What it does:

1. Adds browser globals (for example `window`, `document`, `navigator`).
2. Applies to `**/*.{js,mjs,cjs,vue}`.

When to use it:
Use when your app has browser/client code.

Practical real-life example:

1. A frontend component uses `window.location.pathname`.
2. Without `webConfig`, lint may treat `window` as undefined.
3. With `webConfig`, lint understands browser globals and checks the code correctly.

Code example:

```js
import { baseConfig, webConfig } from "@jskit-ai/config-eslint";

export default [...baseConfig, ...webConfig];
```

### `vueConfig`

What it does:

1. Adds `eslint-plugin-vue` flat recommended config.
2. Applies practical Vue rule relaxations used across apps:
   1. `vue/multi-word-component-names: off`
   2. `vue/max-attributes-per-line: off`
   3. `vue/singleline-html-element-content-newline: off`
   4. `vue/attributes-order: off`
   5. `vue/one-component-per-file: off`

When to use it:
Use when the app uses Vue single-file components.

Practical real-life example:

1. A test file declares small inline Vue components in the same file.
2. Without this preset override, lint can fail due to `one-component-per-file`.
3. With `vueConfig`, the shared team convention is respected.

Code example:

```js
import { baseConfig, webConfig, vueConfig } from "@jskit-ai/config-eslint";

export default [...baseConfig, ...webConfig, ...vueConfig];
```

---

## 5) How Real Apps Use This In Practice (And Why)

In this repo, the app config at:
`apps/jskit-value-app/eslint.config.mjs`
uses:

1. `...baseConfig`
2. `...webConfig`
3. `...nodeConfig`
4. `...vueConfig`

Why this exact composition:

1. The app is full-stack: browser + server + Vue + `.cjs`.
2. One app has both frontend and backend folders.
3. Shared presets reduce boilerplate while keeping app-specific rules local.

Real workflow example:

1. Developer edits a Vue view and a Fastify service in the same PR.
2. One lint run validates both browser and server assumptions with shared rules.
3. CI behavior stays consistent with other apps using the same presets.

---

## 6) How Config Composition Works

ESLint flat config is an ordered array. Order matters.

Practical rule:

1. Put shared presets first.
2. Put app-specific overrides after shared presets.

Example:

```js
import { baseConfig, nodeConfig, webConfig, vueConfig } from "@jskit-ai/config-eslint";

export default [
  ...baseConfig,
  ...webConfig,
  ...nodeConfig,
  ...vueConfig,
  {
    files: ["server/**/*.service.js"],
    rules: {
      "max-lines": [
        "error",
        {
          max: 750,
          skipBlankLines: true,
          skipComments: true
        }
      ]
    }
  }
];
```

Why:
App-specific rules should win only where the app explicitly needs them.

---

## 7) What Stays In App Config (Important Boundary)

Keep these in each app, not in this shared package:

1. App-specific ignore patterns.
2. App-specific architecture rules.
3. App-specific rule exceptions for local workflows.

Real-life example:

1. One app has generated files under `coverage-client/**` and another app does not.
2. That ignore belongs in the app, not the shared package.

This keeps `@jskit-ai/config-eslint` reusable and domain-neutral.

---

## 8) Common Questions

### "Do I need all four exports?"

No.
Choose what matches your app runtime:

1. Node-only package: `baseConfig + nodeConfig`
2. Browser-only app: `baseConfig + webConfig`
3. Vue SPA: `baseConfig + webConfig + vueConfig`
4. Full-stack Vue app: `baseConfig + webConfig + nodeConfig + vueConfig`

### "Can I override a rule in one app?"

Yes. Add an override block after the shared presets in that app config.

### "Why not put ignore patterns in this package?"

Because ignore patterns are usually app-specific and change per app structure.

---

## 9) Troubleshooting

### `window is not defined` in frontend files

Cause:
`webConfig` is missing.

Fix:
Add `...webConfig` to `eslint.config.mjs`.

### `process is not defined` in backend files

Cause:
`nodeConfig` is missing.

Fix:
Add `...nodeConfig`.

### `.cjs` files lint with module syntax issues

Cause:
No CommonJS override.

Fix:
Ensure `nodeConfig` is included (it adds the `.cjs` override).

### Vue template/style rules feel too strict for your app

Cause:
You need local policy differences.

Fix:
Add app-level rule overrides after shared presets.

---

## Summary

`@jskit-ai/config-eslint` gives shared, practical lint presets for monorepo apps.

1. Use shared presets for consistency.
2. Keep app-specific policy in each app config.
3. Compose only the presets each app actually needs.
