import { test, expect } from "@playwright/test";

const JSON_HEADERS = {
  "content-type": "application/json"
};

const WORKSPACE = {
  id: 1,
  slug: "acme",
  name: "Acme",
  color: "#0F6B54",
  roleId: "owner",
  isAccessible: true
};

function buildBootstrapResponse({ csrfToken = "csrf-chat", username = "owner.user" } = {}) {
  return {
    session: {
      authenticated: true,
      username,
      csrfToken
    },
    profile: {
      displayName: username,
      email: `${username}@example.com`,
      avatar: null
    },
    app: {
      tenancyMode: "workspace",
      features: {
        workspaceSwitching: true,
        workspaceInvites: true,
        workspaceCreateEnabled: true
      }
    },
    workspaces: [WORKSPACE],
    pendingInvites: [],
    activeWorkspace: WORKSPACE,
    membership: {
      roleId: "owner",
      status: "active"
    },
    permissions: ["chat.read", "chat.write"],
    workspaceSettings: {
      invitesEnabled: true,
      invitesAvailable: true,
      invitesEffective: true,
      defaultMode: "fv",
      defaultTiming: "ordinary",
      defaultPaymentsPerYear: 12,
      defaultHistoryPageSize: 10
    }
  };
}

function toIsoNow() {
  return new Date().toISOString();
}

test("chat smoke: start DM, upload attachment, send message, and emit typing", async ({ page }) => {
  const state = {
    workspaceEnsureRequestCount: 0,
    dmCreated: false,
    ensureRequestCount: 0,
    typingRequestCount: 0,
    reserveRequestCount: 0,
    uploadRequestCount: 0,
    sendRequestCount: 0,
    nextMessageId: 100,
    nextAttachmentId: 500,
    attachmentById: new Map(),
    messages: []
  };

  const dmCandidate = {
    userId: 42,
    displayName: "Tony Mobily",
    avatarUrl: null,
    publicChatId: "u42",
    sharedWorkspaceCount: 1
  };

  function buildThreadResponse() {
    const lastMessage = state.messages[state.messages.length - 1] || null;
    return {
      id: 88,
      scopeKind: "global",
      workspaceId: null,
      threadKind: "dm",
      title: null,
      participantCount: 2,
      lastMessageId: lastMessage ? Number(lastMessage.id) : null,
      lastMessageSeq: lastMessage ? Number(lastMessage.threadSeq) : null,
      lastMessageAt: lastMessage ? String(lastMessage.sentAt) : null,
      lastMessagePreview: lastMessage?.text || null,
      createdAt: "2026-02-23T00:00:00.000Z",
      updatedAt: toIsoNow(),
      unreadCount: 0,
      participant: {
        status: "active",
        lastReadSeq: lastMessage ? Number(lastMessage.threadSeq) : 0,
        lastReadMessageId: lastMessage ? Number(lastMessage.id) : null,
        lastReadAt: lastMessage ? String(lastMessage.sentAt) : null,
        mutedUntil: null,
        archivedAt: null,
        pinnedAt: null
      },
      peerUser: {
        id: 42,
        displayName: "Tony Mobily",
        avatarUrl: null
      }
    };
  }

  function buildWorkspaceRoomThreadResponse() {
    return {
      id: 77,
      scopeKind: "workspace",
      workspaceId: 1,
      threadKind: "workspace_room",
      title: "Workspace chat",
      participantCount: 2,
      lastMessageId: null,
      lastMessageSeq: null,
      lastMessageAt: null,
      lastMessagePreview: null,
      createdAt: "2026-02-23T00:00:00.000Z",
      updatedAt: toIsoNow(),
      unreadCount: 0,
      participant: {
        status: "active",
        lastReadSeq: 0,
        lastReadMessageId: null,
        lastReadAt: null,
        mutedUntil: null,
        archivedAt: null,
        pinnedAt: null
      },
      peerUser: null
    };
  }

  await page.route("**/api/bootstrap", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(buildBootstrapResponse())
    });
  });

  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      status: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        authenticated: true,
        username: "owner.user",
        csrfToken: "csrf-chat"
      })
    });
  });

  await page.route("**/api/chat/**", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/chat/dm/candidates" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          items: [dmCandidate]
        })
      });
      return;
    }

    if (pathname === "/api/chat/workspace/ensure" && method === "POST") {
      state.workspaceEnsureRequestCount += 1;
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          thread: buildWorkspaceRoomThreadResponse(),
          created: false
        })
      });
      return;
    }

    if (pathname === "/api/chat/dm/ensure" && method === "POST") {
      const payload = request.postDataJSON();
      if (String(payload?.targetPublicChatId || "").trim().toLowerCase() === "u42") {
        state.dmCreated = true;
      }
      state.ensureRequestCount += 1;
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          thread: buildThreadResponse(),
          created: true
        })
      });
      return;
    }

    if (pathname === "/api/chat/inbox" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          items: state.dmCreated ? [buildThreadResponse()] : [],
          nextCursor: null
        })
      });
      return;
    }

    if (/^\/api\/chat\/threads\/\d+\/messages$/.test(pathname) && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          items: [...state.messages],
          nextCursor: null
        })
      });
      return;
    }

    if (/^\/api\/chat\/threads\/\d+\/messages$/.test(pathname) && method === "POST") {
      const payload = request.postDataJSON();
      const threadSeq = state.messages.length + 1;
      const attachmentIds = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds.map((id) => Number(id)) : [];
      const attachments = attachmentIds
        .map((attachmentId) => state.attachmentById.get(Number(attachmentId)) || null)
        .filter(Boolean)
        .map((attachment, index) => ({
          ...attachment,
          status: "attached",
          messageId: state.nextMessageId,
          position: index + 1
        }));

      const message = {
        id: state.nextMessageId++,
        threadId: 88,
        threadSeq,
        senderUserId: 5,
        clientMessageId: String(payload?.clientMessageId || ""),
        kind: "text",
        text: payload?.text || "",
        replyToMessageId: null,
        attachments,
        reactions: [],
        sentAt: toIsoNow(),
        editedAt: null,
        deletedAt: null,
        metadata: {}
      };

      for (const attachment of attachments) {
        state.attachmentById.set(Number(attachment.id), attachment);
      }

      state.messages.push(message);
      state.sendRequestCount += 1;

      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          message,
          thread: buildThreadResponse(),
          idempotencyStatus: "created"
        })
      });
      return;
    }

    if (/^\/api\/chat\/threads\/\d+\/attachments\/reserve$/.test(pathname) && method === "POST") {
      const payload = request.postDataJSON();
      const attachment = {
        id: state.nextAttachmentId++,
        threadId: 88,
        messageId: null,
        uploadedByUserId: 5,
        clientAttachmentId: String(payload?.clientAttachmentId || ""),
        position: null,
        kind: "file",
        status: "reserved",
        mimeType: String(payload?.mimeType || "application/octet-stream"),
        fileName: String(payload?.fileName || "file.bin"),
        sizeBytes: Number(payload?.sizeBytes || 0),
        width: null,
        height: null,
        durationMs: null,
        deliveryPath: null,
        previewDeliveryPath: null,
        createdAt: toIsoNow(),
        updatedAt: toIsoNow()
      };
      state.attachmentById.set(Number(attachment.id), attachment);
      state.reserveRequestCount += 1;

      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          attachment
        })
      });
      return;
    }

    if (/^\/api\/chat\/threads\/\d+\/attachments\/upload$/.test(pathname) && method === "POST") {
      const attachmentEntries = Array.from(state.attachmentById.values()).sort((left, right) => Number(right.id) - Number(left.id));
      const attachment = attachmentEntries[0];
      if (attachment) {
        attachment.status = "uploaded";
        attachment.deliveryPath = `/api/chat/attachments/${attachment.id}/content`;
        attachment.updatedAt = toIsoNow();
      }
      state.uploadRequestCount += 1;

      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          attachment
        })
      });
      return;
    }

    if (/^\/api\/chat\/threads\/\d+\/attachments\/\d+$/.test(pathname) && method === "DELETE") {
      await route.fulfill({
        status: 204,
        headers: JSON_HEADERS,
        body: "null"
      });
      return;
    }

    if (/^\/api\/chat\/attachments\/\d+\/content$/.test(pathname) && method === "GET") {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/plain"
        },
        body: "hello"
      });
      return;
    }

    if (/^\/api\/chat\/threads\/\d+\/typing$/.test(pathname) && method === "POST") {
      state.typingRequestCount += 1;
      await route.fulfill({
        status: 202,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          accepted: true,
          expiresAt: new Date(Date.now() + 2000).toISOString()
        })
      });
      return;
    }

    if (/^\/api\/chat\/threads\/\d+\/read$/.test(pathname) && method === "POST") {
      const latest = state.messages[state.messages.length - 1] || null;
      await route.fulfill({
        status: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          threadId: 88,
          lastReadSeq: latest ? Number(latest.threadSeq) : 0,
          lastReadMessageId: latest ? Number(latest.id) : null
        })
      });
      return;
    }

    await route.fulfill({
      status: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: `Unhandled chat route: ${method} ${pathname}`
      })
    });
  });

  await page.goto("/admin/w/acme/chat");
  await expect.poll(() => state.workspaceEnsureRequestCount).toBe(1);
  await expect(page.getByRole("button", { name: "Start DM" })).toBeVisible();

  await page.getByRole("button", { name: "Start DM" }).click();
  await expect(page.getByText("Select a user from your shared workspaces.")).toBeVisible();
  await expect(page.getByText("Tony Mobily")).toBeVisible();
  const dmDialog = page.getByRole("dialog");
  await dmDialog.getByRole("button", { name: "Start" }).first().click();

  await expect.poll(() => state.ensureRequestCount).toBe(1);

  const composer = page.getByLabel("Message");
  await composer.fill("Hello from e2e");
  await expect.poll(() => state.typingRequestCount).toBeGreaterThan(0);

  await page.locator("input[type='file']").setInputFiles({
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello from file")
  });

  await expect.poll(() => state.reserveRequestCount).toBe(1);
  await expect.poll(() => state.uploadRequestCount).toBe(1);
  await expect(page.getByText("hello.txt")).toBeVisible();

  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => state.sendRequestCount).toBe(1);
  await expect(page.getByText("Hello from e2e", { exact: true })).toBeVisible();
});
