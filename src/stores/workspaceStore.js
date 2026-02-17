import { defineStore } from "pinia";
import { api } from "../services/api";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeProfileAvatar(avatar) {
  if (!avatar || typeof avatar !== "object") {
    return null;
  }

  return {
    uploadedUrl: avatar.uploadedUrl || null,
    gravatarUrl: String(avatar.gravatarUrl || ""),
    effectiveUrl: String(avatar.effectiveUrl || ""),
    hasUploadedAvatar: Boolean(avatar.hasUploadedAvatar),
    size: Number(avatar.size || 64),
    version: avatar.version == null ? null : String(avatar.version)
  };
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  return {
    displayName: String(profile.displayName || ""),
    email: String(profile.email || ""),
    avatar: normalizeProfileAvatar(profile.avatar)
  };
}

function normalizeWorkspace(workspace) {
  if (!workspace || typeof workspace !== "object") {
    return null;
  }

  const id = Number(workspace.id);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  const slug = String(workspace.slug || "").trim();
  if (!slug) {
    return null;
  }

  return {
    id,
    slug,
    name: String(workspace.name || slug),
    roleId: workspace.roleId ? String(workspace.roleId) : null
  };
}

function normalizeMembership(membership) {
  if (!membership || typeof membership !== "object") {
    return null;
  }

  const roleId = String(membership.roleId || "").trim();
  const status = String(membership.status || "").trim() || "active";
  if (!roleId) {
    return null;
  }

  return {
    roleId,
    status
  };
}

export const useWorkspaceStore = defineStore("workspace", {
  state: () => ({
    initialized: false,
    profile: null,
    app: {
      tenancyMode: "personal",
      features: {
        workspaceSwitching: false
      }
    },
    workspaces: [],
    activeWorkspace: null,
    membership: null,
    permissions: [],
    workspaceSettings: null,
    userSettings: null
  }),
  getters: {
    hasActiveWorkspace(state) {
      return Boolean(state.activeWorkspace && state.activeWorkspace.id);
    },
    activeWorkspaceSlug(state) {
      return state.activeWorkspace?.slug || "";
    },
    profileAvatarUrl(state) {
      const url = String(state.profile?.avatar?.effectiveUrl || "").trim();
      return url || "";
    },
    profileDisplayName(state) {
      return String(state.profile?.displayName || "").trim();
    }
  },
  actions: {
    applyBootstrap(payload = {}) {
      this.profile = normalizeProfile(payload.profile);

      const app = payload.app && typeof payload.app === "object" ? payload.app : {};
      this.app = {
        tenancyMode: String(app.tenancyMode || "personal"),
        features: {
          workspaceSwitching: Boolean(app.features?.workspaceSwitching)
        }
      };

      this.workspaces = normalizeArray(payload.workspaces).map(normalizeWorkspace).filter(Boolean);
      this.activeWorkspace = normalizeWorkspace(payload.activeWorkspace);
      this.membership = normalizeMembership(payload.membership);
      this.permissions = normalizeArray(payload.permissions).map((permission) => String(permission || "").trim()).filter(Boolean);
      this.workspaceSettings =
        payload.workspaceSettings && typeof payload.workspaceSettings === "object"
          ? {
              invitesEnabled: Boolean(payload.workspaceSettings.invitesEnabled)
            }
          : null;
      this.userSettings =
        payload.userSettings && typeof payload.userSettings === "object" ? { ...payload.userSettings } : null;

      if (!this.activeWorkspace && this.workspaces.length === 1) {
        this.activeWorkspace = {
          id: this.workspaces[0].id,
          slug: this.workspaces[0].slug,
          name: this.workspaces[0].name,
          roleId: this.workspaces[0].roleId
        };
      }

      this.initialized = true;
      return payload;
    },
    applyWorkspaceSelection(payload = {}) {
      this.activeWorkspace = normalizeWorkspace(payload.workspace);
      this.membership = normalizeMembership(payload.membership);
      this.permissions = normalizeArray(payload.permissions).map((permission) => String(permission || "").trim()).filter(Boolean);
      this.workspaceSettings =
        payload.workspaceSettings && typeof payload.workspaceSettings === "object"
          ? {
              invitesEnabled: Boolean(payload.workspaceSettings.invitesEnabled)
            }
          : null;

      if (this.activeWorkspace) {
        const existingIndex = this.workspaces.findIndex((workspace) => workspace.id === this.activeWorkspace.id);
        if (existingIndex >= 0) {
          this.workspaces.splice(existingIndex, 1, {
            ...this.workspaces[existingIndex],
            ...this.activeWorkspace,
            roleId: this.membership?.roleId || this.workspaces[existingIndex].roleId
          });
        }
      }
    },
    applyProfile(profile) {
      const normalized = normalizeProfile(profile);
      if (!normalized) {
        return;
      }

      this.profile = {
        ...(this.profile || {}),
        ...normalized,
        avatar: normalized.avatar
      };
    },
    can(permission) {
      const normalized = String(permission || "").trim();
      if (!normalized) {
        return true;
      }
      return this.permissions.includes("*") || this.permissions.includes(normalized);
    },
    async refreshBootstrap() {
      const payload = await api.bootstrap();
      return this.applyBootstrap(payload);
    },
    async selectWorkspace(workspaceSlug) {
      const payload = await api.selectWorkspace({
        workspaceSlug: String(workspaceSlug || "").trim()
      });
      this.applyWorkspaceSelection(payload);
      return payload;
    },
    workspacePath(pathname = "/") {
      const slug = this.activeWorkspaceSlug;
      if (!slug) {
        return "/workspaces";
      }

      const suffix = String(pathname || "/");
      if (suffix === "/") {
        return `/w/${slug}`;
      }
      return `/w/${slug}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
    },
    clearWorkspaceState() {
      this.initialized = false;
      this.profile = null;
      this.workspaces = [];
      this.activeWorkspace = null;
      this.membership = null;
      this.permissions = [];
      this.workspaceSettings = null;
      this.userSettings = null;
    }
  }
});
