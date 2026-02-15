import { QueryClient } from "@tanstack/vue-query";

function shouldRetryRequest(failureCount, error) {
  if (failureCount >= 2) {
    return false;
  }

  const status = Number(error?.status || 0);
  if (!Number.isFinite(status) || status <= 0) {
    return true;
  }

  return status >= 500 || status === 429;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000,
      gcTime: 300000,
      retry: shouldRetryRequest,
      retryDelay: 500,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: shouldRetryRequest,
      retryDelay: 500
    }
  }
});

export const __testables = {
  shouldRetryRequest
};
