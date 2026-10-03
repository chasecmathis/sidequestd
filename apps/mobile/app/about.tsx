/**
 * What Sidequestd is, for someone who arrived without being told.
 *
 * The sentences come from `@sidequestd/core`'s `about.ts` and are the web's
 * exactly. The arrangement is not, and the three places it differs are all the
 * same 390pt problem the read surfaces already ran into:
 *
 *   - **The five-step band loses its numbers to the margin.** On the web each
 *     step is a rule, an accent "01", a 24px serif title and a paragraph, with
 *     room for the numeral to sit above the title as a label. Here the numeral
 *     goes *beside* the title on the same line, because a phone stacking five
 *     three-line blocks is already a long scroll and one of those lines was a
 *     two-character eyebrow.
 *   - **The two-scores card stacks.** The web splits it down the middle with a
 *     vertical rule, which is the layout that makes the comparison read as a
 *     comparison. At this width the two halves are 170pt each, and "Everyone,
 *     out of a hundred. Broader, and slower to move." is four lines of that. So
 *     they stack, and the hairline between them turns horizontal — the same
 *     divider doing the same job on the axis that is available.
 *   - **The policy buttons are full width and stacked.** Two `sm` buttons side
 *     by side is the web's; two 36pt targets sharing a row under a paragraph is
 *     a thumb's worst case, and there is nothing else competing for the space.
 *
 * Signed out on purpose — no `useRequireAuth`, same as `privacy.tsx`. This is
 * the screen somebody reads before deciding whether to make an account.
 */
import { StyleSheet, View } from "react-native";

import {
  ABOUT_CONTACT,
  ABOUT_DATA_SOURCE,
  ABOUT_DESCRIPTION,
  ABOUT_DISCLAIMER_INDEX,
  ABOUT_INTRO,
  ABOUT_TITLE,
  APP_VERSION,
  EXAMPLE_IGDB,
  EXAMPLE_STARS,
  formatStars,
  HOW_IT_WORKS,
  igdbMeterFill,
  SITE_NAME,
  TWO_SCORES_CAVEAT,
  TWO_SCORES_LEAD,
  TWO_SCORES_OURS,
  TWO_SCORES_THEIRS,
} from "@sidequestd/core";

import { Prose } from "@/components/prose";
import { Screen } from "@/components/screen";
import { StarRating } from "@/components/star-rating";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { EyebrowText, Text } from "@/components/ui/text";
import { open } from "@/lib/navigate";
import { text, useStyles, type Tokens } from "@/theme";

export default function AboutScreen() {
  const styles = useStyles(make);

  return (
    <Screen back>
      <PageHeader eyebrow="About" title={ABOUT_TITLE} description={ABOUT_DESCRIPTION} />

      <View style={styles.section}>
        <Eyebrow heading rule>
          The idea
        </Eyebrow>
        <Prose blocks={ABOUT_INTRO} />
      </View>

      <View style={styles.section}>
        <Eyebrow heading rule>
          How it works
        </Eyebrow>

        <View style={styles.steps}>
          {HOW_IT_WORKS.map((step) => (
            <View key={step.n} style={styles.step}>
              <View style={styles.stepHead}>
                {/* The accent as letters, which the palette almost never allows
                    — this is the same exception the web makes for the same two
                    characters, and it works because a numeral is a mark rather
                    than something anybody reads for meaning. */}
                <EyebrowText tone="accent">{step.n}</EyebrowText>
                <Text
                  variant="display"
                  size={text.size.section}
                  accessibilityRole="header"
                  style={styles.stepTitle}
                >
                  {step.title}
                </Text>
              </View>

              <Text size={text.size.small} tone="dim" relaxed>
                {step.body}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Eyebrow heading rule>
          Two scores, not one
        </Eyebrow>

        <Text size={text.size.body} tone="dim" relaxed>
          {TWO_SCORES_LEAD}
        </Text>

        {/* Drawn with the real `StarRating` and the real `igdbMeterFill`, not a
            mock-up of them. An explainer that renders something subtly unlike
            the thing it explains teaches the wrong picture, and this one would
            drift the first time either was restyled. */}
        <Card>
          <View style={styles.scoreHalf}>
            <Eyebrow>{SITE_NAME}</Eyebrow>
            <View style={styles.scoreValue}>
              <StarRating rating={EXAMPLE_STARS} size={15} />
              <EyebrowText tone="fg">{formatStars(EXAMPLE_STARS)}</EyebrowText>
            </View>
            <Text size={text.size.small} tone="dim" relaxed>
              {TWO_SCORES_OURS}
            </Text>
          </View>

          <View style={[styles.scoreHalf, styles.scoreSecond]}>
            <Eyebrow>IGDB</Eyebrow>
            <View style={styles.scoreValue}>
              {/* Decoration beside a numeral that already says it, so it is
                  hidden outright — the same division of labour `GameScores`
                  uses, where the value rides on one accessible name. */}
              <View
                style={styles.track}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View style={[styles.fill, { width: `${igdbMeterFill(EXAMPLE_IGDB) * 100}%` }]} />
              </View>
              <EyebrowText tone="fg">{EXAMPLE_IGDB}</EyebrowText>
            </View>
            <Text size={text.size.small} tone="dim" relaxed>
              {TWO_SCORES_THEIRS}
            </Text>
          </View>
        </Card>

        <Text size={text.size.small} tone="faint" relaxed>
          {TWO_SCORES_CAVEAT}
        </Text>
      </View>

      <View style={styles.section}>
        <Eyebrow heading rule>
          Where the game data comes from
        </Eyebrow>

        {/* A block at a time rather than one call, because the affiliation line
            is a disclaimer rather than an explanation and is set one step
            dimmer than the two above it — as it is on the web. */}
        {ABOUT_DATA_SOURCE.map((block, index) => (
          <Prose key={index} blocks={[block]} tone={index === ABOUT_DISCLAIMER_INDEX ? "faint" : "dim"} />
        ))}
      </View>

      <View style={styles.closing}>
        <Eyebrow heading>Get in touch</Eyebrow>

        <Prose blocks={ABOUT_CONTACT} />

        <View style={styles.policies}>
          <Button onPress={() => open("/privacy")}>Privacy</Button>
          <Button onPress={() => open("/terms")}>Terms</Button>
        </View>

        <EyebrowText tone="faint">Version {APP_VERSION}</EyebrowText>
      </View>
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    section: { gap: 16 },

    steps: { gap: 24 },
    // The rule above each step is the web's `border-t`, and it is what keeps
    // five paragraphs from reading as one long one.
    step: { borderTopWidth: 1, borderTopColor: t.color.line, paddingTop: 14, gap: 10 },
    // Baseline-ish rather than centred: the numeral is 11pt mono and the title
    // is a 22pt serif, so centring them hangs the number in the middle of the
    // cap height instead of sitting it on the line.
    stepHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
    stepTitle: { flex: 1, minWidth: 0 },

    // `Card` has no padding of its own — `CardBody` normally supplies it — and
    // these two halves need the divider to fall between the padding rather than
    // inside it, so each pays its own.
    scoreHalf: { paddingHorizontal: 18, paddingVertical: 18, gap: 12 },
    // The web's vertical rule, turned. At 390pt the two halves stack, so the
    // divider that separated columns separates rows.
    scoreSecond: { borderTopWidth: 1, borderTopColor: t.color.line },
    scoreValue: { flexDirection: "row", alignItems: "center", gap: 10, height: 16 },

    // The IGDB meter, at the same weight `GameScores` draws it.
    track: { flex: 1, height: 1, backgroundColor: t.color.line },
    fill: { height: 1, backgroundColor: t.color.fgDim },

    closing: {
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      paddingTop: 24,
      gap: 16,
    },

    // Stacked and full width. Two 36pt targets sharing a row is the web's
    // arrangement and a thumb's worst case, and nothing else wants the space.
    policies: { gap: 10 },
  });
