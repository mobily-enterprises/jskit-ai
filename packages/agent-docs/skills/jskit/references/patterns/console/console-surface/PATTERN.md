---
id: console/console-surface
title: Owner console surface
summary: Add a protected administration surface, settings shell, and semantic navigation through JSKIT console and shell APIs.
keywords: admin, console, navigation, owner, placement, settings, surface
requires: @jskit-ai/console-core, @jskit-ai/console-web, @jskit-ai/shell-web
---

# Owner console surface

## Use when

Use this pattern for a separate owner-only or operator-only application surface.

## Do not use when

Do not create a separate console merely for one settings page or when normal
workspace roles already express the required access boundary.

## Product decisions

Choose who can enter the console, its route and label, which settings sections
it owns, and how authorized users switch to and from it.

## Framework APIs

Use `@jskit-ai/console-core` for console capabilities,
`@jskit-ai/console-web` for the web provider, and JSKIT shell surface,
placement, and topology APIs for application composition.

## Invariants

- Server policy enforces console access before application actions run.
- The surface definition and route pages use the same surface id.
- The profile switch is visible only to authorized authenticated users.
- Settings navigation uses semantic placements and responsive topology.
- Loading screens use skeletons and do not shift the surrounding shell.

## Example files

`example/` contains concrete console root, landing, and settings routes. Adapt
them together with the surface policy and placement examples described here.

## Variation points

Change the surface id, access policy, settings hierarchy, routes, labels, icons,
and switch placement to fit the product's administration model.

## Verification

Test forbidden and authorized entry, switching between surfaces, direct route
loads, compact navigation, settings navigation, and production build output.

## Avoid

- treating a hidden navigation item as authorization
- sharing normal-user pages merely by changing their route prefix
- generator ownership or appended source fragments
