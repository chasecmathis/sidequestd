/**
 * The tabs, in order — the native half of SPEC §5.
 *
 * One list, read by both the navigator (which registers the routes) and the tab
 * bar (which draws them), so a tab cannot exist in one and not the other. The
 * web keeps the same list in `app-shell.tsx` for the same reason.
 *
 * Five is the ceiling, and it is why two of the web's nav slots are not here:
 *
 *   - **Follow requests** is a segmented control on Notifications rather than a
 *     conditional sixth tab, which would make the bar's layout depend on whether
 *     an account is private.
 *   - **Settings** is a stack reached from the Profile tab's header, which is
 *     where the web's account popover ends up once there is no popover.
 *
 * Icons are `lucide-react-native` — the same set and the same names the web
 * imports from `lucide-react`, so the two navs are drawn from one vocabulary.
 */
import { Bell, Compass, Home, Search, User, type LucideIcon } from "lucide-react-native";

export interface TabItem {
  /** The route file under `app/(tabs)/`, without its extension. */
  name: string;
  label: string;
  icon: LucideIcon;
}

export const TABS: TabItem[] = [
  { name: "index", label: "Home", icon: Home },
  { name: "discover", label: "Discover", icon: Compass },
  { name: "search", label: "Search", icon: Search },
  { name: "notifications", label: "Notifications", icon: Bell },
  { name: "profile", label: "Profile", icon: User },
];
