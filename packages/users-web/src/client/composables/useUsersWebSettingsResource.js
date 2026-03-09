import { computed, watch } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";

function useUsersWebSettingsResource({
  queryKey,
  queryFn,
  queryEnabled = true,
  mutationFn,
  onQuerySuccess = null,
  onQueryError = null,
  onMutationSuccess = null,
  onMutationError = null,
  queryOptions = null,
  mutationOptions = null
} = {}) {
  if (typeof queryFn !== "function") {
    throw new TypeError("useUsersWebSettingsResource requires queryFn().");
  }
  if (typeof mutationFn !== "function") {
    throw new TypeError("useUsersWebSettingsResource requires mutationFn().");
  }

  const query = useQuery({
    queryKey,
    queryFn,
    enabled: queryEnabled,
    refetchOnWindowFocus: false,
    ...(queryOptions && typeof queryOptions === "object" ? queryOptions : {})
  });

  watch(
    () => query.data.value,
    (payload) => {
      if (payload !== undefined && typeof onQuerySuccess === "function") {
        onQuerySuccess(payload);
      }
    },
    {
      immediate: true
    }
  );

  watch(
    () => query.error.value,
    (error) => {
      if (error && typeof onQueryError === "function") {
        onQueryError(error);
      }
    }
  );

  watch(
    () => resource.mutation.data.value,
    (payload) => {
      if (payload === undefined) {
        return;
      }
      const variables = resource.mutation.variables.value;
      if (typeof onMutationSuccess === "function") {
        onMutationSuccess(payload, variables, undefined);
      }
      if (typeof mutationOptions?.onSuccess === "function") {
        mutationOptions.onSuccess(payload, variables, undefined);
      }
    }
  );

  watch(
    () => resource.mutation.error.value,
    (error) => {
      if (!error) {
        return;
      }
      const variables = resource.mutation.variables.value;
      if (typeof onMutationError === "function") {
        onMutationError(error, variables, undefined);
      }
      if (typeof mutationOptions?.onError === "function") {
        mutationOptions.onError(error, variables, undefined);
      }
    }
  );

  const mutation = useMutation({
    mutationFn,
    ...(mutationOptions && typeof mutationOptions === "object" ? mutationOptions : {}),
    onSuccess: (payload, variables, context) => {
      if (typeof onMutationSuccess === "function") {
        onMutationSuccess(payload, variables, context);
      }
      if (typeof mutationOptions?.onSuccess === "function") {
        mutationOptions.onSuccess(payload, variables, context);
      }
    },
    onError: (error, variables, context) => {
      if (typeof onMutationError === "function") {
        onMutationError(error, variables, context);
      }
      if (typeof mutationOptions?.onError === "function") {
        mutationOptions.onError(error, variables, context);
      }
    }
  });

  const loading = computed(() => Boolean(query.isPending.value || query.isFetching.value));
  const saving = computed(() => Boolean(mutation.isPending.value));

  async function reload() {
    return query.refetch();
  }

  async function submit(payload) {
    return mutation.mutateAsync(payload);
  }

  return Object.freeze({
    query,
    mutation,
    loading,
    saving,
    reload,
    submit
  });
}

export { useUsersWebSettingsResource };
