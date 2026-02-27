# Dokku Deploy Guide (No OTP Every Deploy)

This guide is for deploying a JSKIT app to Dokku when the app depends on:

- `@jskit-ai/jskit` from GitHub, and
- internal JSKIT packages referenced as `file:node_modules/@jskit-ai/jskit/packages/...`

The important part: you do **not** need to publish every internal package.
Dokku only needs to fetch one Git dependency (`@jskit-ai/jskit`) during `npm ci`.

## 1) One-time app setup on Dokku

On your Dokku host:

```bash
dokku apps:create <app-name>
dokku config:set <app-name> NODE_ENV=production
```

In your app repo:

```bash
git remote add dokku dokku@<dokku-host>:<app-name>
```

## 2) Decide auth mode from lockfile (critical)

In the app project (locally), inspect how `@jskit-ai/jskit` is resolved:

```bash
node -e 'const lock=require("./package-lock.json"); console.log(lock.packages?.["node_modules/@jskit-ai/jskit"]?.resolved)'
```

If output starts with:

- `git+ssh://git@github.com/...` -> use **Mode A (SSH deploy key)**.
- `git+https://github.com/...` -> use **Mode B (token auth)**.

Current JSKIT apps typically resolve to SSH, so Mode A is usually required.

## 3) Mode A (recommended for current lockfiles): SSH deploy key

This avoids phone OTP on every deploy.

On Dokku host:

```bash
dokku git:allow-host <app-name> github.com
dokku git:initialize <app-name>
dokku git:generate-deploy-key <app-name>
dokku git:public-key <app-name>
```

Copy the printed public key and add it in GitHub:

- Repo: `mobily-enterprises/jskit-ai`
- Settings -> Deploy keys -> Add deploy key
- Read-only is enough

Validate from Dokku host:

```bash
dokku git:can-i-fetch <app-name> git@github.com:mobily-enterprises/jskit-ai.git
```

Expected: success.

## 4) Mode B (only if lockfile resolves HTTPS): API token auth

Use this only when lockfile uses HTTPS Git URLs.

1. Create a GitHub fine-grained token with read access to `mobily-enterprises/jskit-ai`.
2. Configure Dokku app git credentials:

```bash
dokku git:auth <app-name> github.com x-access-token <GITHUB_FINE_GRAINED_TOKEN>
```

3. Verify:

```bash
dokku git:can-i-fetch <app-name> https://github.com/mobily-enterprises/jskit-ai.git
```

## 5) Deploy flow

After adding/updating bundles/packages with `jskit` locally:

```bash
npm install
git add package.json package-lock.json .jskit/lock.json
git commit -m "Update JSKIT modules"
git push dokku main
```

Dokku will run the Node build pipeline (`npm ci` style install path with lockfile).

## 6) Why package splits do not break deployment

Even if you split modules into many internal packages, deployment still works the same because:

- app dependencies are rewritten to `file:node_modules/@jskit-ai/jskit/packages/...`
- Dokku only needs to fetch `@jskit-ai/jskit` once
- internal package count can grow without changing deploy auth model

## 7) Quick troubleshooting

`Host key verification failed`:

```bash
dokku git:allow-host <app-name> github.com
dokku git:initialize <app-name>
```

`Permission denied (publickey)` when fetching `jskit-ai`:

- re-check GitHub deploy key exists and is enabled
- run `dokku git:public-key <app-name>` and compare with GitHub key
- run `dokku git:can-i-fetch <app-name> git@github.com:mobily-enterprises/jskit-ai.git`

`ENOENT ... node_modules/@jskit-ai/jskit/...` during install:

- `@jskit-ai/jskit` could not be fetched
- fix Dokku Git auth first (Mode A or B)

`404 @jskit-ai/<internal-package>`:

- app still points to npm versions for internal packages
- rerun JSKIT mutation and refresh lock:

```bash
npx jskit update --all --no-install
npm install
```

