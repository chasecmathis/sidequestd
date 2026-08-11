import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// Where uploaded media is read from — the API's S3_PUBLIC_URL_BASE, seen from
// the browser. next/image refuses any host that is not allow-listed below, and
// the list is baked into the build, so this has to be known at build time and
// cannot be a runtime environment variable. Deploy-specific, hence a build arg
// rather than a literal: see apps/web/Dockerfile and DEPLOY.md §7.
function mediaRemotePatterns(rawUrl: string | undefined) {
  if (!rawUrl) return [];
  const { protocol, hostname, port, pathname } = new URL(rawUrl);
  return [
    {
      protocol: protocol.replace(":", "") as "http" | "https",
      hostname,
      port,
      pathname: `${pathname.replace(/\/$/, "")}/**`,
    },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit `.next/standalone`: a server plus only the files it was traced to
  // need, which is what apps/web/Dockerfile ships. Build-only — `next dev` is
  // unaffected.
  output: "standalone",
  // Tracing starts at the repo root, not apps/web: this is an npm workspace, so
  // react, next and @sidequestd/api-types all resolve to the hoisted
  // node_modules two levels up and would otherwise be left out.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // The API is a separate origin in development; the browser talks to it
  // directly with credentials, which the API's CORS config allows.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  },
  images: {
    // Cover art comes from the games catalog, which mirrors IGDB (SPEC §2).
    // Allow-listed rather than unoptimized so next/image can still resize it.
    remotePatterns: [
      { protocol: "https", hostname: "images.igdb.com" },
      // Avatars, served straight from the local MinIO bucket in development.
      {
        protocol: "http",
        hostname: "localhost",
        port: "9000",
        pathname: "/sidequestd-media/**",
      },
      // …and from the CDN or bucket in front of it everywhere else.
      ...mediaRemotePatterns(process.env.NEXT_PUBLIC_MEDIA_URL),
    ],
  },
};

export default nextConfig;
