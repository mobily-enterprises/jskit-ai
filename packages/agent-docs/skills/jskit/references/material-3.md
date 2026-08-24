# Material 3

Read completely before any JSKIT Vue/Vuetify UI task.

## Authority

JSKIT uses Vue and the installed Vuetify 4 release. Material 3 is the UI
contract; packages, shared screens, placements, shell components, and
app-owned Vuetify configuration are its implementation seams.
Use the installed public APIs rather than adding `@material/web`, another UI
framework, or a parallel theme/component system.

The request and Blueprint own brand, content, routes, and behavior. Material 3
does not authorize a redesign.
An established JSKIT prop or component wins over generic Material advice.

## Implement through owned seams

Use this order:

1. Reuse the JSKIT package, source pattern, shared screen, shell, placement, or
   high-level composable that owns the behavior.
2. Use the matching Vuetify component and its public props, variants, slots,
   density, responsive, theme, and accessibility behavior.
3. Adapt app-owned wrappers or the central `createVuetify(...)` configuration.
4. Add scoped CSS only for product layout or a documented gap. Never style
   Vuetify internals or duplicate a component system in CSS.

Do not replace a shared screen to restyle it. Use its public seams.

## Theme and visual hierarchy

- Define palettes and theme selection once through the established Vuetify
  bootstrap. Preserve promised light, dark, or system behavior.
- Prefer semantic roles such as primary, secondary, surface, surface variant,
  on-surface, outline, success, warning, and error. Use Vuetify theme props,
  classes, and `--v-theme-*` variables instead of repeated visual literals.
- Keep contrast and meaning in every supported theme. Never communicate
  status, selection, validation, or permission through color alone.
- Use Vuetify 4 Material 3 display, headline, title, body, and label roles. Do
  not recreate the old Material 2 type scale or a page-local typography system.
- Use Vuetify spacing utilities and established JSKIT dimensions before raw
  values. Preserve JSKIT shell widths, target sizes, and spacing props.
- Use elevation `0` through `5`, shape props, and component variants instead of
  arbitrary shadows and radii. Prefer a page header and direct `v-sheet` work
  region; add cards or dialogs only for genuinely grouped or elevated objects.

## Components, state, and feedback

- Choose components by purpose. Prefer standard buttons, fields, lists,
  tables, sheets, dialogs, menus, navigation, progress, alerts, snackbars, and
  tooltips over custom imitations.
- Give one primary action emphasis. Distinguish destructive, secondary, and
  icon-only actions without relying on color; give icon controls accessible
  names and fields meaningful labels, errors, and autocomplete behavior.
- Preserve visible focus, logical tab order, keyboard operation, and at least
  48 CSS-pixel interactive targets unless a tested dense operator surface owns
  another contract.
- Represent loading, empty, error, retry, disabled, selected, hover, focus,
  pressed, and success states through shared JSKIT behavior. All user-visible
  loading uses Material skeletons that reserve the final content geometry;
  never use a generic spinner or circular progress indicator, and never let
  content jump when data arrives. An action without a loading content region
  uses a stable disabled/pending label and shared feedback, not a spinner.
- Keep failures at their semantic owner. A resource that cannot render uses a
  stable in-page error and retry state; field validation stays beside the
  field. A user-triggered command uses JSKIT's shared action
  feedback/snackbar path. Never insert a transient command-error alert above
  page content where it shifts the working layout.
- Use established transitions and honor reduced motion. Do not claim
  unsupported Material 3 Expressive parity.

## Adaptive layout

Start compact, then verify medium and expanded layouts. Use Vuetify display
APIs and the JSKIT adaptive shell rather than copying breakpoint numbers.
Keep primary tasks reachable without incidental chrome. Let navigation,
tables, filters, supporting content, and action groups change presentation;
do not merely shrink an expanded screen. Prevent overflow, clipped labels,
overlapping actions, duplicate navigation, and unreachable dialogs. Persist
screen context in the route when it must survive navigation.

## Material 3 audit

Run this behavior-preserving audit over every affected screen:

1. Identify the owning JSKIT surface, shared screen, shell, placement, theme,
   and Vuetify components before judging local markup.
2. Find parallel components, duplicated state chrome, page-local themes,
   transient command errors that shift page content, content loaders using
   generic spinners instead of geometry-preserving skeletons, raw visual
   constants, CSS against Vuetify internals, nested generic cards, legacy
   typography, elevation outside `0`-`5`, and desktop-only layout.
3. Check hierarchy, token use, component purpose, responsive presentation,
   interaction states, keyboard/focus behavior, labels, targets, contrast, and
   reduced motion.
4. Correct issues at the narrowest established owner. Consolidate only truly
   repeated policy; avoid pass-through wrappers and speculative abstractions.
5. Run focused tests and Playwright at compact, medium, and expanded widths.
   Navigate away and back with warm query data when the screen persists state.

Do not declare Material 3 compliance from visual resemblance alone. Report any
unverified responsive, theme, accessibility, interaction, or browser behavior.
For a missing or version-sensitive API, verify the installed Vuetify major and
official docs; implement Material intent through supported JSKIT/Vuetify seams.
