# Changelog

## Unreleased

- The application foundations' `bin/develop.js` starts Vite directly under node instead of through `npm run dev`, so stopping the launcher (SIGTERM, as a Preview stop sends) stops Vite too: npm exited on SIGTERM without stopping the script it started, which left Vite serving the port.
- The workspace tenancy guide's Role permissions section says the startup grant check cannot see a permission the application checks in its own code, so before removing or renaming a reported grant an agent searches the code for it (`hasPermission()`, `can()`, permission string checks, including names built in code such as `` `crud.${resource}.list` ``), lists one the application checks in `roleCatalog.customPermissions`, and removes the grant only when nothing uses it. The generated guide, skill reference and workspace-server pattern copies follow.
