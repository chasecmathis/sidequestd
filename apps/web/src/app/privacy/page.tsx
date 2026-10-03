/**
 * The privacy policy.
 *
 * The words are in `@sidequestd/core`'s `policy.ts`, along with the three things
 * about them that have to stay true and the reason no vendor is named. They
 * moved there when `apps/mobile` grew this same screen; what is left here is the
 * page — a header, the "last updated" line, and the measure.
 *
 * `max-w-2xl` inside the shell's `max-w-5xl` main, with `prose-legal` supplying
 * a 68ch cap of its own. This is a document rather than a feed, and a feed's
 * width is far too wide to read a paragraph across.
 *
 * A server component — no `"use client"` — which is what lets it export
 * `metadata`. `AppShell` below it is a client component, and rendering one from
 * a server component is fine.
 */
import type { Metadata } from "next";

import { POLICY_UPDATED, PRIVACY_POLICY, SITE_NAME } from "@sidequestd/core";

import { AppShell } from "@/components/app-shell";
import { Prose } from "@/components/prose";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${SITE_NAME} collects, what it does not, and how to get your data removed.`,
};

export default function PrivacyPage() {
  return (
    <AppShell>
      <div className="max-w-2xl">
        <PageHeader
          eyebrow={PRIVACY_POLICY.eyebrow}
          title={PRIVACY_POLICY.title}
          description={PRIVACY_POLICY.description}
        />

        <p className="type-eyebrow mt-8 text-fg-faint">Last updated {POLICY_UPDATED}</p>

        <div className="prose-legal mt-12">
          <Prose blocks={PRIVACY_POLICY.blocks} />
        </div>
      </div>
    </AppShell>
  );
}
