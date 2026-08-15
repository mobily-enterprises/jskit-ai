# A more interesting shell

Use `@jskit-ai/shell-web` when the product needs responsive navigation,
semantic placements, settings sections, and a consistent application error
host.

```bash
npm install @jskit-ai/shell-web
```

Installing the package supplies runtime APIs; it does not rewrite the app. Use
the `shell/application-shell` pattern for a complete shell or
`ui/page-and-placement` for a smaller addition to an existing shell.

## The shell contract

- File routes remain application source.
- Placements describe semantic destinations such as primary navigation,
  section navigation, profile controls, and status elements.
- Topology maps those placements to concrete outlets at compact, medium, and
  expanded widths.
- App-owned components are registered by stable component id through the
  client provider.
- Navigation links use the shell link components so current-route and surface
  behavior stays consistent.

This is composition, not code injection. There is one visible placement
registry and one route tree to inspect.

## Product decisions

Choose the surfaces, routes, navigation hierarchy, labels, icons, section
ownership, ordering, and compact behavior. Do not infer primary navigation from
every route: detail and workflow pages usually should not appear there.

## UI invariants

- Compact controls have accessible names and at least 48 CSS-pixel targets.
- Loading uses layout-stable skeletons, never indeterminate spinners.
- Mutation failures use the standard toast instead of banners that push the
  page down.
- Cached route or resource data hydrates writable state immediately.
- Browser back/forward restores the selected route and screen context.

## Adaptive drawer

Use Vuetify Material navigation. On compact/mobile layouts, close dismisses the
temporary drawer. Wide layouts normally use
`desktopDrawerClosedMode="rail"`; choose `hidden` only when another navigation
affordance remains. The public `drawerWidth`, `railWidth`, and
`navigationItemSpacing` controls own density and spacing. The standard 80px
rail centres 48px targets, and drawer items keep an outer inset of 12 CSS pixels.
Do not override private shell CSS to imitate these states.

## Verification

Exercise direct URLs, link navigation, current-link state, keyboard operation,
warm-cache return navigation, and compact/medium/expanded widths. Run the
client tests and production build.

Do not add a second navigation registry, generator markers, placement receipts,
or source-append machinery.
