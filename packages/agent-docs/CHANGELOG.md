# Changelog

## Unreleased

- The UI guide's Browser verification section and the UI testing heuristic find a form field by its exact label (`page.getByLabel("Email", { exact: true })`), since an inexact lookup matches any element whose label contains the text and fails strict mode. The side effects guide says the "Test copy" banner is a note with no label, so `getByLabel("Email")` never finds it.
- New guide chapter, [Side effects and test copies](/guide/framework/side-effects) (skill reference `side-effects.md`): the `SIDE_EFFECTS` contract (`live` acts for real, anything else simulates), what JSKIT simulates, the "Test copy" banner, and a short example for an application's own side effects. The foundations' `AGENTS.md` points to it.
- The application foundations' `bin/develop.js` starts Vite directly under node instead of through `npm run dev`, so stopping the launcher (SIGTERM, as a Preview stop sends) stops Vite too: npm exited on SIGTERM without stopping the script it started, which left Vite serving the port.
- The workspace tenancy guide's Role permissions section says the startup grant check cannot see a permission the application checks in its own code, so before removing or renaming a reported grant an agent searches the code for it (`hasPermission()`, `can()`, permission string checks, including names built in code such as `` `crud.${resource}.list` ``), lists one the application checks in `roleCatalog.customPermissions`, and removes the grant only when nothing uses it. The generated guide, skill reference and workspace-server pattern copies follow.
