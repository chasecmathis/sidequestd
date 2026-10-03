/**
 * The terms of service.
 *
 * See `privacy.tsx`, which this is the twin of in every respect — the words come
 * from the same shared module, the screen is reachable signed out for the same
 * reason, and it pays its own bottom inset for the same one.
 */
import { POLICY_UPDATED, TERMS_OF_SERVICE } from "@sidequestd/core";

import { LastUpdated, Prose } from "@/components/prose";
import { Screen } from "@/components/screen";
import { PageHeader } from "@/components/ui/page-header";

export default function TermsScreen() {
  return (
    <Screen back>
      <PageHeader
        eyebrow={TERMS_OF_SERVICE.eyebrow}
        title={TERMS_OF_SERVICE.title}
        description={TERMS_OF_SERVICE.description}
      />

      <LastUpdated date={POLICY_UPDATED} />

      <Prose blocks={TERMS_OF_SERVICE.blocks} />
    </Screen>
  );
}
