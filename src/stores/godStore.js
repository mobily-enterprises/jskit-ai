import { defineStore } from "pinia";
import { api } from "../services/api/index.js";

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMembership(membership) {
  if (!membership || typeof membership !== "object") {
    return null;
  }

  const roleId = String(membership.roleId || "").trim();
  const status = String(membership.status || "active").trim() || "active";
  if (!roleId) {
    return null;
  }

  return {
    roleId,
    status
  };
}

function normalizeRoleCatalog(roleCatalog) {
  const catalog = roleCatalog && typeof roleCatalog === "object" ? roleCatalog : {};
  return {
    defaultInviteRole: String(catalog.defaultInviteRole || "") || null,
    roles: normalizeArray(catalog.roles)
      .map((role) => {
        if (!role || typeof role !== "object") {
          return null;
        }

        const id = String(role.id || "").trim();
        if (!id) {
          return null;
        }

        return {
          id,
          assignable: Boolean(role.assignable),
          permissions: normalizeArray(role.permissions)
            .map((permission) => String(permission || "").trim())
            .filter(Boolean)
        };
      })
      .filter(Boolean),
    assignableRoleIds: normalizeArray(catalog.assignableRoleIds)
      .map((roleId) => String(roleId || "").trim())
      .filter(Boolean)
  };
}

function normalizePendingInvite(invite) {
  if (!invite || typeof invite !== "object") {
    return null;
  }

  const id = Number(invite.id);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  const token = String(invite.token || "").trim();
  if (!token) {
    return null;
  }

  return {
    id,
    token,
    email: String(invite.email || ""),
    roleId: String(invite.roleId || ""),
    status: String(invite.status || "pending"),
    expiresAt: String(invite.expiresAt || ""),
    invitedByUserId: invite.invitedByUserId == null ? null : Number(invite.invitedByUserId),
    invitedByDisplayName: String(invite.invitedByDisplayName || ""),
    invitedByEmail: String(invite.invitedByEmail || "")
  };
}

export const useGodStore = defineStore("god", {
  state: () => ({
    initialized: false,
    membership: null,
    permissions: [],
    pendingInvites: [],
    roleCatalog: normalizeRoleCatalog(null)
  }),
  getters: {
    hasAccess(state) {
      return Boolean(state.membership && state.membership.status === "active");
    },
    hasPendingInvites(state) {
      return normalizeArray(state.pendingInvites).length > 0;
    }
  },
  actions: {
    applyBootstrap(payload = {}) {
      this.membership = normalizeMembership(payload.membership);
      this.permissions = normalizeArray(payload.permissions)
        .map((permission) => String(permission || "").trim())
        .filter(Boolean);
      this.pendingInvites = normalizeArray(payload.pendingInvites).map(normalizePendingInvite).filter(Boolean);
      this.roleCatalog = normalizeRoleCatalog(payload.roleCatalog);
      this.initialized = true;
      return payload;
    },
    setForbidden() {
      this.membership = null;
      this.permissions = [];
      this.roleCatalog = normalizeRoleCatalog(this.roleCatalog);
      this.initialized = true;
    },
    clearGodState() {
      this.initialized = false;
      this.membership = null;
      this.permissions = [];
      this.pendingInvites = [];
      this.roleCatalog = normalizeRoleCatalog(null);
    },
    can(permission) {
      const normalized = String(permission || "").trim();
      if (!normalized) {
        return true;
      }

      return this.permissions.includes("*") || this.permissions.includes(normalized);
    },
    async refreshBootstrap() {
      const payload = await api.god.bootstrap();
      return this.applyBootstrap(payload);
    },
    async refreshPendingInvites() {
      const payload = await api.god.listPendingInvites();
      this.pendingInvites = normalizeArray(payload.pendingInvites).map(normalizePendingInvite).filter(Boolean);
      return this.pendingInvites;
    },
    removePendingInvite(inviteToken) {
      const normalizedToken = String(inviteToken || "").trim();
      if (!normalizedToken) {
        return;
      }

      this.pendingInvites = this.pendingInvites.filter((invite) => String(invite.token || "") !== normalizedToken);
    },
    async respondToPendingInvite(inviteToken, decision) {
      const normalizedInviteToken = String(inviteToken || "").trim();
      const response = await api.god.redeemInvite({
        token: normalizedInviteToken,
        decision: String(decision || "")
          .trim()
          .toLowerCase()
      });

      this.removePendingInvite(normalizedInviteToken);
      if (String(response?.decision || "") === "accepted") {
        await this.refreshBootstrap();
      }

      return response;
    }
  }
});
