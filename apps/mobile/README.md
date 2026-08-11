# Sidequestd Mobile

Expo (React Native) client for iOS and Android.

```bash
npm install     # run from this directory, not the repo root
npm run start   # then press i / a, or scan the QR code
```

## Why this app is outside the npm workspace

The repo root uses npm workspaces for `apps/web` and `packages/*`. Metro, Expo's
bundler, resolves modules from the package directory rather than by walking up to
a hoisted root `node_modules`, so a workspace-hoisted install leads to duplicate
React copies and missing-module errors. Keeping this app out of the workspace and
depending on `@sidequestd/api-types` through a `file:` path avoids that entirely.

## Status

Scaffold only. Auth screens land after the web slice is reviewed; the API base
URL and shared types are wired now so there is nothing to retrofit.

When those screens arrive they should store the refresh token in
`expo-secure-store`, not `AsyncStorage` — the web client's httpOnly cookie has no
native equivalent, and the token must not sit in plaintext app storage.
