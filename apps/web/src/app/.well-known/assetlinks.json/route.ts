/**
 * `GET /.well-known/assetlinks.json` — see `@/lib/app-links`.
 *
 * Android verifies this at install time and again on updates, and unlike Apple
 * it fetches from the device rather than through a CDN — so a bad answer here
 * costs a reinstall to clear rather than a day, and `adb shell pm
 * verify-app-links` will say so out loud.
 */
import { androidAssetLinks } from "@/lib/app-links";

/** Runtime, not build. Same reasoning as the Apple half's. */
export const dynamic = "force-dynamic";

export function GET() {
  const payload = androidAssetLinks();
  if (!payload) return new Response(null, { status: 404 });

  return Response.json(payload, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
