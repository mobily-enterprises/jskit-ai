import { defineStore } from "pinia";
import { queryClient } from "../queryClient.js";
import { api } from "../../platform/http/api/index.js";
import {
  APP_DEFAULT_OAUTH_PROVIDERS,
  normalizeAppOAuthProvider,
  normalizeOAuthProviderCatalog
} from "../../modules/auth/oauthProviders.js";

export const SESSION_QUERY_KEY = ["session"];

export const useAuthStore = defineStore("auth", {
  state: () => ({
    authenticated: false,
    username: null,
    oauthProviders: normalizeOAuthProviderCatalog(APP_DEFAULT_OAUTH_PROVIDERS),
    oauthDefaultProvider: normalizeAppOAuthProvider(null, {
      providers: APP_DEFAULT_OAUTH_PROVIDERS,
      fallback: APP_DEFAULT_OAUTH_PROVIDERS[0]?.id || null
    }),
    initialized: false
  }),
  getters: {
    isAuthenticated(state) {
      return state.authenticated;
    }
  },
  actions: {
    applySession(session) {
      const nextOAuthProviders = normalizeOAuthProviderCatalog(session?.oauthProviders, {
        fallback: this.oauthProviders.length > 0 ? this.oauthProviders : APP_DEFAULT_OAUTH_PROVIDERS
      });
      const nextOAuthDefaultProvider = normalizeAppOAuthProvider(session?.oauthDefaultProvider, {
        providers: nextOAuthProviders,
        fallback: nextOAuthProviders[0]?.id || null
      });

      this.authenticated = Boolean(session?.authenticated);
      this.username = this.authenticated ? session?.username || null : null;
      this.oauthProviders = nextOAuthProviders;
      this.oauthDefaultProvider = nextOAuthDefaultProvider;
      this.initialized = true;
      return session;
    },
    async ensureSession({ force = false } = {}) {
      const queryOptions = {
        queryKey: SESSION_QUERY_KEY,
        queryFn: () => api.auth.session(),
        staleTime: 60000
      };

      if (force) {
        const session = await api.auth.session();
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
      queryClient.setQueryData(SESSION_QUERY_KEY, {
        authenticated: false,
        oauthProviders: this.oauthProviders,
        oauthDefaultProvider: this.oauthDefaultProvider
      });
    },
    setUsername(username) {
      this.username = username ? String(username) : null;
    }
  }
});
