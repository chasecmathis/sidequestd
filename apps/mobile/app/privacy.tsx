/**
 * The privacy policy.
 *
 * A route that resolves nothing and renders a document, which is what a route
 * file in this app is allowed to be. The words are in `@sidequestd/core`'s
 * `policy.ts` — shared with the web, and that module explains at length why a
 * legal document is the one kind of copy this repo refuses to keep two copies
 * of. `components/prose.tsx` is the renderer.
 *
 * Signed out on purpose: no `useRequireAuth`. Somebody reading a privacy policy
 * is frequently somebody deciding whether to make an account, and both stores
 * require the document to be reachable from a link that does not assume one.
 * It is the same reason the web's is a server component that renders for a
 * stranger.
 *
 * `<Screen back>` rather than a tab, so it pays its own home-indicator inset —
 * this is the longest scroll in the app by a distance, and it is the screen
 * where a last line under the indicator would actually be a last line.
 */
import { POLICY_UPDATED, PRIVACY_POLICY } from "@sidequestd/core";

import { LastUpdated, Prose } from "@/components/prose";
import { Screen } from "@/components/screen";
import { PageHeader } from "@/components/ui/page-header";

export default function PrivacyScreen() {
  return (
    <Screen back>
      <PageHeader
        eyebrow={PRIVACY_POLICY.eyebrow}
        title={PRIVACY_POLICY.title}
        description={PRIVACY_POLICY.description}
      />

      <LastUpdated date={POLICY_UPDATED} />

      <Prose blocks={PRIVACY_POLICY.blocks} />
    </Screen>
  );
}
