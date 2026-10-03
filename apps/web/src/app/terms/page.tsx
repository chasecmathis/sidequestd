/**
 * The terms of service.
 *
 * The words are in `@sidequestd/core`'s `policy.ts`, along with the reasoning
 * about the section numbering, the DMCA procedure in §8 and the class-action
 * waiver in §14. They moved there when `apps/mobile` grew this same screen; what
 * is left here is the page.
 *
 * See `privacy/page.tsx` on the measure, which is the same one for the same
 * reason.
 */
import type { Metadata } from "next";

import { POLICY_UPDATED, SITE_NAME, TERMS_OF_SERVICE } from "@sidequestd/core";

import { AppShell } from "@/components/app-shell";
import { Prose } from "@/components/prose";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Terms",
  description: `The rules for using ${SITE_NAME}, and what happens to what you post.`,
};

export default function TermsPage() {
  return (
    <AppShell>
      <div className="max-w-2xl">
        <PageHeader
          eyebrow={TERMS_OF_SERVICE.eyebrow}
          title={TERMS_OF_SERVICE.title}
          description={TERMS_OF_SERVICE.description}
        />

        <p className="type-eyebrow mt-8 text-fg-faint">Last updated {POLICY_UPDATED}</p>

        <div className="prose-legal mt-12">
          <Prose blocks={TERMS_OF_SERVICE.blocks} />
        </div>
      </div>
    </AppShell>
  );
}
