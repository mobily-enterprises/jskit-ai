import { defineStore } from "pinia";
import { queryClient } from "../queryClient";
import { api } from "../services/api";

export const SESSION_QUERY_KEY = ["session"];

export const useAuthStore = defineStore("auth", {
  state: () => ({
    authenticated: false,
    username: null,
    initialized: false
  }),
  getters: {
    isAuthenticated(state) {
      return state.authenticated;
    }
  },
  actions: {
    applySession(session) {
      this.authenticated = Boolean(session?.authenticated);
      this.username = this.authenticated ? session?.username || null : null;
      this.initialized = true;
      return session;
    },
    async ensureSession({ force = false } = {}) {
      const queryOptions = {
        queryKey: SESSION_QUERY_KEY,
        queryFn: () => api.session(),
        staleTime: 60000
      };

      if (force) {
        const session = await api.session();
        queryClient.setQueryData(SESSION_QUERY_KEY, session);
        return this.applySession(session);
      }

      if (!force && this.initialized) {
        const session = await queryClient.ensureQueryData(queryOptions);
        return this.applySession(session);
      }

      const session = await queryClient.ensureQueryData(queryOptions);
      return this.applySession(session);
    },
    async refreshSession() {
      return this.ensureSession({ force: true });
    },
    async invalidateSession() {
      this.initialized = false;
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
    setSignedOut() {
      this.authenticated = false;
      this.username = null;
      this.initialized = true;
      queryClient.setQueryData(SESSION_QUERY_KEY, { authenticated: false });
    }
  }
});
