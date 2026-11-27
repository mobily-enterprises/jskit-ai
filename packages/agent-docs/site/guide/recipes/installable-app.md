---
title: "Recipe: an app people install from its website"
description: Make a JSKIT app installable from its own website on Android, iPhone, iPad and computers, with push notifications, an unread count on its icon and sharing in, and no app store.
---

# Make `<APP_NAME>` an app people install from its website: no app stores, real notifications, sharing in

Turn this JSKIT app into an installable web app (PWA) on Android, iPhone/iPad
and desktop. It opens from its own icon, full screen, starts instantly, works
gracefully offline, sends push notifications even when closed, shows an unread
count on its icon, and (on Android and desktop) accepts photos, files and links
shared from other apps. Payments, if any, stay exactly as they are today.

## When to propose it

- "Make it an app", "put it on my phone", "an icon on the home screen", "can
  people install it?", "we need a mobile app".
- "Send notifications", "tell people when something happens even when the app
  is closed", "a badge with the unread count".
- "Share a photo from my gallery into the app".

## How to answer the person

Propose the simple way first: people install `<APP_NAME>` from its own
website. On Android and computers the browser offers **Install**; on iPhone and
iPad they add it to the Home Screen once. It gets its own icon and window,
notifications (on iPhone and iPad once it is on the Home Screen), an unread
count on the icon, and sharing in from other apps (Android and computers). There
is no store account, review or fee, every release reaches everyone at once, and
it is the same app the website already is.

Then say: "There are other options if you want to discuss." The other option is
a native app in the stores, built with Capacitor: the host's `## Packaging`
section builds the Android shell where the host packages phone apps itself,
otherwise the app owns its Android project as
[Mobile Capacitor](/guide/app-extras/mobile-capacitor) shows. It needs store
developer accounts, store listings, review and signing keys, and it is worth it
when the person needs a store presence or a capability only a native shell has.
The installable app is usually the first step either way.

## Product decisions (defaults)

Use these unless one clearly doesn't fit this app; ask only then.

- Notifications are on for all three kinds once someone allows them, with a
  switch per kind: **results** (background work finished), **waiting** (the
  app needs the person's answer or approval), **messages** (a direct message, a
  mention, a message in a chat that concerns them). Message text is shown
  unless switched off. Quiet hours are off by default. An app without one of
  these kinds leaves it out.
- A notification waits **15 seconds** and is sent only if the message is still
  unread then, so nothing pops up for a chat the person is reading.
- Real pushes leave **only when `APP_ENV=production`**; development, test and
  staging log each one with `logSideEffect`
  ([Environments](/guide/framework/environments#the-application-s-own-side-effects)).
  A **Send a test notification** button shows one on the device itself,
  everywhere.
- Permission is never asked on first visit: only from Settings, or from a
  one-time offer right after the person sets up their first piece of
  background work ("Get a notification when it runs?" **Turn on** /
  **Not now**).

## Make a careful saved plan first

Write a careful saved plan first (this checklist and very detailed Technical
details), then implement it item by item, proving each one. Before writing
anything, map this app's own equivalents of the concepts below: what a "chat"
or "conversation" is, how unread is tracked, how mute works, what background
work produces results (routines, jobs, watches), what "waiting for the person"
means (approvals, questions), who a message concerns, and where Settings
lives. Use the app's existing owners, seams and patterns for each; never build
a parallel system. Read JSKIT's
[Typed features](/guide/framework/typed-features),
[Client features](/guide/framework/client-features),
[Data access](/guide/framework/data-access) and
[Material 3](/guide/framework/material-3) guides before writing server,
client, data or UI code.

Each item is proven before it is ticked:

1. Installable: web-app manifest, icons (any, maskable for Android's adaptive
   shape, 180px apple-touch-icon, monochrome badge), light and dark theme
   colours, a standalone window that focuses the one already open, 3 app
   shortcuts to the app's most useful places, store-style screenshots for
   Android's install sheet.
2. Service worker: instant start, a friendly "You're offline" page instead of
   the browser's error, never caches anything private or the API, a new
   release takes over cleanly.
3. Installing is offered where it helps: **Install app** in the account menu
   (only when installing is possible), a one-time banner on phones, an
   iPhone/iPad guide (Share → Add to Home Screen), nothing once installed.
4. Feels native: safe areas around notches and home bars, status bar coloured
   to match the theme, no stray pull-to-refresh or double-tap zoom, outside
   links open in the browser, every sign-in method works inside the installed
   app.
5. Push notifications for the three kinds; each opens the right chat; one
   notification per chat (newer replaces older); the icon shows the unread
   count.
6. Settings: allow on this device, a switch per kind, show or hide message
   text, quiet hours, the person's devices (each removable), **Send a test
   notification**. Muted chats never notify.
7. Permission asked at a sensible moment with a clear explanation; a refusal
   is handled kindly (how to re-allow in browser or phone settings); an iPhone
   outside the Home Screen app is told to add it first, with the guide.
8. Sharing in (Android and desktop): share a photo, file or link from another
   app, pick a chat, and it arrives attached in that chat's message box.
9. The website's "get the mobile app" places (if any) become one real install
   page for the person's device; store placeholders go; old addresses
   redirect; help pages explain installing, notifications and sharing.
10. Proven: server tests, client tests, browser tests and preview checks as
    Proof describes.

After the plan, where the project runs Genesis passes, run the Review,
Security pass, Data pass, Quality pass and Deslop, each on this plan's
changes.

## Technical details

JSKIT has no installable-app, service-worker or push package. Everything below
that this page does not name as JSKIT's is the app's own code, built on the
JSKIT owners it links.

### 1. Manifest and icons

- Draw the icons from the app's logo (`src/components/BrandLogo.vue` and
  `favicon.svg`, as [Visual identity](/guide/framework/visual-identity) places
  them) and commit them as files in Vite's `public/` folder, which the build
  copies to `dist/` unchanged: 192 and 512 `any`, 512 `maskable` (the logo
  inside the 80% safe zone on the brand colour), 180 `apple-touch-icon`, 96
  monochrome badge. ImageMagick renders them from the SVG.
- `public/manifest.webmanifest`: `id: "/"`, `start_url` and `scope` `/`,
  name and short_name, `display: "standalone"`,
  `launch_handler.client_mode: "focus-existing"`, background and theme colours
  matching the startup shell in `index.html`, shortcuts, `share_target`
  (section 6) and committed phone and desktop screenshots. An app served under
  a sub-path puts that path in every URL the manifest holds.
- Each shortcut opens an in-app page address. Signed out, the route's auth
  guard sends the person to sign in with that page as `returnTo`, so they land
  where the shortcut points. An action with no page of its own gets one, or a
  query parameter its page reads once and removes.
- `index.html`: the manifest link, the apple-touch-icon,
  `apple-mobile-web-app-capable`, a `black-translucent` status bar, light and
  dark `theme-color` and `viewport-fit=cover` on the viewport. The status bar
  colour follows the chosen theme at runtime.
- The foundation's `server.js` already lists `/manifest.webmanifest` in
  `STATIC_GLOBAL_UI_PATHS`; add `/sw.js`, `/offline.html` and the icons' paths
  there too.

### 2. Service worker (`/sw.js`, scope `/`, `Service-Worker-Allowed: /`)

- JSKIT installs no service worker; this one is the app's own, written by hand
  in `public/sw.js`, and follows the rules in
  [Development modules and service-worker caching](/guide/app-setup/initial-scaffolding#development-modules-and-service-worker-caching).
  Register it only from a production build. The server sends `/sw.js` with
  `Service-Worker-Allowed: /` and without long caching.
- Navigations go network first, falling back to a cached `offline.html` drawn
  like the startup shell ("You're offline. `<APP_NAME>` will reconnect by
  itself.", **Try again**). Back online, the page's first loads can still fail,
  because the page's network and the worker's come back a moment apart. So the
  offline page keeps retrying the page it stands in for, one attempt at a time,
  waiting 1 s and doubling to 30 s, and reloads once it answers. **Try again**
  tries at once in that same loop. Its own script and icon come from the
  worker's cache.
- Only content-hashed build assets (`/assets/`) are cache first; old builds'
  caches are deleted on activate. **Never** touch the API (`/api/`), event
  streams and sockets, uploads, public or anonymous pages, or any admin or
  console surface, and never let those fall back to the offline page. JSKIT
  already answers every API request with `Cache-Control: no-store`
  (`config.securityHeaders.apiCacheControl`).
- `skipWaiting()` and `clients.claim()`. Where `@jskit-ai/realtime` is
  installed, JSKIT's own client update offer still asks the person to reload
  when a new build is served
  ([Client updates](/guide/app-extras/realtime#client-updates)).
- A notification click may open **only the app's own pages**, never another
  site or scheme.
- Browser tests that intercept scripts with `page.route` run with Playwright's
  `test.use({ serviceWorkers: "block" })`, because the worker answers built
  files itself.

### 3. Installing (client)

- The app's own install composable (`useInstall()`) keeps
  `beforeinstallprompt` from the moment it fires, knows when the app is
  installed (`display-mode: standalone`, `navigator.standalone`) and when it
  runs in iPhone or iPad Safari. The event fires once per page, before any
  component may exist, so its state is shared: a client provider provides it,
  or one module-level ref with a `shared resource:` allow comment holds it
  ([Client providers](/guide/framework/client-features#client-providers),
  [Module state](/guide/framework/client-features#module-state)). The window
  probes go through the package's one `hasWindowFunction()` helper
  ([Platform probes](/guide/framework/client-features#platform-probes)), and
  its listeners are released
  ([Released listeners](/guide/framework/client-features#released-listeners)).
- **Install app** is a link in the account menu, the `auth.profile-menu`
  placement, shown only while installing is possible.
- The phone offer is JSKIT's snackbar:
  `useShellWebErrorRuntime().report({ ..., action, additionalActions })`
  from `@jskit-ai/shell-web/client/error`, which `@jskit-ai/material-web`
  draws on `inverse-surface` with `inverse-primary` actions. Never restyle it;
  a banner of the app's own uses those same roles, or **Not now** becomes
  unreadable. Check light and dark.
- The phone offer comes once, a few seconds in, and **Not now** is remembered
  per device.

### 4. Native feel

- `env(safe-area-inset-*)` on the top bar, composer, drawers and dialogs (zero
  off a phone); `overscroll-behavior` on the shell;
  `touch-action: manipulation`; text inputs at least 16px on iPhone so Safari
  doesn't zoom.
- Every custom switch or toggle needs its own visible `:focus-visible` ring
  (2px solid, a theme role). The browser's default is near-invisible on dark
  schemes.
- In standalone mode, links outside the app's origin open in the browser
  (`leaveApp(url)` from `@jskit-ai/shell-web/client` leaves for another site).
  Signed out, the installed app opens on sign-in; a browser tab still shows the
  front page.

### 5. Push notifications (server)

- **Keys:** derive the VAPID P-256 key pair from one generated secret
  (`PUSH_SECRET`, named as the app's other settings are) with HKDF, so every
  server agrees and there is no manual key setup. Read it from the
  `runtime.env` capability, never a request
  ([Environment from the caller](/guide/framework/typed-features#environment-from-the-caller)).
  Name it in the project's environment contract and `.env.example` without a
  value; in a Genesis project add it to the Deployment's `Generated secrets`
  beside `AUTH_LOCAL_SESSION_SECRET`, so every deployment has its own, and give
  development a value of its own. Without it, push is off and Settings says
  so. Use `web-push`, pinned.
- **Tables:** one table resource each (`defineTableResource`), owned by one
  feature, created by an add-only Knex migration
  ([Data access, Layer 1](/guide/framework/data-access#layer-1-the-table-resource)).
  Ownership `user` (`workspace_user` where the app has workspaces) keeps each
  person to their own rows on every statement. In a Genesis project, put each
  table in its owning package's subsystem.
  - `push_devices`: user, endpoint (unique), p256dh, auth, label, created and
    last sent, failures. At most 20 a person, the oldest going.
  - `push_settings`: user, per-kind switches, show_text, quiet_from and
    quiet_to, time_zone. One row a person who changed theirs.
  - `push_queue`: workspace (or the scope unread is counted in), user, chat,
    kind, message, send_after, claimed_at.
- **Queueing:** beside the code that marks messages unread, insert one queue
  row per person the message concerns: the other person in a one-person or
  direct chat, the mentioned people and the person the background work was for
  in a room, never the author, never anyone who muted the chat. One
  `createMany(rows, options)` per write, not one insert per person.
- **Sweep:** a feature with a `systemScope` whose `boot()` starts the timer
  (`setInterval(runOnce, 5000).unref()`) and whose `shutdown()` stops it and
  awaits a run in progress; tests call `runOnce()` itself. JSKIT ships no
  scheduler ([Owned state](/guide/framework/typed-features#owned-state)).
  Every web server runs the timer and takes due rows with
  `claim({ filters, sort, take }, txOptions)`, which skips rows another server
  holds ([Layer 4: locks](/guide/framework/data-access#layer-4-locks)), batch
  after batch until a batch comes back short (at most about 20 batches): one
  batch of 100 a tick falls minutes behind a burst of 250. Per row: skip it if
  read, in quiet hours (across midnight, in the person's time zone) or that
  kind is off. Fold a person's rows for one chat into one notification about
  the newest message at the most pressing kind. Claim exact (person, chat)
  pairs, never a capped cross-product narrowed in code
  ([Narrow in the query](/guide/framework/data-access#narrow-in-the-query)).
- **Queue rows carry their workspace id** to the sweep. A sweep that reads it
  as `undefined` sends nothing at all, and a test stand-in that reads ids
  differently from the real table resource hides it: test on the real handle on
  `TEST_DB_NAME`
  ([Doubles use documented seams](/guide/framework/typed-features#doubles-use-documented-seams)).
- A direct message's title is **the other person's** name, both ways round;
  test it with both orders of the two people's ids.
- Payload: chat title, kind, short text (or "New message" when text is
  hidden), the chat's URL, the unread count (counted per person **and
  workspace**, matching what the open app shows), tag `chat-<id>` with
  `renotify`.
- Sending: 10 devices at a time, a few statements per batch whatever the
  number of devices. A 404 or 410 forgets the device, and so do 5 consecutive
  failures. Outside production, `logSideEffect()` with
  `kind: "push notification"` replaces the send.
- **Security, all required:**
  - A device's endpoint must be a known push service (FCM, Mozilla, Apple,
    WNS) on its default port with no credentials, because the server POSTs
    there. Refuse anything else with 400 (localhost, metadata IPs and internal
    hosts must all be refused). An address stored before the check is never
    called and is forgotten at the next send.
  - Re-posting another person's endpoint moves the device only with that
    device's own keys (the same browser). Otherwise 409.
  - Non-object bodies give 400, not a 500: the kernel's body validation already
    answers a body that is not a JSON object with 400
    ([Routes](/guide/framework/typed-features#routes)); keep it. Device labels
    are one line, with no control characters.
  - **Sign-out forgets this browser's device:** a signed-in
    `POST /api/push/devices/forget { endpoint }` (a locked delete by address
    and person), then unsubscribe in the browser, waiting at most 3 s.
    Otherwise the next person on a shared browser gets the last person's
    notifications. JSKIT has no step before sign-out: the app's own
    `src/views/auth/SignOutView.vue` (from the
    [auth surface pattern](/patterns/auth/auth-surface)) runs both steps first
    and renders `DefaultSignOutView`, which signs out as it mounts, only after
    them. While they run it shows a pending card ("Signing you out"); offline
    it says so and **Try again** retries both steps.
- **Routes**, `auth: "required"`, each running an action on the caller's own
  rows: get settings, devices and the public key; put settings; add device;
  delete device; forget device. Test them through `app.inject` signed out
  (401), without CSRF (403), as another member (404) and with malformed input
  (400) ([Security pass](/guide/framework/security-pass#try-each-refusal)).

### 6. Sharing in

- Manifest `share_target`: `action: "/share"`, POST, multipart `title`,
  `text`, `url`, `files`. The worker keeps them in Cache Storage under a
  one-time key for an hour and redirects (303) to the app's share page,
  `/share?key=<key>`.
- The share page opens the app's existing picker for where it goes (the chat
  picker) and puts text and files into that chat's message box through the
  existing upload path; over-limit files get the upload's own refusal. The
  share goes **only** into the chosen chat. If that chat doesn't open within
  about 2 s, the picker comes back saying "That chat didn't open. Choose it
  again." A share that's gone says "What you shared is no longer here. Share
  it again from the other app." Delete the cache entry once used.

### 7. Settings and permission (client)

- A **Notifications** group in the account settings, in the
  [account settings pattern](/patterns/users/account-settings)'s notifications
  section or a section of the app's own (an `account-settings:sections`
  placement at `/account/<section>`), with Material skeleton rows in the card's
  shape and `aria-busy` while it loads (not "Loading…" that jumps to nine
  rows), and **Try again** on failure.
- `Notification.requestPermission()` only from those controls or the one-time
  offer. Explain a refusal. When the server's push secret changed, replace the
  browser's old subscription instead of reusing it. When the push service
  doesn't answer, say why, in the same words in both places.
- Text comes through `useJskitText()` and the app's message keys
  ([Translation](/guide/framework/translation)).

### 8. Website and help

- One install page with the right steps per device (**Install** where the
  browser offers it); old store addresses redirect to it. Read the headers on
  a production build: JSKIT's content security policy
  ([Security headers](/guide/app-setup/initial-scaffolding#security-headers))
  already allows a same-origin worker (`worker-src 'self' blob:`) and manifest
  (`default-src 'self'`). A directive set in
  `config.securityHeaders.contentSecurityPolicy.directives` replaces JSKIT's
  sources for that directive, so keep `'self'` there.
- Help: a "`<APP_NAME>` on your phone" page (install on Android, iPhone and
  computers; notifications; sharing), the notifications section of Settings,
  and remove any line saying the app sends no notifications. In a Genesis
  project, record a decision for this work and update the Blueprint, the
  Program pages and `genesis/subsystems.md`.

## Proof

Prove each behaviour at the cheapest level that shows it, browser tests only
for what needs a browser, never against development data and never against a
real push service. Each fix is seen failing first.

- **Server tests** (`jskit test`, on `TEST_DB_NAME`): own rows only; folding
  per chat; the 15-second read check; quiet hours across midnight in the
  person's zone; muted chats; kinds switched off; 410 forgets a device;
  production-only sending (a stubbed `web-push`, `APP_ENV: "production"`);
  the endpoint allow-list and device takeover refusals; sign-out forget; the
  direct-message title both ways round. Query counts must be **equal** at two
  sizes with `expectFlatQueries()` from `@jskit-ai/resource-runtime/test`
  (a sweep batch at 150 and 10,000 waiting rows, 3 and 30 devices, 5 and 41
  recipients), not a fixed ceiling; read the sweep's plans with `EXPLAIN`
  ([Data pass](/guide/framework/data-pass#tests-at-realistic-sizes)).
- **Client tests** (Vitest): install state, share handling (gone, chosen,
  chat didn't open), the sign-out sequence, settings loading.
- **Browser tests** (`npm run test:e2e`, `browserTestConfig()`): manifest and
  icons, worker and offline page, Install with a synthetic
  `beforeinstallprompt`, the iPhone guide, Settings with permission granted and
  denied, the test notification, a notification click, sharing a file, the
  switch focus ring (solid 2px). Stub `PushManager`, since headless Chromium
  has no push service.
- **Preview:** 390 and 1280 px, light and dark, emulated standalone, on the
  test database; walk every state above.

## Leftovers for the person

- Real installs on their own phones: notches, Safari's text-box zoom, every
  sign-in method inside the installed app.
- Real pushes, after a production release.
