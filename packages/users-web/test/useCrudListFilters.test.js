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
  assert.equal(filters.queryParams.arrivalDateFrom.value, "2026-04-01");
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
