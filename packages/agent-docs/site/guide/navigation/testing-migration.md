# Testing navigation

Destination navigation is infrastructure, so test chronology and restored work context together.

Upgrading an application? Follow [Migrate an existing app](/guide/navigation/migrate-existing-apps). Version 0 has no compatibility mode or legacy return-query reader.

## Generator behavior

Generic route pages accept a separate stack option:

```bash
npx jskit generate ui-generator page \
  admin/reports/index.vue \
  --name "Reports" \
  --navigation-role secondary \
  --destination-behavior destination \
  --destination-key admin.reports \
  --navigation-fallback /admin
```

Use `--machinery-key` with `--destination-behavior preserve`. CRUD generation writes explicit list/view destinations, new/edit machinery keys, a list restoration contributor id, stable page headings, real record links, and dirty-form blocker ids.

## Unit and contract tests

At minimum, cover:

- initial stamping without a push;
- one native entry per push and no new depth for replace;
- preserving machinery retaining destination identity;
- Back and Forward reusing existing entry ids;
- redirects, guard cancellation, and router errors;
- history-state sibling keys surviving every stamp;
- direct-link fallback using one replace and no loop;
- ownerless preserve/boundary routes keeping `activeEntry` null;
- storage unavailable and corrupt-storage degradation;
- principal/workspace/tenant/surface changes purging old state;
- delayed contributor registration, readiness, timeout, and cancellation;
- stable anchor before raw y and focus after scroll;
- dirty-form cancellation and confirmation through every navigation trigger.

Use Vue Router's supported memory/web/hash histories for adapter contracts. Do not mock private router internals.

## Portable browser test

The important E2E assertion is that shell Back and browser Back produce the same route and restored state in separate runs:

```ts
test("returns to an exact filtered list", async ({ page }) => {
  await page.goto("/w/acme/inventory?q=adapter&status=active");
  await page.getByRole("button", { name: "Expand safety details" }).click();
  await page.getByRole("link", { name: "View USB-C Adapter" }).click();
  await page.getByTestId("jskit-shell-leading-navigation").click();

  await expect(page).toHaveURL(/q=adapter&status=active/);
  await expect(page.getByText("Safety details")).toBeVisible();

  await page.getByRole("link", { name: "View USB-C Adapter" }).click();
  await page.goBack();
  await expect(page).toHaveURL(/q=adapter&status=active/);
});
```

Also test Forward, hard reload at each destination and machinery route, direct links, `_blank`, storage denial, deleted anchors, auth change, runtime resizing, keyboard-only use, RTL, reduced motion, dark/light themes, and 200% zoom.

For adaptive shell checks, cover compact bottom navigation and More, medium rail and overflow, and expanded permanent drawer. Verify 48-pixel targets, accessible names, `aria-current`, focus return, safe-area padding, no horizontal overflow, and that resizing never changes the current route.

## Troubleshooting

`Route ... requires explicit meta.jskit.navigation` means the committed route has no resolved behavior. Add metadata to the visible child route; redirects that never commit do not need a frame.

`missing-contributor` means a route named an id in `restore` that did not register after mount. Check that the id is identical and registration runs in routed component setup.

`contributor-data-timeout` means `isDataReady()` never became true. Make it observe real query and layout state; do not replace it with a sleep.

`snapshot-unavailable` or storage warnings mean JSKIT degraded to URL/raw-scroll behavior. The route should still be usable.

If Back is absent, inspect `canPop`, the immediate stamped predecessor, and the route fallback with `npx jskit list-navigation --details`. Do not inspect `history.length`.

Before release, run:

```bash
npm run verify
npx jskit list-navigation --json
npx jskit doctor --against <base-ref>
npx jskit app verify-ui
```
