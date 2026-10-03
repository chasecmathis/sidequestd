/**
 * The five tabs, registered from the one list in `@/navigation`.
 *
 * Mapping over `TABS` rather than writing five `<Tabs.Screen>` elements is what
 * keeps the navigator and the bar that draws it from disagreeing — the file
 * order under `app/(tabs)/` decides nothing, this list does.
 *
 * `headerShown: false` throughout: each screen renders its own `AppBar`, because
 * the wordmark and the theme control belong to the app rather than to the
 * navigator, and a native header would draw a second bar above them.
 */
import { Tabs } from "expo-router";

import { TabBar } from "@/components/tab-bar";
import { TABS } from "@/navigation";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}
