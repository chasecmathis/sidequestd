"use client";

/**
 * The Steam link, and everything that can be true about it.
 *
 * Six states, and the design is mostly about not letting them collapse into two:
 *
 *   unavailable  — this deployment has no Steam key. No button at all, because
 *                  one that always fails is worse than none.
 *   unlinked     — the connect action. The one primary on this screen, so it is
 *                  the one accent fill.
 *   syncing      — linked, never synced. The library is on its way.
 *   healthy      — linked and read.
 *   private      — linked, but Steam is withholding the library. *Not* an error
 *                  to apologise for: it is four steps the member can take, and
 *                  they are spelled out. This is the state the whole component
 *                  is shaped around; it is by far the most common way the
 *                  feature stops working, and the only one with a cure.
 *   failed       — Steam was unreachable. Nothing to do but try later.
 *
 * The visual idea: the card is a ledger entry, not a settings row. The persona
 * name is display serif, the figures are mono and tabular, and the connected
 * state is carried by a hairline and a single filled dot rather than by colour
 * — the accent stays reserved for the action.
 */
import { Link2Off, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { StoreMark } from "@/components/ui/store-mark";
import { useAuth } from "@/lib/auth";
import {
  canSyncNow,
  cooldownLabel,
  formatGameCount,
  formatSyncedAt,
  formatTotalPlaytime,
  matchedLabel,
  providerLabel,
  syncNotice,
} from "@/lib/connections";
import type { ConnectionStart, LinkedAccount } from "@sidequestd/api-types";

export function SteamConnectCard({
  account,
  available,
  onChange,
}: {
  account: LinkedAccount | null;
  available: boolean;
  onChange: (next: LinkedAccount | null) => void;
}) {
  const { authedRequest } = useAuth();
  const [pending, setPending] = useState<"connect" | "sync" | "unlink" | "visibility" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  const notice = account ? syncNotice(account.last_sync_status) : null;
  const awaitingFirstSync = account !== null && account.last_synced_at === null;

  async function connect() {
    setPending("connect");
    setError(null);
    try {
      const start = await authedRequest<ConnectionStart>("/connections/steam/start");
      // A top-level navigation, not a fetch: Steam has to render its own
      // sign-in page in the member's window, and it refuses to be framed.
      window.location.assign(start.authorize_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach Steam.");
      setPending(null);
    }
  }

  async function sync() {
    setPending("sync");
    setError(null);
    try {
      onChange(await authedRequest<LinkedAccount>("/connections/steam/sync", { method: "POST" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start a sync.");
    } finally {
      setPending(null);
    }
  }

  async function unlink() {
    setPending("unlink");
    setError(null);
    try {
      await authedRequest("/connections/steam", { method: "DELETE" });
      onChange(null);
      setConfirmingUnlink(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlink that account.");
    } finally {
      setPending(null);
    }
  }

  async function setVisible(isVisible: boolean) {
    setPending("visibility");
    setError(null);
    try {
      onChange(
        await authedRequest<LinkedAccount>("/connections/steam/visibility", {
          method: "PATCH",
          body: { is_visible: isVisible },
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change that setting.");
    } finally {
      setPending(null);
    }
  }

  if (!available) {
    return (
      <div className="rounded-lg border border-line bg-surface px-5 py-5">
        <div className="flex items-center gap-3">
          <StoreMark source="steam" className="size-5 text-fg-faint" />
          <p className="text-sm font-medium text-fg">Steam</p>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-fg-dim">
          Steam linking isn&rsquo;t available on this deployment.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-200 hover:border-line-strong">
      <div className="flex flex-wrap items-start gap-4 px-5 py-5">
        <StoreMark source="steam" className="mt-0.5 size-6 shrink-0 text-fg" />

        <div className="min-w-0 flex-1">
          {account ? (
            <>
              <p className="type-display text-2xl leading-none text-fg">
                {account.provider_username ?? providerLabel(account.provider)}
              </p>
              {/* The connected signal: a filled dot and a hairline-set line of
                  mono, rather than a green pill. Status here is a fact about a
                  ledger entry, not an alert. */}
              <p className="type-eyebrow mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-faint">
                <span
                  aria-hidden
                  className={
                    notice
                      ? "size-1.5 rounded-full bg-danger"
                      : awaitingFirstSync
                        ? "size-1.5 rounded-full bg-fg-faint"
                        : "size-1.5 rounded-full bg-success"
                  }
                />
                <span>{formatSyncedAt(account.last_synced_at)}</span>
              </p>
            </>
          ) : (
            <>
              <p className="type-display text-2xl leading-none text-fg">Steam</p>
              <p className="mt-2.5 max-w-md text-sm leading-relaxed text-fg-dim">
                Link your account to fill in playtime when you review a game, and show your
                most-played games on your profile.
              </p>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {account ? (
            <Button
              size="sm"
              onClick={() => void sync()}
              disabled={pending !== null || !canSyncNow(account)}
              title={cooldownLabel(account)}
            >
              {pending === "sync" ? (
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw aria-hidden strokeWidth={1.75} className="size-3.5" />
              )}
              {canSyncNow(account) ? "Sync now" : "Synced recently"}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void connect()} disabled={pending !== null}>
              {pending === "connect" ? "Opening Steam…" : "Connect Steam"}
            </Button>
          )}
        </div>
      </div>

      {account ? (
        <>
          {/* The figures. Recessed onto surface-2 like a card footer, because
              they are read as a strip rather than as sentences. */}
          <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3 border-t border-line bg-surface-2 px-5 py-4">
            <div>
              <dt className="type-eyebrow text-fg-faint">Library</dt>
              <dd className="mt-1.5 text-sm tabular-nums text-fg">
                {awaitingFirstSync && account.total_games === 0
                  ? "Syncing…"
                  : formatGameCount(account.total_games)}
              </dd>
            </div>
            <div>
              <dt className="type-eyebrow text-fg-faint">Total playtime</dt>
              <dd className="mt-1.5 text-sm tabular-nums text-fg">
                {formatTotalPlaytime(account.total_playtime_minutes)}
              </dd>
            </div>
            {matchedLabel(account) ? (
              <div className="min-w-0">
                <dt className="type-eyebrow text-fg-faint">Catalog</dt>
                <dd className="mt-1.5 text-sm text-fg-dim">{matchedLabel(account)}</dd>
              </div>
            ) : null}
          </dl>

          <div className="space-y-4 border-t border-line px-5 py-4">
            {notice ? (
              <Alert tone={notice.tone}>
                <span className="block font-medium">{notice.title}</span>
                {notice.steps.length > 0 ? (
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-[0.8125rem] leading-relaxed">
                    {notice.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}
              </Alert>
            ) : null}

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={account.is_visible}
                disabled={pending !== null}
                onChange={(event) => void setVisible(event.target.checked)}
                className="mt-1"
              />
              <span className="text-sm">
                <span className="font-medium text-fg">Show Steam on my profile</span>
                <span className="mt-1 block leading-relaxed text-fg-dim">
                  Turning this off also removes the verified playtime shown on your reviews.
                </span>
              </span>
            </label>

            <Alert tone="error" inline>
              {error}
            </Alert>

            {confirmingUnlink ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-3">
                <p className="min-w-0 flex-1 text-sm text-fg-dim">
                  Unlinking removes your synced library and the verified playtime on your reviews.
                </p>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void unlink()}
                  disabled={pending !== null}
                >
                  {pending === "unlink" ? "Unlinking…" : "Unlink"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingUnlink(false)}>
                  Keep it
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingUnlink(true)}
                className="type-eyebrow flex items-center gap-2 text-fg-faint transition-colors duration-150 hover:text-danger"
              >
                <Link2Off aria-hidden strokeWidth={1.75} className="size-3.5" />
                Unlink Steam
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="border-t border-line px-5 py-4">
          <Alert tone="error" inline>
            {error}
          </Alert>
          <Eyebrow className="text-fg-faint">Sidequestd never sees your Steam password</Eyebrow>
          <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-fg-dim">
            You sign in on Steam&rsquo;s own site and it tells us only your account ID. We read your
            games and playtime — nothing else — and you can unlink at any time.
          </p>
        </div>
      )}
    </div>
  );
}
