import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  parseDateOnlyValue,
  formatDateOnlyValue,
  formatDateOnlyDisplay,
  formatCrudListDateFilterChipLabel
} from "../src/client/support/crudListDateFilterSupport.js";

test("date filter picker values round-trip through the YYYY-MM-DD contract", () => {
  const parsed = parseDateOnlyValue("2026-04-18");

  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 3);
  assert.equal(parsed.getDate(), 18);
  assert.equal(formatDateOnlyValue(parsed), "2026-04-18");
  assert.equal(formatDateOnlyValue([new Date(2026, 4, 9)]), "2026-05-09");
  assert.equal(formatDateOnlyValue("2026-11-03"), "2026-11-03");
});

test("date filter parsing rejects impossible calendar dates", () => {
  assert.equal(parseDateOnlyValue("2026-02-29"), null);
  assert.ok(parseDateOnlyValue("2028-02-29") instanceof Date);
  assert.equal(parseDateOnlyValue("04/18/2026"), null);
  assert.equal(parseDateOnlyValue(""), null);
  assert.equal(formatDateOnlyValue(new Date("invalid")), "");
});

test("date filter display and chip labels are locale-aware without exposing Date strings", () => {
  assert.equal(formatDateOnlyDisplay("2026-04-18", { locale: "en-US" }), "Apr 18, 2026");
  assert.equal(formatDateOnlyDisplay("2026-04-18", { locale: "en-GB" }), "18 Apr 2026");
  assert.equal(
    formatCrudListDateFilterChipLabel(
      { type: "date", label: "Submitted" },
      "2026-04-18",
      { locale: "en-US" }
    ),
    "Submitted: Apr 18, 2026"
  );
  assert.equal(
    formatCrudListDateFilterChipLabel(
      { type: "dateRange", label: "Arrival" },
      { from: "2026-05-04", to: "2026-05-10" },
      { locale: "en-US" }
    ),
    "Arrival: May 4, 2026 to May 10, 2026"
  );
  assert.equal(
    formatCrudListDateFilterChipLabel(
      { type: "dateRange", label: "Arrival" },
      { from: "", to: "2026-05-10" },
      { locale: "en-US" }
    ),
    "Arrival: to May 10, 2026"
  );
});

test("date-only conversion does not shift across time zones", () => {
  const supportModuleUrl = new URL(
    "../src/client/support/crudListDateFilterSupport.js",
    import.meta.url
  ).href;
  const script = `
    import { parseDateOnlyValue, formatDateOnlyValue } from ${JSON.stringify(supportModuleUrl)};
    const parsed = parseDateOnlyValue("2026-01-01");
    process.stdout.write(JSON.stringify({
      value: formatDateOnlyValue(parsed),
      year: parsed.getFullYear(),
      month: parsed.getMonth(),
      day: parsed.getDate()
    }));
  `;

  for (const timezone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        TZ: timezone
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      value: "2026-01-01",
      year: 2026,
      month: 0,
      day: 1
    }, timezone);
  }
});
