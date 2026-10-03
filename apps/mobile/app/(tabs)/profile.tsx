/**
 * Profile — the signed-in reader's own, and the way into settings.
 *
 * The same `ProfileScreen` the pushed `/profile/[username]` route renders, given
 * the viewer's own handle. Two differences, and both are about being a tab
 * rather than a pushed screen: there is nothing to go back to, and the app bar's
 * action slot is free.
 *
 * The web's account popover has no good native form, so it becomes a settings
 * stack, and that slot is the gear that opens it. Sign out lives in there now
 * rather than here — it was on this screen through the read slice only because
 * there was nowhere else to put it, and a destructive-ish action sitting in the
 * corner of the screen it is easiest to reach by accident was always the wrong
 * final home for it.
 */
import { Settings } from "lucide-react-native";

import { ProfileScreen } from "@/components/profile-screen";
import { Screen } from "@/components/screen";
import { IconButton } from "@/components/ui/button";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { open } from "@/lib/navigate";
import { useRequireAuth } from "@/lib/require-auth";

export default function ProfileTab() {
  const user = useRequireAuth();

  // The frame between the session settling and the redirect landing. A skeleton
  // rather than nothing, so the tab has the shape of what is coming.
  if (!user) {
    return (
      <Screen>
        <ProfileSkeleton />
      </Screen>
    );
  }

  return (
    <ProfileScreen
      username={user.username}
      action={
        <IconButton icon={Settings} label="Settings" onPress={() => open("/settings")} />
      }
    />
  );
}
