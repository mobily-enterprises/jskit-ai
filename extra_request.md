# Request For JSKIT Maintainer: Local Auth Password Strategy And Lazy Profile Projection

## Summary

Please update `@jskit-ai/auth-provider-local-core` so JSKIT local auth supports two common production migration needs:

1. A pluggable password hash/verify strategy.
2. Lazy resolution of `auth.profile.projector` so local auth can boot reliably with `users-core` and `json-rest-api-core`.

This should be fixed structurally in JSKIT, not worked around in CompAS. CompAS is a representative use case: it wants the new JSKIT local auth architecture and stock login UI, but its existing users live in a migrated database and already have secure password hashes.

## Problem 1: Password Verification Is Not Pluggable

The local auth provider already has a storage seam through `auth.local.backend`, but password hashing and verification are hard-wired inside the local auth service. That makes the backend a storage adapter only. Apps can replace where users, sessions, and recovery records are stored, but they cannot support existing password hash formats without replacing the whole auth provider.

CompAS needs to authenticate existing users from the migrated `contacts` table:

- username/email: `contacts.email`
- password hash: `contacts.password`
- hash format: bcrypt `$2a$` / `$2b$`, length 60
- V1 verifier: `bcryptjs.compare(password, record.password)`
- access gate: `contacts.remoteAccess = true` in V1, migrated as `contacts.remote_access = 1`

Users should not have to reset every password just because the app moved to JSKIT local auth.

## Requested Password API

Add a server container token:

```js
auth.local.passwordStrategy
```

The value should be an object with optional methods:

```js
{
  async hashPassword(password) {},
  async verifyPassword(password, storedPasswordRecord) {}
}
```

Expected behavior:

- if no strategy is registered, use the current scrypt behavior unchanged
- if only `verifyPassword` is provided, keep the current scrypt hasher for new passwords
- if only `hashPassword` is provided, keep the current scrypt verifier
- validate that provided methods are functions
- bind `this` to the strategy object when invoking strategy methods

The service-level API should also accept the same strategy directly:

```js
createLocalAuthService({
  backend,
  config,
  profileProjector,
  passwordStrategy
});
```

This keeps the security boundary intact:

- the backend remains storage only
- passwords are still hashed before storage
- verification still happens inside the auth service
- apps can support legacy hash formats without storing clear-text passwords
- JSKIT core does not need to add bcrypt as a dependency

Example CompAS registration:

```js
import bcrypt from "bcryptjs";
import { verifyPassword as defaultVerifyPassword } from "@jskit-ai/auth-provider-local-core/server/lib/index";

app.singleton("auth.local.passwordStrategy", () => ({
  async verifyPassword(password, record) {
    if (typeof record === "string" && /^\$2[aby]\$/.test(record)) {
      return bcrypt.compare(password, record);
    }

    return defaultVerifyPassword(password, record);
  }
}));
```

## Problem 2: Local Auth Eagerly Resolves `auth.profile.projector`

With `users-core` installed, `users-core` registers `auth.profile.projector`. That projector can resolve `users.profile.sync.service`, which resolves repositories that require `internal.json-rest-api`.

Current local auth behavior resolves `auth.profile.projector` while constructing `authService` during `auth.provider.local.boot()`. In a common app with local auth plus users-core, boot can fail before `json-rest-api.core` has booted and registered `internal.json-rest-api`.

Observed CompAS failure:

```text
ProviderLifecycleError: Provider "auth.provider.local" failed during boot().
cause: UnresolvedTokenError: Token "internal.json-rest-api" is not registered.
```

This happened because `AuthLocalServiceProvider` eagerly called:

```js
scope.make("auth.profile.projector")
```

while booting local auth.

The structural fix is to defer resolving the real projector until auth payload construction calls `syncIdentityProfile()`.

## Requested Lazy Projector Behavior

In `AuthLocalServiceProvider`, keep detecting whether `auth.profile.projector` exists at provider registration time, but pass a lazy adapter into `createLocalAuthService`:

```js
const profileProjector = scope.has("auth.profile.projector")
  ? {
      async syncIdentityProfile(profile) {
        const projector = scope.make("auth.profile.projector");
        if (!projector || typeof projector.syncIdentityProfile !== "function") {
          throw new Error("auth.profile.projector.syncIdentityProfile() must be a function.");
        }
        return projector.syncIdentityProfile(profile);
      }
    }
  : null;
```

That preserves current behavior when projection is actually needed, but avoids forcing all projector dependencies to be boot-ready during `auth.provider.local.boot()`.

## Acceptance Criteria

1. Existing local auth behavior is unchanged when no password strategy is registered.
2. `AuthLocalServiceProvider` resolves `auth.local.passwordStrategy` from the container when present.
3. `createLocalAuthService` accepts `passwordStrategy` directly for package tests and custom callers.
4. `register`, `resetPassword`, and `changePassword` use `passwordStrategy.hashPassword`.
5. `login` and `changePassword` current-password checks use `passwordStrategy.verifyPassword`.
6. The helper validates that provided strategy methods are functions.
7. Package metadata advertises the `auth.local.passwordStrategy` server container token.
8. Tests prove provider-level strategy registration.
9. Tests prove a legacy stored-password record can be verified by a custom strategy.
10. `AuthLocalServiceProvider.boot()` must not resolve `auth.profile.projector`.
11. A provider test should prove that a registered projector factory is not invoked during local-auth boot, but is invoked when login/register/session payload projection actually needs it.
12. A JSKIT app with local auth, `users-core`, and `json-rest-api-core` should boot without `Token "internal.json-rest-api" is not registered`.

## Verification Already Performed In CompAS Session

The password strategy seam was monkey-patched into `node_modules/@jskit-ai/auth-provider-local-core@0.1.2` and package tests were run:

```bash
cd node_modules/@jskit-ai/auth-provider-local-core
node --test test/providerRuntime.test.js
```

Result: all package tests passed at that point.

A CompAS-shaped smoke test was also run using V1's `bcryptjs` copy. It created a bcrypt hash, returned that hash from a fake backend user record, registered a custom `verifyPassword`, and confirmed that `createLocalAuthService(...).login(...)` returns a JSKIT session.

The lazy profile projector patch was then applied locally to:

```text
node_modules/@jskit-ai/auth-provider-local-core/src/server/providers/AuthLocalServiceProvider.js
```

After that patch, CompAS server startup succeeded:

```bash
PORT=4199 HOST=127.0.0.1 npm run server
```

and:

```bash
GET http://127.0.0.1:4199/api/health
```

returned HTTP 200.

## Proposed Diff

The diff below is against `@jskit-ai/auth-provider-local-core@0.1.2`.

```diff
diff --git a/package.descriptor.mjs b/package.descriptor.mjs
--- a/package.descriptor.mjs
+++ b/package.descriptor.mjs
@@ -47,7 +47,8 @@
       "containerTokens": {
         "server": [
           "authService",
-          "auth.local.backend"
+          "auth.local.backend",
+          "auth.local.passwordStrategy"
         ],
         "client": []
       }
diff --git a/src/server/lib/index.js b/src/server/lib/index.js
--- a/src/server/lib/index.js
+++ b/src/server/lib/index.js
@@ -1,2 +1,3 @@
 export { createLocalAuthService } from "./service.js";
 export { createLocalFileBackend } from "./fileBackend.js";
+export { hashPassword, verifyPassword, normalizePasswordStrategy } from "./passwords.js";
diff --git a/src/server/lib/passwords.js b/src/server/lib/passwords.js
--- a/src/server/lib/passwords.js
+++ b/src/server/lib/passwords.js
@@ -41,4 +41,33 @@ async function verifyPassword(password, record) {
   return expected.length === actual.length && timingSafeEqual(expected, actual);
 }
 
-export { hashPassword, verifyPassword };
+function normalizePasswordStrategy(strategy = null) {
+  if (!strategy) {
+    return Object.freeze({
+      hashPassword,
+      verifyPassword
+    });
+  }
+
+  const normalized = strategy && typeof strategy === "object" ? strategy : {};
+  const strategyHashPassword = normalized.hashPassword || hashPassword;
+  const strategyVerifyPassword = normalized.verifyPassword || verifyPassword;
+
+  if (typeof strategyHashPassword !== "function") {
+    throw new TypeError("Local auth password strategy hashPassword must be a function.");
+  }
+  if (typeof strategyVerifyPassword !== "function") {
+    throw new TypeError("Local auth password strategy verifyPassword must be a function.");
+  }
+
+  return Object.freeze({
+    async hashPassword(password) {
+      return strategyHashPassword.call(strategy, password);
+    },
+    async verifyPassword(password, record) {
+      return strategyVerifyPassword.call(strategy, password, record);
+    }
+  });
+}
+
+export { hashPassword, verifyPassword, normalizePasswordStrategy };
diff --git a/src/server/lib/service.js b/src/server/lib/service.js
--- a/src/server/lib/service.js
+++ b/src/server/lib/service.js
@@ -8,7 +8,7 @@
 import { normalizeAuthActor, normalizeAuthResult } from "@jskit-ai/auth-core/server/authActor";
 import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
 import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
-import { hashPassword, verifyPassword } from "./passwords.js";
+import { normalizePasswordStrategy } from "./passwords.js";
 import { randomToken, sha256Base64url, signToken, verifySignedToken } from "./tokens.js";
 
 const ACCESS_TOKEN_COOKIE = "jskit_local_access_token";
@@ -191,7 +191,7 @@ function createRecoveryDelivery({ config }) {
   });
 }
 
-function createLocalAuthService({ backend, config, profileProjector = null }) {
+function createLocalAuthService({ backend, config, profileProjector = null, passwordStrategy = null }) {
   if (!backend || typeof backend.withTransaction !== "function") {
     throw new Error("Local auth requires auth.local.backend with withTransaction().");
   }
@@ -199,6 +199,7 @@ function createLocalAuthService({ backend, config, profileProjector = null }) {
     throw new Error("Local auth requires a session secret.");
   }
 
+  const passwords = normalizePasswordStrategy(passwordStrategy);
   const isProduction = config.nodeEnv === "production";
   const profileProjectionEnabled = typeof profileProjector?.syncIdentityProfile === "function";
   const recoveryDelivery = config.smtpConfigured
@@ -284,7 +285,7 @@ function createLocalAuthService({ backend, config, profileProjector = null }) {
     const email = validateEmailInput(input.email);
     validatePasswordInput(input.password);
     const displayName = normalizeDisplayName(input.displayName, email);
-    const password = await hashPassword(input.password);
+    const password = await passwords.hashPassword(input.password);
     const result = await backend.withTransaction(async (tx) => {
       const existing = await tx.users.findByEmail(email);
       if (existing) {
@@ -312,7 +313,7 @@ function createLocalAuthService({ backend, config, profileProjector = null }) {
     const password = String(input.password || "");
     return backend.withTransaction(async (tx) => {
       const user = await tx.users.findByEmail(email);
-      if (!user || user.disabled || !(await verifyPassword(password, user.password))) {
+      if (!user || user.disabled || !(await passwords.verifyPassword(password, user.password))) {
         throw new AppError(401, "Invalid email or password.");
       }
       const session = await createSessionForUser(tx, user);
@@ -517,7 +518,7 @@ function createLocalAuthService({ backend, config, profileProjector = null }) {
     if (!payload?.sub || !payload?.sid) {
       throw new AppError(401, "Authentication required.");
     }
-    const password = await hashPassword(input.password);
+    const password = await passwords.hashPassword(input.password);
     await backend.withTransaction(async (tx) => {
       const session = await tx.sessions.findById(String(payload.sid));
       if (!session || session.revokedAt || isExpiredIso(session.expiresAt)) {
@@ -546,13 +547,13 @@ function createLocalAuthService({ backend, config, profileProjector = null }) {
     }
 
     const currentPassword = String(input.currentPassword || "");
-    const password = await hashPassword(input.newPassword);
+    const password = await passwords.hashPassword(input.newPassword);
     await backend.withTransaction(async (tx) => {
       const user = await tx.users.findById(authResult.actor.providerUserId);
       if (!user || user.disabled) {
         throw new AppError(401, "Authentication required.");
       }
-      if (!(await verifyPassword(currentPassword, user.password))) {
+      if (!(await passwords.verifyPassword(currentPassword, user.password))) {
         throw new AppError(401, "Current password is invalid.");
       }
       await tx.users.updatePassword(user.id, password);
diff --git a/src/server/providers/AuthLocalServiceProvider.js b/src/server/providers/AuthLocalServiceProvider.js
--- a/src/server/providers/AuthLocalServiceProvider.js
+++ b/src/server/providers/AuthLocalServiceProvider.js
@@ -172,14 +172,26 @@ class AuthLocalServiceProvider {
     app.singleton("authService", (scope) => {
       const config = resolveConfig(scope);
       const backend = scope.make("auth.local.backend");
       const profileProjector = scope.has("auth.profile.projector")
-        ? scope.make("auth.profile.projector")
+        ? {
+            async syncIdentityProfile(profile) {
+              const projector = scope.make("auth.profile.projector");
+              if (!projector || typeof projector.syncIdentityProfile !== "function") {
+                throw new Error("auth.profile.projector.syncIdentityProfile() must be a function.");
+              }
+              return projector.syncIdentityProfile(profile);
+            }
+          }
         : null;
+      const passwordStrategy = scope.has("auth.local.passwordStrategy")
+        ? scope.make("auth.local.passwordStrategy")
+        : null;
       return createLocalAuthService({
         backend,
         config,
-        profileProjector
+        profileProjector,
+        passwordStrategy
       });
     });
   }
diff --git a/test/providerRuntime.test.js b/test/providerRuntime.test.js
--- a/test/providerRuntime.test.js
+++ b/test/providerRuntime.test.js
@@ -46,7 +46,7 @@ function createAppConfigFixture() {
   };
 }
 
-async function createStartedApp({ profileProjector = null } = {}) {
+async function createStartedApp({ profileProjector = null, passwordStrategy = null } = {}) {
   const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-auth-local-"));
   const app = createApplication();
   app.instance("appConfig", createAppConfigFixture());
@@ -69,6 +69,9 @@ async function createStartedApp({ profileProjector = null } = {}) {
   if (profileProjector) {
     app.instance("auth.profile.projector", profileProjector);
   }
+  if (passwordStrategy) {
+    app.instance("auth.local.passwordStrategy", passwordStrategy);
+  }
   await app.start({
     providers: [
       ActionRuntimeServiceProvider,
@@ -134,6 +137,37 @@ test("local auth provider registers a new user with a hashed password", async () => {
   assert.match(usersFile, /^user:v1:/);
 });
 
+test("local auth provider resolves a custom password strategy from the container", async () => {
+  const passwordStrategy = {
+    async hashPassword(password) {
+      return {
+        algorithm: "test-password",
+        version: "v1",
+        salt: "",
+        hash: `hashed-${password}`
+      };
+    },
+    async verifyPassword(password, record) {
+      return record?.algorithm === "test-password" && record?.hash === `hashed-${password}`;
+    }
+  };
+  const { app } = await createStartedApp({ passwordStrategy });
+  const authService = app.make("authService");
+
+  await authService.register({
+    email: "strategy@example.com",
+    password: "strategy password value",
+    displayName: "Strategy User"
+  });
+
+  const loggedIn = await authService.login({
+    email: "strategy@example.com",
+    password: "strategy password value"
+  });
+
+  assert.equal(loggedIn.actor.email, "strategy@example.com");
+});
+
+test("local auth provider defers profile projector resolution until projection is needed", async () => {
+  let projectorResolved = 0;
+  const profileProjector = {
+    async syncIdentityProfile(profile) {
+      return {
+        ...profile,
+        id: "app-profile-id"
+      };
+    }
+  };
+  const { app } = await createStartedApp({
+    profileProjector: {
+      async syncIdentityProfile(profile) {
+        projectorResolved += 1;
+        return profileProjector.syncIdentityProfile(profile);
+      }
+    }
+  });
+
+  assert.equal(projectorResolved, 0);
+
+  const authService = app.make("authService");
+  const registered = await authService.register({
+    email: "projector@example.com",
+    password: "projector password value",
+    displayName: "Projector User"
+  });
+
+  assert.equal(projectorResolved, 1);
+  assert.equal(registered.actor.appUserId, "app-profile-id");
+});
+
 test("local auth login verifies password and creates session in one backend transaction", async () => {
   const password = await hashPassword("current password value");
   let transactions = 0;
@@ -190,6 +224,102 @@ test("local auth login verifies password and creates session in one backend tran
   assert.equal(transactions, 1);
 });
 
+test("local auth service accepts a custom strategy for legacy stored password records", async () => {
+  const usersByEmail = new Map([
+    [
+      "legacy@example.com",
+      {
+        id: "usr_legacy",
+        email: "legacy@example.com",
+        displayName: "Legacy User",
+        password: {
+          algorithm: "legacy-bcrypt",
+          hash: "legacy password value"
+        },
+        disabled: false
+      }
+    ]
+  ]);
+  const sessions = [];
+  const backend = {
+    async withTransaction(callback) {
+      const tx = {
+        users: {
+          async findByEmail(email) {
+            return usersByEmail.get(email) || null;
+          },
+          async create(input) {
+            const user = {
+              ...input,
+              disabled: false
+            };
+            usersByEmail.set(user.email, user);
+            return user;
+          }
+        },
+        sessions: {
+          async create(input) {
+            const session = {
+              ...input,
+              createdAt: new Date().toISOString(),
+              revokedAt: ""
+            };
+            sessions.push(session);
+            return session;
+          }
+        }
+      };
+      return callback(tx);
+    }
+  };
+  const passwordStrategy = {
+    async hashPassword(password) {
+      return {
+        algorithm: "test-scrypt",
+        version: "v1",
+        salt: "test",
+        hash: `hashed-${password}`
+      };
+    },
+    async verifyPassword(password, record) {
+      if (record?.algorithm === "legacy-bcrypt") {
+        return record.hash === password;
+      }
+      return record?.algorithm === "test-scrypt" && record.hash === `hashed-${password}`;
+    }
+  };
+  const authService = createLocalAuthService({
+    backend,
+    passwordStrategy,
+    config: {
+      nodeEnv: "test",
+      sessionSecret: "test-secret",
+      appPublicUrl: "http://localhost:5173",
+      smtpConfigured: false,
+      recoveryDevOutput: "disabled"
+    }
+  });
+
+  const legacyLogin = await authService.login({
+    email: "legacy@example.com",
+    password: "legacy password value"
+  });
+  assert.equal(legacyLogin.actor.email, "legacy@example.com");
+
+  await authService.register({
+    email: "new-strategy@example.com",
+    password: "new password value",
+    displayName: "New Strategy"
+  });
+  assert.deepEqual(usersByEmail.get("new-strategy@example.com").password, {
+    algorithm: "test-scrypt",
+    version: "v1",
+    salt: "test",
+    hash: "hashed-new password value"
+  });
+  assert.equal(sessions.length, 2);
+});
+
 test("local auth provider completes recovery through a recovery-scoped session", async () => {
   const { app } = await createStartedApp();
   const authService = app.make("authService");
```

## Notes For Reviewer

- This is not a CompAS-only customization. Local auth plus users-core is a normal JSKIT app shape.
- The lazy projector adapter avoids resolving users/json-rest dependencies during local auth boot while preserving projection behavior at auth-payload time.
- The password strategy methods are intentionally called with `this` bound to the strategy object, so implementers may keep shared helpers/state on the object.
- This does not change the local auth backend contract.
- This does not require apps to store clear-text passwords.
- This does not force bcrypt into JSKIT core. It only allows apps to provide their own verifier.
- If the maintainer prefers a stronger name, `auth.local.passwordStrategy` could be renamed to `auth.local.passwords` or `auth.local.passwordHasher`, but the two-method shape should remain.

