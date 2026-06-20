# Release Guide

This document covers everything needed to build, sign, and ship a new version of **Business Ledger App** to users via GitHub Releases and the built-in OTA updater.

---

## Prerequisites

Complete these steps once before your first release.

### 1. Generate a signing keypair

```bash
npx tauri signer generate -w ~/.tauri/laundry-cleaning.key
```

This prints two values:

| Value | What to do with it |
|---|---|
| **Public key** | Paste into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` |
| **Private key** | Add to GitHub as a repository secret (see below) |

### 2. Add GitHub repository secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The private key string printed in step 1 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you set (leave blank if skipped) |

> The public key committed to `tauri.conf.json` is safe — it cannot be used to sign anything.

---

## How releases work

Every push of a `v*` tag triggers `.github/workflows/build.yml`, which:

1. Builds the Windows installer (`.msi` + `.exe` setup)
2. Signs the installer with your private key
3. Generates `latest.json` — the manifest that running apps poll for updates
4. Creates a **draft** GitHub Release and uploads all assets

Running production builds check the endpoint below on startup and again whenever the user clicks **Check for updates** in Settings:

```
https://github.com/newbie2019-hub/laundry-cleaning/releases/latest/download/latest.json
```

---

## Shipping a new version

### Step 1 — decide the version bump

| Command | When to use | Example |
|---|---|---|
| `npm run release` | Bug fixes, minor tweaks | `1.0.0 → 1.0.1` |
| `npm run release:minor` | New features, non-breaking | `1.0.0 → 1.1.0` |
| `npm run release:major` | Breaking changes or big rewrites | `1.0.0 → 2.0.0` |

### Step 2 — run the release command

Make sure your working tree is clean (all changes committed), then:

```bash
npm run release
```

This script automatically:
- Bumps the version in `src-tauri/tauri.conf.json`
- Commits the change as `chore: release vX.X.X`
- Creates the git tag
- Pushes the commit **and** tag to `origin`, triggering GitHub Actions

### Step 3 — monitor the build

Watch the progress at:

```
https://github.com/newbie2019-hub/laundry-cleaning/actions
```

The Windows build typically takes **5–10 minutes**.

### Step 4 — publish the draft release

Once the workflow succeeds:

1. Go to **https://github.com/newbie2019-hub/laundry-cleaning/releases**
2. Open the draft release created for your tag
3. Edit the release notes if needed
4. Click **Publish release**

> Publishing the release is what makes `latest.json` publicly accessible.  
> Users will receive an update notification the next time they open the app.

---

## Version history

| Version | Date | Notes |
|---|---|---|
| v1.0.0 | — | Initial release |

> Update this table manually when you publish a release.

---

## Troubleshooting

**Build fails with "TAURI_SIGNING_PRIVATE_KEY not set"**  
→ Check that the repository secrets are saved correctly (no extra whitespace).

**Users don't see the update notification**  
→ Confirm the release is **published** (not still in draft). Draft releases are not returned by the `latest` endpoint.

**"Update check failed" shown in Settings**  
→ This is expected in development (`tauri dev`). Update checks are disabled in dev builds.

**Need to re-tag a broken release**  
→ Delete the tag and release on GitHub, fix the issue, then re-run:
```bash
git tag -d vX.X.X
git push origin :refs/tags/vX.X.X
# fix the issue, then:
npm run release
```
