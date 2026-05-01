import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const WORKSPACES_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  requestType: "workspaces",
  responseType: "workspaces",
  responseKind: "record"
});

const WORKSPACES_COLLECTION_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "workspaces",
  responseKind: "collection"
});

const WORKSPACE_SETTINGS_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  requestType: "workspace-settings",
  responseType: "workspace-settings",
  responseKind: "record"
});

const WORKSPACE_ROLE_CATALOG_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "workspace-role-catalogs",
  responseKind: "record"
});

const WORKSPACE_MEMBERS_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "workspace-members",
  responseKind: "record"
});

const WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  requestType: "workspace-member-role-updates",
  responseType: "workspace-members",
  responseKind: "record"
});

const WORKSPACE_INVITES_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "workspace-invites",
  responseKind: "record"
});

const WORKSPACE_INVITE_CREATE_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  requestType: "workspace-invite-creations",
  responseType: "workspace-invites",
  responseKind: "record"
});

const WORKSPACE_INVITE_REDEEM_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  requestType: "workspace-invitation-decisions",
  responseType: "workspace-invitation-decisions",
  responseKind: "record"
});

const WORKSPACE_PENDING_INVITATIONS_TRANSPORT = deepFreeze({
  kind: "jsonapi-resource",
  responseType: "workspace-pending-invitations",
  responseKind: "record"
});

export {
  WORKSPACES_TRANSPORT,
  WORKSPACES_COLLECTION_TRANSPORT,
  WORKSPACE_SETTINGS_TRANSPORT,
  WORKSPACE_ROLE_CATALOG_TRANSPORT,
  WORKSPACE_MEMBERS_TRANSPORT,
  WORKSPACE_MEMBER_ROLE_UPDATE_TRANSPORT,
  WORKSPACE_INVITES_TRANSPORT,
  WORKSPACE_INVITE_CREATE_TRANSPORT,
  WORKSPACE_INVITE_REDEEM_TRANSPORT,
  WORKSPACE_PENDING_INVITATIONS_TRANSPORT
};
