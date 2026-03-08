• Handoff Summary (Placement Mechanism Sweep)

  1. Sweep Scope

  - I fully loaded and used AI_KNOWLEDGE.md:1 before analysis.
  - I traced how package install mutations create/modify app composition files, centered on placement contributions.
  - I validated behavior against a fully-installed generated app at manual-apps/17:1.
  - I inspected descriptor definitions, CLI mutation logic, runtime loading/rendering logic, and lockfile state.
  - I ran real CLI introspection in app 17 (npx jskit show ...) and a direct runtime-free Node check of src/placement.js default
    output.
  - I did not continue the LEGACY deep dive because that request was interrupted/cancelled; this summary is about current repo +
    app 17 only.

  2. Naming Clarification (Important)

  - The active file is src/placement.js (singular), not placements.js: app file:1.
  - Runtime import is hardcoded to /src/placement.js: ShellWebClientProvider:10.

  3. Big Picture Mechanism

  - Composition is descriptor-driven at install-time and app-owned at runtime.
  - Packages contribute to app UI placement in two parallel ways:
  - Declarative metadata for discovery/docs/CLI display (metadata.ui.placements): shell-web:45, auth-web:189, users-web:55.
  - Concrete app mutations (mutations.files / mutations.text) that actually change app source files and therefore runtime
    behavior: shell-web file mutation:94, auth-web append-text:286, users-web append-text:143.

  4. create-app Baseline vs Installed App

  - Base template seeds only @local/main in lock: base-shell lock:1.
  - Base template does not include src/placement.js by default; shell-web install introduces it via file copy mutation.
  - In app 17, shell-web’s lock record confirms scaffolded src/placement.js ownership: lock shell-web managed file:369.

  5. Which Packages Actually Touch src/placement.js

  - @jskit-ai/shell-web:
  - Installs scaffold file src/placement.js from template: descriptor:94.
  - @jskit-ai/auth-web:
  - Appends one block containing 4 addPlacement(...) calls: descriptor text mutation:286.
  - @jskit-ai/users-web:
  - Appends one block containing 5 addPlacement(...) calls: descriptor text mutation:143.
  - No other current package descriptors target src/placement.js in this repo sweep.

  6. Descriptor-Level Placement Model

  - shell-web declares outlet slots it hosts (app shell slots): descriptor outlets:47.
  - auth-web declares:
  - One outlet it hosts itself (avatar.primary-menu): descriptor:190.
  - Four default contributions mapped to mutations.text#auth-web-placement-block: descriptor:197.
  - users-web declares five contributions mapped to mutations.text#users-web-placement-block: descriptor:57.
  - Metadata when values are string expressions in descriptor metadata, while runtime gating logic in src/placement.js is actual
    JS functions appended via text mutation.

  7. CLI Install Pipeline Details (What Actually Writes the File)

  - Add command resolves dependency order and enforces capability closure before installation: commandAdd:4460, capability
    validation call:4470.
  - Local dependency ordering is DFS over dependsOn; dependencies are visited before dependents: resolveLocalDependencyOrder:1744.
  - Packages already installed at same version are skipped (existingVersion === descriptor.version): skip logic:4482.
  - Package install applies:
  - package.json dependency/script mutations,
  - file mutations,
  - text mutations,
  - then writes lock entries describing what was managed: applyPackageInstall:3310.

  8. Text Mutation Internals

  - append-text behavior is implemented in applyTextMutations:3224.
  - skipIfContains is checked against current file content before append: logic:3275.
  - Snippet append mechanics are in appendTextSnippet:827:
  - normalizes line endings,
  - ignores empty snippet,
  - skips if exact normalized snippet already present,
  - supports top or bottom insertion,
  - normalizes trailing newline behavior.
  - Every applied text mutation is recorded in lock under managed.text: lock auth text record:449, lock users text record:586.

  9. Runtime Load Path (Client)

  - Shell provider boot path:
  - dynamically imports /src/placement.js,
  - accepts default export as either function (invoked) or array,
  - falls back to empty list on missing module or malformed export,
  - calls runtime.replacePlacements(...): provider load+boot:31, replace call:88.
  - Provider intentionally keeps literal import string so Vite can statically analyze it: comment:9.

  10. Placement Registry + Contract Behavior

  - App scaffolded src/placement.js uses registry helper and exports addPlacement + default getPlacements(): template:1.
  - Registry behavior:
  - addPlacement validates via strict contract,
  - duplicate IDs return false (silently ignored by registry),
  - build() returns frozen snapshot: registry:5.
  - Contract normalization enforces:
  - required id, slot, componentToken in strict mode,
  - slot normalized to <target>.<region> lower-case,
  - surface normalized (* default),
  - integer order,
  - optional props and functional when: contracts:49.

  11. Placement Runtime Evaluation

  - Runtime normalizes full placement list, skips invalid/disabled items, throws on duplicate IDs in the normalized list, sorts by
    order then id: normalizePlacementList:44.
  - replacePlacements resets token error caches and swaps definitions atomically: replacePlacements:233.
  - getPlacements behavior:
  - validates/normalizes requested slot and surface,
  - merges context from shared runtime context + per-call context + contributors tag,
  - filters by slot and surface,
  - evaluates when(context) with guarded error handling,
  - resolves componentToken via container,
  - skips missing/invalid/failing token bindings with warning/error suppression caches,
  - returns frozen list of matched entries in pre-sorted definition order: getPlacements:289.

  12. Where Slots Are Actually Rendered

  - Shell layout renders these outlets:
  - app.top-left,
  - app.top-right,
  - app.primary-menu,
  - app.secondary-menu: ShellLayout:62, ShellLayout:81, ShellLayout:99, ShellLayout:101.
  - auth-web widget renders nested avatar.primary-menu inside profile menu: AuthProfileWidget:105.

  13. Placement Context Wiring

  - auth-web updates shared placement context (auth, and user when authenticated) via setContext(..., { replace: true, source:
    "auth-web" }): authGuardRuntime:104.
  - That context is what when: ({ auth }) => ... functions in appended placement blocks depend on.

  14. App 17 Concrete Outcome

  - Final src/placement.js:15 contains:
  - 4 auth entries:
  - auth.profile.widget at app.top-right,
  - auth.profile.menu.open-app at avatar.primary-menu when authenticated,
  - auth.profile.menu.sign-in at avatar.primary-menu when not authenticated,
  - auth.profile.menu.sign-out at avatar.primary-menu when authenticated.
  - 5 users entries:
  - users.workspace.selector.app at app.top-left surface app,
  - users.workspace.selector.admin at app.top-left surface admin,
  - users.profile.menu.settings at avatar.primary-menu when authenticated,
  - users.admin.menu.workspace-settings at app.primary-menu surface admin,
  - users.admin.menu.members at app.primary-menu surface admin.
  - Direct Node check confirmed 9 placement objects exported with expected ids/slots/surfaces/orders and when function presence
    where defined.

  15. CLI show/view Placement Reporting

  - jskit show parses descriptor metadata placements and prints:
  - “Placement outlets (accepted slots)”
  - “Placement contributions (default entries)”: show logic:3731.
  - Verified in app 17:
  - shell-web shows 4 app shell outlets.
  - auth-web shows avatar.primary-menu outlet + 4 contributions.
  - users-web shows 5 contributions.
  - This display comes from descriptor metadata, not from parsing current src/placement.js.

  16. Add / Update / Remove / Doctor Lifecycle Findings

  - add applies mutations and writes lock/package changes; optionally runs npm install: add write/install:4521.
  - update package <id> is implemented as commandAdd for that package: commandUpdate:4567.
  - Because same-version packages are skipped in commandAdd, update may no-op unless version changes (or resolved target differs):
    same-version skip:4482.
  - remove restores package.json managed fields, reverts upsert-env, and restores/removes managed files when hashes match.
  - remove does not process append-text rollback in current implementation: remove text loop filter:4646.
  - doctor validates lock package presence and managed file hashes only; no text drift checks: doctor:4735.

  17. Important Architectural Consequence

  - Runtime truth for rendered placements is app code in src/placement.js, not descriptor metadata.
  - Descriptor metadata.ui.placements is currently for catalog/show/introspection surfaces.
  - This means there are two representations of “default contributions”:
  - declarative metadata (string when),
  - executable appended JS blocks (functional when).
  - They are aligned now for auth/users, but this dual representation can drift if not kept synchronized.

  18. Capability and Dependency Picture

  - auth-web and users-web both require runtime.web-placement capability, provided by shell-web.
  - That dependency is expressed in descriptors and enforced in add planning.
  - This ensures shell placement runtime exists before those modules contribute placement tokens/entries.

  19. Documentation Alignment

  - Manual chapter 005-Kernel:_Client_Into.md:1 matches current code flow very closely:
  - app-owned src/placement.js,
  - shell provider dynamic import,
  - module append strategy,
  - nested avatar outlet,
  - non-destructive remove of append-text blocks: doc remove note:251, doc mutation note:345.

  20. Specific Items Not Covered In This Sweep

  - I did not perform the requested comparison against LEGACY/app.LEGACY/jskit-value-app because that request was interrupted and
    superseded.
  - I did not run a full browser/server interaction test; validation was code-path inspection + CLI introspection + static export
    check from app 17.

  21. Practical One-Page Mental Model For Next Session

  - create-app starts minimal.
  - shell-web installs the app-owned placement registry file.
  - Feature web packages append addPlacement(...) blocks into that file.
  - At client boot, shell runtime imports /src/placement.js and loads entries.
  - Outlets in shell/auth components define where placement IDs can render.
  - Context and when() gates determine visibility at runtime.
  - Uninstall removes package-managed files/deps, but does not scrub app-owned appended placement blocks.
  - Descriptor placement metadata is an introspection contract, while src/placement.js is executable composition.

