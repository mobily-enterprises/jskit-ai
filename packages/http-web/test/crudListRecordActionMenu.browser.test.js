import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

const openFixture = sharedBrowserFixture({
  fixtureRoot: fileURLToPath(new URL("../fixtures/record-action-menu/", import.meta.url))
});

// A list's phone cards and a wider window's table rows show the same menu.
for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }]) {
  test(`a list record's action menu is a menu of menu items at ${viewport.width}px`, {
    skip: process.env.JSKIT_HTTP_WEB_RECORD_ACTION_MENU_BROWSER === "1"
      ? false
      : "set JSKIT_HTTP_WEB_RECORD_ACTION_MENU_BROWSER=1 to run the record action menu browser regression",
    timeout: 120_000
  }, async (t) => {
    const { vite: runtime, browser } = await openFixture(t);
    const page = await browser.newPage({ baseURL: runtime.baseURL, viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/", { waitUntil: "networkidle" });

    const button = page.getByRole("button", { name: "Actions for Kindred" });
    await expect(button).toHaveAttribute("aria-haspopup", "menu");

    // The keyboard opens the menu on its first item, as a menu button does.
    await button.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Actions for Kindred" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
    await expect(menu.getByRole("menuitem")).toHaveText(["Open", "Edit", "Lend", "Archive"]);
    await expect(menu.getByRole("menuitem", { name: "Open" })).toHaveAttribute("href", "/books/2");
    await expect(menu.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("href", "/books/2/edit");
    await expect(menu.getByRole("menuitem", { name: "Archive", disabled: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Lend", disabled: false })).toBeVisible();
    await expect(menu.getByRole("separator")).toHaveCount(1);

    await menu.getByRole("menuitem", { name: "Lend" }).click();
    await expect(page.getByTestId("record-action-menu-ran")).toHaveText("lend");
    await expect(menu).toBeHidden();
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
