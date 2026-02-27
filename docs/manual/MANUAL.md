# Manual App Scaffold (npx)

This is the exact flow used to scaffold a new app into an existing directory that already contains only `.git`.

## 1) Prepare target directory

```bash
mkdir -p manual-app
cd manual-app
git init
```

## 2) Scaffold into current directory

```bash
npx @jskit-ai/create-app manual-app --target .
```

Notes:
- `--template` is optional (`base-shell` is the default).
- `--initial-bundles` is optional (`none` is the default).
- A target directory containing only `.git` is treated as allowed (no `--force` required).
- If any other files/folders already exist, use `--force`.

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

Then open:

```text
http://localhost:5173
```

## 4) Install Framework Packs (real use)

From `manual-app`:

```bash
npm run jskit -- list
```

Recommended baseline:

```bash
npm run jskit -- add web-shell --no-install
npm run jskit -- add db --provider mysql --no-install
npm run jskit -- add auth-base --no-install
npm install
npm run jskit -- doctor
```

Notes:
- `db` currently adds concrete files (`knexfile.cjs`, `migrations/*`, `seeds/*`) and db scripts.
- Other packs currently contribute package/runtime dependencies and lock ownership.
