import { defineStore } from "pinia";
import { createSurfacePaths, resolveSurfaceFromPathname } from "../../shared/routing/surfacePaths.js";
import { DEFAULT_SURFACE_ID, normalizeSurfaceId } from "../../shared/routing/surfaceRegistry.js";
import { api } from "../services/api";

const DEFAULT_WORKSPACE_COLOR = "#0F6B54";
const WORKSPACE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (WORKSPACE_COLOR_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  return DEFAULT_WORKSPACE_COLOR;
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
    color: normalizeWorkspaceColor(workspace.color),
    avatarUrl: workspace.avatarUrl ? String(workspace.avatarUrl) : "",
    roleId: workspace.roleId ? String(workspace.roleId) : null,
    isAccessible: Boolean(workspace.isAccessible)
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

function normalizeWorkspaceSettings(workspaceSettings) {
  if (!workspaceSettings || typeof workspaceSettings !== "object") {
    return null;
  }

  return {
    invitesEnabled: Boolean(workspaceSettings.invitesEnabled),
    invitesAvailable: Boolean(workspaceSettings.invitesAvailable),
    invitesEffective: Boolean(workspaceSettings.invitesEffective),
    defaultMode: String(workspaceSettings.defaultMode || "fv"),
    defaultTiming: String(workspaceSettings.defaultTiming || "ordinary"),
    defaultPaymentsPerYear: Number(workspaceSettings.defaultPaymentsPerYear || 12),
    defaultHistoryPageSize: Number(workspaceSettings.defaultHistoryPageSize || 10)
  };
}

function normalizePendingInvite(invite) {
  if (!invite || typeof invite !== "object") {
    return null;
  }

  const id = Number(invite.id);
  const workspaceId = Number(invite.workspaceId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(workspaceId) || workspaceId < 1) {
    return null;
  }

  const workspaceSlug = String(invite.workspaceSlug || "").trim();
  if (!workspaceSlug) {
    return null;
  }

  return {
    id,
    workspaceId,
    workspaceSlug,
    workspaceName: String(invite.workspaceName || workspaceSlug),
    workspaceAvatarUrl: invite.workspaceAvatarUrl ? String(invite.workspaceAvatarUrl) : "",
    roleId: String(invite.roleId || "member"),
    status: String(invite.status || "pending"),
    expiresAt: String(invite.expiresAt || ""),
    invitedByDisplayName: String(invite.invitedByDisplayName || ""),
    invitedByEmail: String(invite.invitedByEmail || "")
  };
}

function resolveWorkspacePathSurfaceId(preferredSurface) {
  const preferred = String(preferredSurface || "").trim();
  if (preferred) {
    return normalizeSurfaceId(preferred);
  }

  if (typeof window !== "undefined" && window?.location?.pathname) {
    return resolveSurfaceFromPathname(String(window.location.pathname));
  }

  return DEFAULT_SURFACE_ID;
}

export const useWorkspaceStore = defineStore("workspace", {
  state: () => ({
    initialized: false,
    profile: null,
    app: {
      tenancyMode: "personal",
      features: {
        workspaceSwitching: false,
        workspaceInvites: false,
        workspaceCreateEnabled: false
      }
    },
    workspaces: [],
    pendingInvites: [],
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
    },
    pendingInvitesCount(state) {
      return normalizeArray(state.pendingInvites).length;
    },
    accessibleWorkspaces(state) {
      return normalizeArray(state.workspaces).filter((workspace) => Boolean(workspace?.isAccessible));
    }
  },
  actions: {
    applyBootstrap(payload = {}) {
      this.profile = normalizeProfile(payload.profile);

      const app = payload.app && typeof payload.app === "object" ? payload.app : {};
      this.app = {
        tenancyMode: String(app.tenancyMode || "personal"),
        features: {
          workspaceSwitching: Boolean(app.features?.workspaceSwitching),
          workspaceInvites: Boolean(app.features?.workspaceInvites),
          workspaceCreateEnabled: Boolean(app.features?.workspaceCreateEnabled)
        }
      };

      this.workspaces = normalizeArray(payload.workspaces).map(normalizeWorkspace).filter(Boolean);
      this.pendingInvites = normalizeArray(payload.pendingInvites).map(normalizePendingInvite).filter(Boolean);
      this.activeWorkspace = normalizeWorkspace(payload.activeWorkspace);
      this.membership = normalizeMembership(payload.membership);
      this.permissions = normalizeArray(payload.permissions)
        .map((permission) => String(permission || "").trim())
        .filter(Boolean);
      this.workspaceSettings = normalizeWorkspaceSettings(payload.workspaceSettings);
      this.userSettings =
        payload.userSettings && typeof payload.userSettings === "object" ? { ...payload.userSettings } : null;

      if (this.activeWorkspace) {
        const matchingWorkspace = this.workspaces.find((workspace) => workspace.id === this.activeWorkspace.id);
        this.activeWorkspace = {
          ...this.activeWorkspace,
          isAccessible: matchingWorkspace ? Boolean(matchingWorkspace.isAccessible) : true
        };
      }

      if (!this.activeWorkspace && this.workspaces.length === 1) {
        this.activeWorkspace = {
          id: this.workspaces[0].id,
          slug: this.workspaces[0].slug,
          name: this.workspaces[0].name,
          color: this.workspaces[0].color,
          avatarUrl: this.workspaces[0].avatarUrl,
          roleId: this.workspaces[0].roleId,
          isAccessible: this.workspaces[0].isAccessible
        };
      }

      this.initialized = true;
      return payload;
    },
    applyWorkspaceSelection(payload = {}) {
      this.activeWorkspace = normalizeWorkspace(payload.workspace);
      this.membership = normalizeMembership(payload.membership);
      this.permissions = normalizeArray(payload.permissions)
        .map((permission) => String(permission || "").trim())
        .filter(Boolean);
      this.workspaceSettings = normalizeWorkspaceSettings(payload.workspaceSettings);

      if (this.activeWorkspace) {
        this.activeWorkspace = {
          ...this.activeWorkspace,
          isAccessible: true
        };
      }

      if (this.activeWorkspace) {
        const existingIndex = this.workspaces.findIndex((workspace) => workspace.id === this.activeWorkspace.id);
        if (existingIndex >= 0) {
          this.workspaces.splice(existingIndex, 1, {
            ...this.workspaces[existingIndex],
            ...this.activeWorkspace,
            roleId: this.membership?.roleId || this.workspaces[existingIndex].roleId,
            isAccessible: true
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
    setPendingInvites(pendingInvites) {
      this.pendingInvites = normalizeArray(pendingInvites).map(normalizePendingInvite).filter(Boolean);
    },
    removePendingInvite(inviteId) {
      const numericInviteId = Number(inviteId);
      if (!Number.isInteger(numericInviteId) || numericInviteId < 1) {
        return;
      }

      this.pendingInvites = this.pendingInvites.filter((invite) => Number(invite.id) !== numericInviteId);
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
    async refreshPendingInvites() {
      const payload = await api.pendingWorkspaceInvites();
      this.setPendingInvites(payload.pendingInvites || []);
      return this.pendingInvites;
    },
    async selectWorkspace(workspaceSlug) {
      const payload = await api.selectWorkspace({
        workspaceSlug: String(workspaceSlug || "").trim()
      });
      this.applyWorkspaceSelection(payload);
      return payload;
    },
    async respondToPendingInvite(inviteId, decision) {
      const response = await api.respondWorkspaceInvite(inviteId, {
        decision: String(decision || "")
          .trim()
          .toLowerCase()
      });

      this.removePendingInvite(response?.inviteId || inviteId);

      if (String(response?.decision || "") === "accepted" && response?.workspace?.slug) {
        const selection = await this.selectWorkspace(response.workspace.slug);
        return {
          ...response,
          selection
        };
      }

      return response;
    },
    workspacePath(pathname = "/", options = {}) {
      const surface = resolveWorkspacePathSurfaceId(options?.surface);
      const surfacePaths = createSurfacePaths(surface);
      return surfacePaths.workspacePath(this.activeWorkspaceSlug, pathname);
    },
    clearWorkspaceState() {
      this.initialized = false;
      this.profile = null;
      this.workspaces = [];
      this.pendingInvites = [];
      this.activeWorkspace = null;
      this.membership = null;
      this.permissions = [];
      this.workspaceSettings = null;
      this.userSettings = null;
    }
  }
});
