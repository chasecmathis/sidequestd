/**
 * `GET /.well-known/apple-app-site-association` — see `@/lib/app-links`.
 *
 * No extension on the path, which is Apple's requirement and the reason this is
 * a route handler rather than a file in `public/`: a static server picks the
 * content type off the extension, and there is none to pick from. Apple wants
 * `application/json`, which `Response.json` sets.
 */
import { appleAppSiteAssociation } from "@/lib/app-links";

/**
 * Read the environment on each request, not at build.
 *
 * `APPLE_TEAM_ID` is a server-side value, so unlike `NEXT_PUBLIC_API_URL` — which
 * `next.config.ts` documents as build-time because Next inlines it into the
 * client bundle — this one can be set and picked up on a restart. Without this
 * export Next would evaluate the handler once during the build and bake in
 * whatever the build environment had, which for a Docker build is nothing.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const payload = appleAppSiteAssociation();
  // 404 rather than a file with a placeholder in it. Apple caches this through
  // a CDN for up to a day, so a wrong answer outlives its own correction.
  if (!payload) return new Response(null, { status: 404 });

  return Response.json(payload, {
    // Short, and shorter than Apple's own CDN will hold it anyway. Long enough
    // that this is not fetched per install, brief enough that rotating a Team ID
    // is not a day's wait on our side of the cache as well as Apple's.
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
