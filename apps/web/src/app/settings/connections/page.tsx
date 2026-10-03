"use client";

/**
 * Connections — SPEC §6.13.
 *
 * The second settings screen, and the first one that needed the section to be a
 * route rather than a block on `/settings/profile`: linking leaves the app
 * entirely and comes back on a redirect, so it needs an address of its own to
 * come back *to*.
 *
 * That redirect is also why this page reads `?connected=` and `?error=` on
 * mount. The callback cannot render anything itself — it is answering a browser
 * mid-navigation — so it hands the outcome over in the query string and this is
 * where it becomes a sentence. The parameters are stripped once read, so a
 * reload does not re-announce a link that happened ten minutes ago.
 */
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { SteamConnectCard } from "@/components/connections/steam-connect-card";
import { Alert } from "@/components/ui/alert";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { callbackMessage, CONNECTIONS_PATH, useAuth, type SyncNotice } from "@sidequestd/core";

import type { ConnectionStatus, LinkedAccount } from "@sidequestd/api-types";

function ConnectionsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, isLoading, authedRequest } = useAuth();

  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SyncNotice | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  // Read the callback's verdict once, then take it out of the URL. Without the
  // replace, "Steam connected" would reappear on every refresh and on every
  // back-navigation to this screen.
  useEffect(() => {
    const message = callbackMessage(params.get("connected") ?? params.get("error"));
    if (!message) return;
    setOutcome(message);
    router.replace(CONNECTIONS_PATH);
  }, [params, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    authedRequest<ConnectionStatus>("/me/connections")
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : "Could not load your connections.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, authedRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !user) {
    return <ProfileSkeleton />;
  }

  const steam = status?.accounts.find((account) => account.provider === "STEAM") ?? null;

  function handleChange(next: LinkedAccount | null) {
    setStatus((current) => {
      if (!current) return current;
      return {
        ...current,
        accounts: next ? [next] : [],
      };
    });
    // A fresh link or a sync has been queued; the outcome banner from the
    // redirect is stale the moment the member does anything else.
    setOutcome(null);
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="type-display text-4xl text-fg">Connections</h1>
        <Link href="/settings/profile" className="link text-sm text-fg">
          Edit profile
        </Link>
      </div>

      <p className="mt-4 max-w-lg text-sm leading-relaxed text-fg-dim">
        Link the platform you actually play on. Sidequestd fills in your playtime when you write a
        review, and shows it as verified so nobody has to take your word for it.
      </p>

      {outcome ? (
        <Alert tone={outcome.tone} className="mt-6">
          <span className="block font-medium">{outcome.title}</span>
          {outcome.steps.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[0.8125rem] leading-relaxed">
              {outcome.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <Alert tone="error" className="mt-6">
        {loadError}
      </Alert>

      <section aria-labelledby="platforms" className="mt-10">
        <Eyebrow as="h2" id="platforms" rule>
          Platforms
        </Eyebrow>

        <div className="mt-5">
          {status === null ? (
            <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" />
          ) : (
            <SteamConnectCard
              account={steam}
              available={status.steam_available}
              onChange={handleChange}
            />
          )}
        </div>

        {/* Said once, plainly, rather than left for people to wonder about.
              Steam is the only platform with a sanctioned way in — the other
              three publish no consumer API at all — and a reader who owns a PS5
              deserves an answer better than its absence from the list. */}
        <p className="mt-6 text-xs leading-relaxed text-fg-faint">
          PlayStation, Xbox and Nintendo don&rsquo;t offer a public way for apps like this one to
          read your library, so they aren&rsquo;t here yet. If that changes, they&rsquo;ll show up
          on this screen.
        </p>
      </section>
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <AppShell>
      {/* The screen reads `?connected=` off the URL, and `useSearchParams` needs
          a boundary or the route cannot be prerendered at all. Same shape as the
          review composer, which reads `?game=` for the same reason. */}
      <Suspense fallback={<ProfileSkeleton />}>
        <ConnectionsScreen />
      </Suspense>
    </AppShell>
  );
}
