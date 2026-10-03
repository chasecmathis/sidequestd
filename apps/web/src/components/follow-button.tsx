"use client";

/**
 * The Follow / Requested / Following control from SPEC §6.2, §6.7.
 *
 * It moves optimistically and then takes the server's word for it: the API
 * decides between following and requesting (based on the target's privacy at
 * that moment, not on what this client last read), and its response carries both
 * the resulting state and the follower count, so the reconciliation is a
 * straight assignment rather than a guess.
 *
 * Owning its own state rather than lifting it into the profile keeps the two
 * screens that use a follow button — and the third one that will, once there is
 * a followers list — from each reimplementing the transitions.
 */
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  followActionLabel,
  followLabel,
  followRequest,
  optimisticState,
  useAuth,
} from "@sidequestd/core";

import type { FollowResult, FollowState, UserPublic } from "@sidequestd/api-types";

interface FollowButtonProps {
  user: Pick<UserPublic, "id" | "username" | "is_private">;
  state: FollowState;
  /** Told what the count became, so the profile's header can follow along. */
  onChange?: (result: { state: FollowState; followerCount: number }) => void;
}

export function FollowButton({ user, state, onChange }: FollowButtonProps) {
  const { authedRequest } = useAuth();
  const [current, setCurrent] = useState<FollowState>(state);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile re-fetches when the handle in the URL changes, which hands down
  // a new state for a different person. Keyed on the id so navigating between
  // two profiles cannot leave the previous one's answer on screen.
  useEffect(() => {
    setCurrent(state);
    setError(null);
  }, [user.id, state]);

  async function press() {
    const from = current;
    const optimistic = optimisticState(from, user.is_private);

    setPending(true);
    setError(null);
    setCurrent(optimistic);

    try {
      const { path, method } = followRequest(from, user.id);
      const result = await authedRequest<FollowResult>(path, { method });
      setCurrent(result.state);
      onChange?.({ state: result.state, followerCount: result.follower_count });
    } catch (cause) {
      // Put the button back where it was: leaving it on the optimistic value
      // would tell the user they are following someone they are not.
      setCurrent(from);
      setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  // Filled only while there is something to gain by pressing. Once the viewer is
  // following, or has asked to, the button is a state they can undo rather than
  // an invitation — and the accent belongs on the invitation.
  const filled = current === "NONE";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant={filled ? "primary" : "secondary"}
        size="sm"
        onClick={() => void press()}
        disabled={pending}
        aria-label={followActionLabel(current, user.username)}
      >
        {followLabel(current)}
      </Button>
      <Alert tone="error" inline>
        {error}
      </Alert>
    </div>
  );
}

/**
 * "Remove follower", shown on the profile of someone who follows you.
 *
 * Separate from the button above because it acts on the opposite edge: this one
 * revokes an approval the *viewer* granted, which is a different row and a
 * different endpoint (SPEC §6.7).
 */
export function RemoveFollowerButton({
  user,
  onRemoved,
}: {
  user: Pick<UserPublic, "id" | "username">;
  onRemoved?: () => void;
}) {
  const { authedRequest } = useAuth();
  const [removed, setRemoved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function press() {
    setPending(true);
    setError(null);
    try {
      await authedRequest(`/followers/${user.id}`, { method: "DELETE" });
      setRemoved(true);
      onRemoved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove that follower.");
    } finally {
      setPending(false);
    }
  }

  // Nothing to revoke twice, and the profile is still showing their page.
  if (removed) return null;

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        size="sm"
        onClick={() => void press()}
        disabled={pending}
        aria-label={`Remove ${user.username} from your followers`}
      >
        Remove follower
      </Button>
      <Alert tone="error" inline>
        {error}
      </Alert>
    </div>
  );
}
