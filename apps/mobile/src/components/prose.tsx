/**
 * The native half of `@sidequestd/core`'s prose model.
 *
 * `prose-legal` in `globals.css` is a stylesheet: the web writes `<h2>` and the
 * cascade supplies a serif, a size, a colour and two margins. React Native has
 * no cascade and no default face, so the same document has to be assembled a
 * `<Text>` at a time — which is what this file is, and it is the reason the
 * words could not simply be handed to a Markdown renderer and forgotten about.
 *
 * Four things it has to do that the web got for free:
 *
 *   - **Nest the emphasis.** `<Text>` inside `<Text>` inherits, so an emphasised
 *     run is a child with a family and a colour on it. There is no `font-weight:
 *     500` to reach for — a weight is its own family here, which is why `strong`
 *     is `weight="medium"` and never a style.
 *   - **Draw the bullets.** No `list-style`, so a list item is a row with a `•`
 *     in a fixed-width column beside it. Fixed rather than measured, so the
 *     second line of a wrapping item hangs against the first.
 *   - **Space the blocks.** No margin collapsing and no `& h2 { margin-top }`,
 *     so the rhythm is a `gap` between siblings plus the extra a heading takes
 *     above it. `prose-legal`'s 3rem/1.25rem becomes 32/0 at this measure — a
 *     phone is narrower, so the same document is a great deal longer, and the
 *     web's desktop rhythm scrolls as dead space.
 *   - **Decide what a link does.** The web has one answer for all three kinds
 *     and only branches to pick a `target`. Here a `mailto:` leaves for the mail
 *     app, an outside address opens a browser *over* this app rather than
 *     handing the reader to Safari, and an in-app path is a push onto the
 *     navigator. `linkKind` in core is the shared rule; the three consequences
 *     are this file's.
 *
 * The links are underlined always, where the web reveals the accent on hover.
 * That is the `link` utility's native form (see
 * .context/architecture/mobile-client.md): a persistent underline in
 * `line-strong`, because there is no hover to discover it with.
 */
import { Linking, StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { linkKind, type Block, type Inline } from "@sidequestd/core";

import { open } from "@/lib/navigate";
import { text, useStyles, type Tokens } from "@/theme";

import { Text } from "./ui/text";

/**
 * Where a link in a policy document goes.
 *
 * Every branch swallows its own failure. A device with no mail app configured,
 * a browser that will not open, a path a future route rename broke — none of
 * them is worth an unhandled rejection in a document somebody is reading, and
 * none of them has a recovery the reader would act on.
 */
function follow(href: string) {
  switch (linkKind(href)) {
    case "email":
      void Linking.openURL(href).catch(() => {});
      return;
    case "internal":
      open(href);
      return;
    case "external":
      // The same in-app browser the Steam link uses — it comes back to this
      // screen when it is dismissed, where `Linking.openURL` would hand the
      // reader to Safari and end this app's involvement in their afternoon.
      void WebBrowser.openBrowserAsync(href).catch(() => {});
  }
}

function Runs({ content }: { content: Inline[] }) {
  const styles = useStyles(make);

  return (
    <>
      {content.map((run, index) => {
        if (typeof run === "string") return run;

        // A weight is a family here, so emphasis is a prop rather than a style —
        // set `fontWeight` and Android silently falls back to the system face.
        //
        // **`em` and `strong` come out the same, and that is the tradeoff being
        // taken.** Emphasis at body size would want a sans italic, and there is
        // no Figtree italic in the bundle: `fonts.ts` registers seven faces and
        // each costs around 400 KB of download. The whole app uses `em` in one
        // sentence of the privacy policy — "anything visible *in* the image" —
        // and the medium family carries that distinction perfectly well. A
        // second sans face for one word is not a trade worth making, and a
        // `fontStyle: "italic"` that silently renders as the system font on
        // Android is worse than either.
        const emphasis = run.strong || run.em ? ({ weight: "medium", tone: "fg" } as const) : null;

        const href = run.href;

        if (href) {
          return (
            <Text
              key={index}
              {...emphasis}
              accessibilityRole="link"
              onPress={() => follow(href)}
              style={styles.link}
            >
              {run.text}
            </Text>
          );
        }

        // A run with no emphasis and no link is a plain string that happened to
        // be written as an object. Rendering it as one costs a nested `<Text>`
        // per run for nothing, so it collapses.
        if (!emphasis) return run.text;

        return (
          <Text key={index} {...emphasis}>
            {run.text}
          </Text>
        );
      })}
    </>
  );
}

/**
 * A document's blocks, as views.
 *
 * Keyed by index, which is safe here for the reason it is on the web: these
 * lists are module constants and nothing reorders, filters or appends to them.
 */
export function Prose({ blocks, tone = "dim" }: { blocks: Block[]; tone?: "dim" | "faint" }) {
  const styles = useStyles(make);

  return (
    <View style={styles.document}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text
                key={index}
                accessibilityRole="header"
                variant={block.level === 2 ? "display" : "body"}
                size={block.level === 2 ? text.size.section : text.size.body}
                weight={block.level === 2 ? "regular" : "medium"}
                // The first block of every document is a heading, and a
                // document opening with 32pt of air under its own page header
                // is a screen that starts empty.
                style={[styles.heading, index > 0 && styles.headingSpaced]}
              >
                {block.text}
              </Text>
            );

          case "paragraph":
            return (
              <Text key={index} size={text.size.body} tone={tone} relaxed>
                <Runs content={block.content} />
              </Text>
            );

          case "list":
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.item}>
                    {/* Its own `<Text>` rather than a "• " prefix inside the
                        sentence, so a wrapped second line hangs against the
                        first instead of running back under the bullet. */}
                    <Text size={text.size.body} tone="faint" relaxed style={styles.bullet}>
                      •
                    </Text>
                    <Text size={text.size.body} tone={tone} relaxed style={styles.itemText}>
                      <Runs content={item} />
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

/**
 * The "last updated" line both policy screens carry above their first heading.
 *
 * Here rather than duplicated in two routes, and beside the renderer because it
 * is part of the same object: a document with a date on it.
 */
export function LastUpdated({ date }: { date: string }) {
  // No margin of its own: `Screen` puts 24 between its children, and this line
  // sits between the page header and the first heading as one of them.
  return (
    <Text size={text.size.fine} tone="faint">
      Last updated {date}
    </Text>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    // The gap is `prose-legal`'s paragraph margin; a heading adds the rest of
    // its own space above itself rather than the container knowing about it.
    document: { gap: 14 },

    heading: { color: t.color.fg },
    headingSpaced: { marginTop: 18 },

    list: { gap: 8 },
    item: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    // Wide enough for the glyph and no wider, so the hang is tight.
    bullet: { width: 10, textAlign: "center" },
    itemText: { flex: 1 },

    link: {
      textDecorationLine: "underline",
      textDecorationColor: t.color.lineStrong,
    },

  });
