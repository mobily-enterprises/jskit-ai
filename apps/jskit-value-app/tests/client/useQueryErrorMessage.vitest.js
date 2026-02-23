import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useQueryErrorMessage } from "../../src/composables/useQueryErrorMessage.js";

function mountHarness({ query, handleUnauthorizedError, mapError }) {
  const Harness = defineComponent({
    name: "UseQueryErrorMessageHarness",
    setup() {
      return {
        query,
        error: useQueryErrorMessage({
          query,
          handleUnauthorizedError,
          mapError
        })
      };
    },
    template: "<div />"
  });

  return mount(Harness);
}

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("useQueryErrorMessage", () => {
  it("maps query errors and clears message when error disappears", async () => {
    const query = { error: ref(null) };
    const handleUnauthorizedError = vi.fn(async () => false);
    const mapError = vi.fn((error) => ({ message: `Mapped: ${error.message}` }));
    const wrapper = mountHarness({ query, handleUnauthorizedError, mapError });

    query.error.value = { message: "History unavailable." };
    await flush();
    expect(handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(mapError).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.error).toBe("Mapped: History unavailable.");

    query.error.value = null;
    await flush();
    expect(wrapper.vm.error).toBe("");
  });

  it("keeps message empty when unauthorized handler consumes the error", async () => {
    const query = { error: ref(null) };
    const handleUnauthorizedError = vi.fn(async () => true);
    const mapError = vi.fn(() => ({ message: "Should not be used." }));
    const wrapper = mountHarness({ query, handleUnauthorizedError, mapError });

    query.error.value = { status: 401, message: "Authentication required." };
    await flush();

    expect(handleUnauthorizedError).toHaveBeenCalledTimes(1);
    expect(mapError).not.toHaveBeenCalled();
    expect(wrapper.vm.error).toBe("");
  });

  it("falls back to direct message then default when mapper has no message", async () => {
    const query = { error: ref(null) };
    const handleUnauthorizedError = vi.fn(async () => false);
    const mapError = vi.fn(() => ({ message: "" }));
    const wrapper = mountHarness({ query, handleUnauthorizedError, mapError });

    query.error.value = { message: "Raw query error." };
    await flush();
    expect(wrapper.vm.error).toBe("Raw query error.");

    query.error.value = { status: 500 };
    await flush();
    expect(wrapper.vm.error).toBe("Unable to load data.");
  });
});
