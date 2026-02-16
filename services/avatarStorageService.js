import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";

function normalizePublicBasePath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "/uploads";
  }

  if (raw === "/") {
    return "/uploads";
  }

  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function encodePathSegments(pathname) {
  return String(pathname || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeStorageKey(userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw new TypeError("Avatar storage requires a positive integer user id.");
  }

  return `avatars/users/${numericUserId}/avatar.webp`;
}

function resolveFsBasePath(fsBasePath, { rootDir }) {
  const normalized = String(fsBasePath || "").trim();
  if (normalized) {
    return path.resolve(normalized);
  }

  return path.resolve(rootDir, "data", "storage");
}

function createAvatarStorageService(options = {}) {
  const driver = String(options.driver || "fs").trim().toLowerCase();
  if (driver !== "fs") {
    throw new Error(`Unsupported AVATAR_STORAGE_DRIVER \"${driver}\". Supported: fs.`);
  }

  const fsBasePath = resolveFsBasePath(options.fsBasePath, {
    rootDir: options.rootDir || process.cwd()
  });
  const publicBasePath = normalizePublicBasePath(options.publicBasePath);

  const storage = createStorage({
    driver: fsDriver({
      base: fsBasePath
    })
  });

  async function init() {
    await mkdir(fsBasePath, { recursive: true });
  }

  function toPublicUrl(storageKey, avatarVersion) {
    if (!storageKey) {
      return null;
    }

    const encodedStorageKey = encodePathSegments(storageKey);
    const urlPath = `${publicBasePath}/${encodedStorageKey}`.replace(/\/\/+/, "/");

    if (!avatarVersion) {
      return urlPath;
    }

    return `${urlPath}?v=${encodeURIComponent(String(avatarVersion))}`;
  }

  async function saveAvatar({ userId, buffer, avatarVersion }) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError("Avatar buffer must be a Buffer instance.");
    }

    const storageKey = normalizeStorageKey(userId);
    await storage.setItemRaw(storageKey, buffer);

    return {
      storageKey,
      avatarVersion: String(avatarVersion),
      publicUrl: toPublicUrl(storageKey, avatarVersion)
    };
  }

  async function deleteAvatar(storageKey) {
    if (!storageKey) {
      return;
    }

    await storage.removeItem(storageKey);
  }

  return {
    driver,
    fsBasePath,
    publicBasePath,
    init,
    toPublicUrl,
    saveAvatar,
    deleteAvatar
  };
}

const __testables = {
  normalizePublicBasePath,
  encodePathSegments,
  normalizeStorageKey,
  resolveFsBasePath
};

export { createAvatarStorageService, __testables };
