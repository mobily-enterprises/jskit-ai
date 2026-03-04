# 001 - Create An App

## 0) Developers only (ignore for now)

```bash
~/Development/current/jskit-ai/tooling/create-app/templates/base-shell/scripts/verdaccio-reset-and-publish-packages.sh
mkdir -p manual-app
cd manual-app
npx @jskit-ai/create-app manual-app --target .
npm install
npx jskit add package @jskit-ai/auth-provider-supabase-core --no-install
npx jskit add bundle auth-base --no-install
npm install
scripts/link-local-jskit-packages.sh
cp ~/Development/DOTENV_DEV ./.env
```

## 1) Prepare target directory

```bash
mkdir -p manual-app
cd manual-app
```

## 2) Scaffold into current directory

```bash
npx @jskit-ai/create-app manual-app --target .
```

Notes:
- Do **not** run `npm init` before scaffolding; `create-app` writes the app `package.json`.
- `--template` is optional (`base-shell` is the default).
- `--initial-bundles` is optional (`none` is the default).
- If target contains only `.git`, it is allowed.
- If target contains other files, use `--force`.

## 3) Install and run

```bash
npm install
```


Terminal 1:

```bash
npm run dev
```

Terminal 2:

```bash
npm run server
```

Open:

```text
http://localhost:5173/app
http://localhost:5173/admin
http://localhost:5173/console
```

Expected:
- Pages render from filesystem routing (`src/pages`).
- `GET /api/v1/health` returns `404` until runtime routes are installed via JSKIT modules.


## 4 Extra packages

npx jskit add package @jskit-ai/auth-provider-supabase-core --no-install
npx jskit add bundle auth-base --no-install
npm install
