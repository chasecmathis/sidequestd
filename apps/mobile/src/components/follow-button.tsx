/**
 * The Follow / Requested / Following control from SPEC §6.2, §6.7.
 *
 * It moves optimistically and then takes the server's word for it: the API
 * decides between following and requesting (based on the target's privacy at
 * that moment, not on what this client last read), and its response carries both
 * the resulting state and the follower count, so the reconciliation is a
 * straight assignment rather than a guess.
 *
 * Owning its own state rather than lifting it into the profile keeps the screens
 * that use a follow button from each reimplementing the transitions.
 *
 * This is the control the read slice's profile screen said was missing: a
 * private account ended "Follow @ripley to see their reviews" with nothing to
 * press. It is also, on a phone, the one place where the optimism matters most —
 * a follow on a slow connection is a button that would otherwise sit inert for a
 * second on a screen the reader is about to swipe away from.
 */
import { useEffect, useState } from "react";
import { Alert as NativeAlert, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import {
  followActionLabel,
  followLabel,
  followRequest,
  optimisticState,
  useAuth,
} from "@sidequestd/core";
import type { FollowResult, FollowState, UserPublic } from "@sidequestd/api-types";

import { selectionTick } from "@/lib/haptics";
import { useStyles, type Tokens } from "@/theme";

import { Alert } from "./ui/alert";
import { Button } from "./ui/button";

export function FollowButton({
  user,
  state,
  size = "md",
  onChange,
  style,
}: {
  user: Pick<UserPublic, "id" | "username" | "is_private">;
  state: FollowState;
  size?: "sm" | "md";
  /** Told what the count became, so the profile's header can follow along. */
  onChange?: (result: { state: FollowState; followerCount: number }) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);
  const { authedRequest } = useAuth();

  const [current, setCurrent] = useState<FollowState>(state);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile re-fetches when the handle in the route changes, which hands
  // down a new state for a different person. Keyed on the id so navigating
  // between two profiles cannot leave the previous one's answer on screen.
  useEffect(() => {
    setCurrent(state);
    setError(null);
  }, [user.id, state]);

  async function press() {
    const from = current;

    selectionTick();
    setPending(true);
    setError(null);
    setCurrent(optimisticState(from, user.is_private));

    try {
      const { path, method } = followRequest(from, user.id);
      const result = await authedRequest<FollowResult>(path, { method });
      setCurrent(result.state);
      onChange?.({ state: result.state, followerCount: result.follower_count });
    } catch (cause) {
      // Put the button back where it was: leaving it on the optimistic value
      // would tell the reader they are following someone they are not.
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
    <View style={[styles.column, style]}>
      <Button
        variant={filled ? "primary" : "secondary"}
        size={size}
        disabled={pending}
        onPress={() => void press()}
        accessibilityLabel={followActionLabel(current, user.username)}
      >
        {followLabel(current)}
      </Button>

      <Alert tone="error" inline>
        {error}
      </Alert>
    </View>
  );
}

/**
 * "Remove follower", on the profile and in the followers list of somebody who
 * follows you.
 *
 * Separate from the button above because it acts on the opposite edge: this one
 * revokes an approval the *viewer* granted, which is a different row and a
 * different endpoint (SPEC §6.7).
 *
 * It asks first, where the follow button does not, and the asymmetry is the
 * point: following is undoable by pressing the same button again, and this is
 * not — only the person removed can recreate the edge, and they are not told it
 * happened.
 */
export function RemoveFollowerButton({
  user,
  size = "sm",
  onRemoved,
}: {
  user: Pick<UserPublic, "id" | "username">;
  size?: "sm" | "md";
  onRemoved?: () => void;
}) {
  const styles = useStyles(make);
  const { authedRequest } = useAuth();

  const [removed, setRemoved] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
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

  function confirm() {
    NativeAlert.alert(
      `Remove @${user.username}?`,
      "They stop following you and lose access to anything your account keeps private. They aren't told.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void remove() },
      ],
    );
  }

  // Nothing to revoke twice. The row stays on screen where this is a list — see
  // `follow-list-screen` — so the caller decides what "gone" looks like.
  if (removed) return null;

  return (
    <View style={styles.column}>
      <Button
        size={size}
        disabled={pending}
        onPress={confirm}
        accessibilityLabel={`Remove ${user.username} from your followers`}
      >
        Remove
      </Button>

      <Alert tone="error" inline>
        {error}
      </Alert>
    </View>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    column: { alignItems: "flex-start", gap: 6 },
  });
