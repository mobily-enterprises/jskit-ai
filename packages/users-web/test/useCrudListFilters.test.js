import test from "node:test";
import assert from "node:assert/strict";

test("useCrudListFilters manages values, query params, chips, and presets", async () => {
  const { useCrudListFilters } = await import("@jskit-ai/users-web/client/composables/useCrudListFilters");

  const filters = useCrudListFilters(
    {
      onlyStaff: {
        type: "flag",
        label: "Staff"
      },
      status: {
        type: "enumMany",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "archived", label: "Archived" }
        ]
      },
      supplierContactId: {
        type: "recordIdMany",
        label: "Supplier"
      },
      arrivalDate: {
        type: "dateRange",
        label: "Arrival Date"
      }
    },
    {
      labelResolvers: {
        supplierContactId(value) {
          return value === "7" ? "Pollen Partners" : "";
        }
      },
      presets: [
        {
          key: "needs-staff-review",
          label: "Needs Staff Review",
          values: {
            onlyStaff: true,
            status: ["archived"]
          }
        }
      ]
    }
  );

  filters.values.onlyStaff = true;
  filters.values.status = ["active"];
  filters.values.supplierContactId = ["7"];
  filters.values.arrivalDate.from = "2026-04-01";

  assert.equal(filters.queryParams.onlyStaff.value, true);
  assert.deepEqual(filters.queryParams.status.value, ["active"]);
  assert.equal(filters.queryParams.arrivalDate.value, "2026-04-01..");
  assert.equal(filters.hasActiveFilters.value, true);
  assert.deepEqual(
    filters.activeChips.value.map((chip) => chip.label),
    [
      "Staff",
      "Status: Active",
      "Supplier: Pollen Partners",
      "Arrival Date: from 2026-04-01"
    ]
  );

  filters.clearChip(filters.activeChips.value.find((chip) => chip.filterKey === "supplierContactId"));
  assert.deepEqual(filters.values.supplierContactId, []);

  filters.applyPreset("needs-staff-review");
  assert.equal(filters.values.onlyStaff, true);
  assert.deepEqual(filters.values.status, ["archived"]);
  assert.equal(filters.values.arrivalDate.from, "");

  filters.clearFilters();
  assert.equal(filters.values.onlyStaff, false);
  assert.deepEqual(filters.values.status, []);
  assert.equal(filters.hasActiveFilters.value, false);
});

test("useCrudListFilters supports dynamic presets and preset matching", async () => {
  const { useCrudListFilters } = await import("@jskit-ai/users-web/client/composables/useCrudListFilters");
  let today = "2026-04-18";

  const filters = useCrudListFilters(
    {
      status: {
        type: "enumMany",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "archived", label: "Archived" }
        ]
      },
      arrivalDate: {
        type: "dateRange",
        label: "Arrival Date"
      }
    },
    {
      presets: [
        {
          key: "today",
          label: "Today",
          resolveValues() {
            return {
              arrivalDate: {
                from: today,
                to: today
              }
            };
          }
        },
        {
          key: "all-dates",
          label: "All Dates",
          values: {
            arrivalDate: {
              from: "",
              to: ""
            }
          }
        }
      ]
    }
  );

  filters.values.status = ["archived"];
  filters.applyPreset("today", { mode: "merge" });

  assert.equal(filters.values.arrivalDate.from, "2026-04-18");
  assert.equal(filters.values.arrivalDate.to, "2026-04-18");
  assert.equal(filters.queryParams.arrivalDate.value, "2026-04-18");
  assert.deepEqual(filters.values.status, ["archived"]);
  assert.equal(filters.matchesPreset("today"), true);
  assert.equal(filters.matchesPreset("all-dates"), false);

  today = "2026-04-19";
  assert.equal(filters.matchesPreset("today"), false);

  filters.applyPreset("all-dates", { mode: "merge" });
  assert.equal(filters.values.arrivalDate.from, "");
  assert.equal(filters.values.arrivalDate.to, "");
  assert.deepEqual(filters.values.status, ["archived"]);
  assert.equal(filters.matchesPreset("all-dates"), true);
});

test("useCrudListFilters preset matching ignores invalid extra enumMany values outside the shared contract", async () => {
  const { useCrudListFilters } = await import("@jskit-ai/users-web/client/composables/useCrudListFilters");

  const filters = useCrudListFilters(
    {
      status: {
        type: "enumMany",
        label: "Status",
        options: [
          { value: "active", label: "Active" },
          { value: "archived", label: "Archived" }
        ]
      }
    },
    {
      presets: [
        {
          key: "archived-only",
          label: "Archived Only",
          values: {
            status: ["archived"]
          }
        }
      ]
    }
  );

  filters.values.status = ["archived", "bogus"];

  assert.equal(filters.matchesPreset("archived-only"), true);
  assert.deepEqual(filters.queryParams.status.value, ["archived"]);
  assert.deepEqual(
    filters.activeChips.value.map((chip) => chip.label),
    ["Status: Archived"]
  );
});

test("useCrudListFilters hydrates single-key range query params into structured values", async () => {
  const { useCrudListFilters } = await import("@jskit-ai/users-web/client/composables/useCrudListFilters");

  const filters = useCrudListFilters({
    arrivalDate: {
      type: "dateRange",
      label: "Arrival Date"
    },
    weight: {
      type: "numberRange",
      label: "Weight"
    }
  });

  filters.queryParams.arrivalDate.value = "..2026-04-30";
  filters.queryParams.weight.value = "12.5..18";

  assert.deepEqual(filters.values.arrivalDate, {
    from: "",
    to: "2026-04-30"
  });
  assert.deepEqual(filters.values.weight, {
    min: "12.5",
    max: "18"
  });
});
