/**
 * Follow requests — SPEC §6.7, and the one screen the native nav had nowhere to
 * put.
 *
 * The web gives this its own route and its own conditional slot in the nav. Five
 * tabs is the native ceiling and a sixth that appears and disappears with an
 * account setting would be worse than any of the alternatives, so it lands here:
 * a segmented control on Notifications, shown only to a private account. The
 * two lists belong together anyway — a request *is* a notification you have to
 * answer, and it already raises one.
 *
 * A row disappears the moment it is answered, exactly as on the web and for the
 * same reason: leaving it in place with a changed label invites a second press
 * on a request that no longer exists, which the API answers with a 404 that
 * reads like a bug.
 *
 * The layout is the one part that is not the web's. There, avatar, handle and
 * two buttons sit on one wrapping line; at 390pt that leaves the handle about
 * eleven characters before Approve pushes it over. So the identity is one row
 * and the answer is the row beneath it — which also puts two destructive-ish
 * choices at a thumb's width rather than at a fingernail's.
 */
import { UserCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { handle, profilePath, REQUESTS_PAGE_SIZE, useAuth } from "@sidequestd/core";
import type { FollowRequest, FollowRequestPage, UserMe } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { useStyles, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { ListSkeleton } from "./ui/skeleton";
import { Text } from "./ui/text";
import { UserList } from "./user-row";

function RequestRow({
  request,
  onAnswered,
  last,
}: {
  request: FollowRequest;
  onAnswered: (userId: string) => void;
  last: boolean;
}) {
  const styles = useStyles(make);
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
    <View style={[styles.row, !last && styles.ruled]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`@${request.user.username}`}
        onPress={() => open(profilePath(request.user.username))}
        style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
      >
        <Avatar user={request.user} size={44} />
        <View style={styles.names}>
          <Text size={14} weight="medium" numberOfLines={1}>
            @{request.user.username}
          </Text>
          {request.user.display_name ? (
            <Text size={14} tone="dim" numberOfLines={1} style={styles.displayName}>
              {request.user.display_name}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.answer}>
        {/* Approve is the primary and Decline is not, which is the web's call
            and the right one: approving is the action the reader came here to
            take, and declining is undoable only by the other person. */}
        <Button
          variant="primary"
          size="sm"
          disabled={pending}
          onPress={() => void answer("accept")}
          accessibilityLabel={`Approve the follow request from ${handle(request.user)}`}
          style={styles.button}
        >
          Approve
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onPress={() => void answer("decline")}
          accessibilityLabel={`Decline the follow request from ${handle(request.user)}`}
          style={styles.button}
        >
          Decline
        </Button>
      </View>

      <Alert tone="error" inline style={styles.error}>
        {error}
      </Alert>
    </View>
  );
}

export function FollowRequests({ viewer }: { viewer: UserMe }) {
  const styles = useStyles(make);
  const { authedRequest } = useAuth();

  const [requests, setRequests] = useState<FollowRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
    // Keyed on the id rather than the record, for the reason the web's copy of
    // this gives: the session object is replaced whenever anything about it
    // changes, and refetching on each of those would drop rows mid-decision.
    // The screen above passes the whole `UserMe`, so reading `.id` in the
    // dependency list is what keeps that from being a re-fetch per keystroke in
    // the profile editor.
  }, [authedRequest, viewer.id]);

  if (error) return <Alert>{error}</Alert>;
  if (requests === null) return <ListSkeleton label="Loading follow requests" />;

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={UserCheck}
        description={
          viewer.is_private
            ? "No requests waiting."
            : "Your account is public, so people follow you without asking."
        }
      />
    );
  }

  return (
    <View style={styles.list}>
      <UserList label="Follow requests">
        {requests.map((request, index) => (
          <RequestRow
            key={request.user.id}
            request={request}
            last={index === requests.length - 1}
            onAnswered={(userId) =>
              setRequests((current) => (current ?? []).filter((entry) => entry.user.id !== userId))
            }
          />
        ))}
      </UserList>

      <Text size={13} tone="faint" relaxed>
        Approving someone lets them see your reviews, favorites and stats.
      </Text>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    list: { gap: 16 },

    row: { paddingBottom: 14 },
    ruled: { borderBottomWidth: 1, borderBottomColor: t.color.line },

    identity: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
    pressed: { backgroundColor: t.color.surface2 },
    names: { flex: 1, minWidth: 0 },
    displayName: { marginTop: 3 },

    // Under the identity rather than beside it, and both halves the same width:
    // at 390pt these are the only two things on their line, so there is no
    // reason for either to be the narrow one.
    answer: { flexDirection: "row", gap: 8, paddingHorizontal: 16 },
    button: { flex: 1 },

    error: { paddingHorizontal: 16, marginTop: 8 },
  });
