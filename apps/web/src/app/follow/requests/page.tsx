"use client";

/**
 * Follow requests — SPEC §6.7, one of the extra screens in §5.
 *
 * Only a private account ever has anything here: a public one accepts follows
 * outright, so the list is empty by construction rather than by filtering. It is
 * still reachable and still says so, because an account that was private
 * yesterday may have requests waiting today.
 *
 * A row disappears as soon as it is answered. The alternative — leaving it in
 * place with a changed label — invites a second press on a request that no
 * longer exists, which the API answers with a 404 that reads like a bug.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { UserCheck } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { profilePath } from "@/lib/profile";
import { REQUESTS_PAGE_SIZE, handle } from "@/lib/social";
import type { FollowRequest, FollowRequestPage } from "@sidequestd/api-types";

function Row({
  request,
  onAnswered,
}: {
  request: FollowRequest;
  onAnswered: (userId: string) => void;
}) {
  const { authedRequest } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(decision: "accept" | "decline") {
    setPending(true);
    setError(null);
    try {
      await authedRequest(`/follow/requests/${request.user.id}/${decision}`, { method: "POST" });
      onAnswered(request.user.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
      setPending(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-4 last:border-b-0">
      <Link href={profilePath(request.user.username)} className="shrink-0">
        <Avatar user={request.user} size={48} />
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={profilePath(request.user.username)} className="link-quiet font-medium text-fg">
          {request.user.username}
        </Link>
        {request.user.display_name ? (
          <p className="type-eyebrow mt-1 text-fg-faint">{request.user.display_name}</p>
        ) : null}
        <Alert tone="error" inline className="mt-1.5">
          {error}
        </Alert>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => void answer("accept")}
          aria-label={`Approve the follow request from ${handle(request.user)}`}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-60"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void answer("decline")}
          aria-label={`Decline the follow request from ${handle(request.user)}`}
          className="rounded-lg border border-line px-4 py-1.5 text-sm transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </li>
  );
}

export default function FollowRequestsPage() {
  const router = useRouter();
  const { authedRequest, user, isLoading } = useAuth();

  const [requests, setRequests] = useState<FollowRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  useEffect(() => {
    if (isLoading || !user) return;

    let cancelled = false;
    authedRequest<FollowRequestPage>(`/follow/requests?limit=${REQUESTS_PAGE_SIZE}`)
      .then((page) => {
        if (!cancelled) setRequests(page.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load your requests.");
        }
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the id rather than the record: the context hands down a new object
    // whenever anything about the session changes, and refetching on each of
    // those would drop rows mid-decision.
  }, [authedRequest, isLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AppShell>
      <PageHeader
        eyebrow="Private account"
        title="Follow requests"
        description="Approving someone lets them see your reviews, favorites and stats."
      />

      <div className="mt-8">
        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : requests === null ? (
          <ListSkeleton label="Loading follow requests" />
        ) : requests.length > 0 ? (
          <ul
            aria-label="Follow requests"
            className="overflow-hidden rounded-lg border border-line bg-surface/40"
          >
            {requests.map((request) => (
              <Row
                key={request.user.id}
                request={request}
                onAnswered={(userId) =>
                  setRequests((current) =>
                    (current ?? []).filter((entry) => entry.user.id !== userId),
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={UserCheck}
            description={
              user?.is_private
                ? "No requests waiting."
                : "Your account is public, so people follow you without asking."
            }
          />
        )}
      </div>
    </AppShell>
  );
}
