# Changelog

## Unreleased

- The workspace tenancy guide's Role permissions section says the startup grant check cannot see a permission the application checks in its own code, so before removing or renaming a reported grant an agent searches the code for it (`hasPermission()`, `can()`, permission string checks, including names built in code such as `` `crud.${resource}.list` ``), lists one the application checks in `roleCatalog.customPermissions`, and removes the grant only when nothing uses it. The generated guide, skill reference and workspace-server pattern copies follow.
