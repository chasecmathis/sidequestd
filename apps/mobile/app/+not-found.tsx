/**
 * A route the app does not have.
 *
 * Expo Router ships its own screen for this, and until now that is what a reader
 * would have got: a white page, the system font, and the word "Unmatched Route"
 * — the one surface in the app that is not in the app's design system, on the
 * one occasion the reader is already confused. That is the whole reason this
 * file exists.
 *
 * It is not a hypothetical screen. Three things route here:
 *
 *   - **A link from outside.** `sidequestd://` is a registered scheme, and
 *     anything at all can be typed after it. The web's answer to the same
 *     problem is a 404 page nobody reaches by accident either.
 *   - **A notification whose target has been deleted.** `notificationHref` in
 *     core builds a path from a row the server sent; a review removed between
 *     the push arriving and the reader tapping it is a path with nothing behind
 *     it, and the app was launched by the tap rather than resumed.
 *   - **A rename that landed on one side only.** `lib/navigate.ts` casts core's
 *     path strings to Expo Router's `Href` — deliberately, and with the reason
 *     written down — so a route renamed here and not in `packages/core` compiles
 *     and fails at the tap. This screen is where that failure becomes visible
 *     instead of silent.
 *
 * `router.canGoBack()` is the whole of the logic. A reader who arrived from
 * inside the app has somewhere to be returned to and would rather go back than
 * be sent home; a reader whose phone launched onto this screen has no stack at
 * all, and `back()` on an empty stack does nothing — a dead button on the screen
 * that already failed them. The app bar's chevron makes the same call for the
 * same reason, which is why they say the same thing.
 */
import { Compass, Home } from "lucide-react-native";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useStyles, type Tokens } from "@/theme";

export default function NotFoundScreen() {
  const styles = useStyles(make);
  const canGoBack = router.canGoBack();

  return (
    <Screen back contentStyle={styles.content}>
      <EmptyState
        icon={Compass}
        title="Nothing here"
        description={
          canGoBack
            ? "That link points at something this app does not have — it may have been removed since the link was made."
            : "That link points at something this app does not have. It may have been removed, or the link may be for a newer version."
        }
        action={
          <View style={styles.actions}>
            {canGoBack ? (
              <Button variant="primary" onPress={() => router.back()}>
                Go back
              </Button>
            ) : null}
            <Button
              icon={Home}
              variant={canGoBack ? "secondary" : "primary"}
              // `replace`, not `push`: this screen has nothing worth returning
              // to, and leaving it on the stack means the back gesture walks
              // straight back into the failure.
              onPress={() => router.replace("/")}
            >
              Go to Home
            </Button>
          </View>
        }
      />
    </Screen>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    // Centred in the screen rather than sitting under the app bar. There is no
    // content below it to be the top of, which is the only reason a screen ever
    // starts at the top.
    content: { flexGrow: 1, justifyContent: "center" },
    actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  });
