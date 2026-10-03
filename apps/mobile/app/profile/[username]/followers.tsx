/**
 * Who follows this account (SPEC §6.7).
 *
 * The screen is `FollowListScreen`; the direction is the only thing this route
 * and its sibling disagree about.
 */
import { useLocalSearchParams } from "expo-router";

import { FollowListScreen } from "@/components/follow-list-screen";

export default function FollowersRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();

  return <FollowListScreen username={username} direction="followers" />;
}
