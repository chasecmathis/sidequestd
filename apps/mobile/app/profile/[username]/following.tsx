/**
 * Who this account follows (SPEC §6.7). See `followers.tsx`.
 */
import { useLocalSearchParams } from "expo-router";

import { FollowListScreen } from "@/components/follow-list-screen";

export default function FollowingRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();

  return <FollowListScreen username={username} direction="following" />;
}
