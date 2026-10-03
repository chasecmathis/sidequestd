/**
 * Somebody else's profile.
 *
 * A pushed route, and a public one — SPEC §6.7 keeps a private account's shell
 * visible to everyone, so there is no `useRequireAuth` here. The screen itself
 * is `ProfileScreen`, which the Profile tab also renders; this file is the route
 * and the handle it carries.
 */
import { useLocalSearchParams } from "expo-router";

import { ProfileScreen } from "@/components/profile-screen";

export default function UserProfileRoute() {
  const { username } = useLocalSearchParams<{ username: string }>();

  return <ProfileScreen username={username} back />;
}
