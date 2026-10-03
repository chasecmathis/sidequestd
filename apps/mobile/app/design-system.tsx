/**
 * Editorial Noir, as a specimen.
 *
 * Development only, reached from Home while there is no feed there. It exists
 * because of what this slice's verification actually asks for — "check both
 * themes on every screen" — and until the screens have content, this *is* the
 * content: every primitive, in one place, so a mode can be flipped and the whole
 * system judged in one scroll rather than one component at a time.
 *
 * Two things it is specifically for catching, both of which are invisible on a
 * single-theme sweep:
 *
 *   - a colour that was pinned rather than taken from the palette, which shows
 *     up the moment the other mode is on;
 *   - the `OverMedia` case, where light-theme components sitting on a dark scrim
 *     have to *stop* following the theme. The block below is the one place that
 *     pairing can be seen without a cover image on screen.
 */
import { Compass, PenLine, Trash2, TriangleAlert } from "lucide-react-native";
import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { a, b, CONTACT_EMAIL, em, h2, h3, IGDB_URL, mail, p, ul } from "@sidequestd/core";

import { apiUrl } from "@/lib/api";
import { open } from "@/lib/navigate";
import { ErrorScreen } from "@/components/error-screen";
import { Prose } from "@/components/prose";
import { Screen } from "@/components/screen";
import { StarRating, StarRatingInput } from "@/components/star-rating";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Chip, TextButton } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field, SearchInput, SubmitButton, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { MetaRule } from "@/components/ui/rule";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { Sheet, SheetOption } from "@/components/ui/sheet";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { StoreMark } from "@/components/ui/store-mark";
import { EyebrowText, Text } from "@/components/ui/text";
import { Wordmark } from "@/components/ui/wordmark";
import { OverMedia, rounded, text, useStyles, useTokens, type Tokens } from "@/theme";

const SORTS: SegmentOption<string>[] = [
  { value: "title", label: "A–Z" },
  { value: "release_date", label: "Newest" },
  { value: "trending", label: "Trending" },
];

/**
 * One of everything `Prose` can draw, which the real documents spread over two
 * thousand words.
 *
 * Built with core's own builders rather than as block literals, so this doubles
 * as the worked example of what writing a document with them looks like.
 */
const PROSE_SPECIMEN = [
  h2("A heading, at level two"),
  p(
    "A paragraph with ",
    b("emphasis in it"),
    ", a word ",
    em("used"),
    " rather than stressed, and a link to ",
    a("IGDB", IGDB_URL),
    " that opens a browser over this app.",
  ),
  h3("And one at level three"),
  ul(
    [b("A list item that leads with a term."), " The rest of it runs on."],
    [
      "One long enough to wrap, so the second line can be checked against the bullet it hangs from rather than under it.",
    ],
    ["An address: ", mail(CONTACT_EMAIL), "."],
  ),
  p("A last paragraph, linking back to the ", a("privacy policy", "/privacy"), " in the app."),
];

export default function DesignSystemScreen() {
  const styles = useStyles(make);
  const tokens = useTokens();
  const [note, setNote] = useState("");
  const [sort, setSort] = useState("title");
  const [genre, setGenre] = useState(true);
  const [rating, setRating] = useState<number | null>(7);
  const [sheet, setSheet] = useState(false);
  const [thrown, setThrown] = useState<Error | null>(null);

  return (
    // `back` rather than a Back button in the content: this is a pushed route
    // like any other, and the app bar is where the way out of one lives.
    <Screen back>
      <PageHeader
        eyebrow={`${tokens.name} theme`}
        title="Editorial Noir"
        description="Every primitive in the native client, in the mode currently on screen."
      />

      <Section label="Type">
        <Text variant="display" size={text.size.page}>
          Quiet surfaces,
        </Text>
        <Text variant="display" size={text.size.page} italic tone="dim">
          loud typography
        </Text>
        <Text size={text.size.body} tone="dim" relaxed>
          Figtree carries everything that is not a headline: a description like this one, a review,
          a form label. It is set at 15 with prose leading here.
        </Text>
        <EyebrowText tone="faint">Played 62h · 2 days ago</EyebrowText>
      </Section>

      <Section label="Buttons">
        <View style={styles.row}>
          <Button variant="primary" icon={PenLine}>
            Write a review
          </Button>
          <Button variant="secondary">Follow</Button>
        </View>
        <View style={styles.row}>
          <Button variant="ghost" size="sm">
            Comment
          </Button>
          <Button variant="danger" size="sm" icon={Trash2}>
            Delete
          </Button>
          <Button variant="secondary" size="sm" disabled>
            Disabled
          </Button>
        </View>
      </Section>

      <Section label="Badges">
        <View style={styles.row}>
          <Badge>Private</Badge>
          <Badge tone="accent">3</Badge>
          <Badge tone="outline">Recommended</Badge>
        </View>
      </Section>

      <Section label="Selection">
        {/* Chips and segments together, because the thing worth checking is that
            they read as different kinds of control at a glance: a chip is round
            and toggles on its own, a segment is square and one of a set. Both
            spend the accent, and only the chip spends it as a wash. */}
        <Segmented label="Sort" options={SORTS} value={sort} onChange={setSort} />
        <View style={styles.row}>
          <Chip label="Roguelike" selected={genre} onPress={() => setGenre((on) => !on)} />
          <Chip label="Puzzle" selected={false} onPress={() => {}} />
          <TextButton onPress={() => {}}>Show all 42</TextButton>
        </View>
      </Section>

      <Section label="Meta strip">
        {/* The row a `ReviewCard` and a review's header both set their facts in.
            The rule between them is the thing being checked — it is the app's
            only piece of punctuation, and it has to read as a gap rather than
            as a border on something. */}
        <View style={styles.strip}>
          <EyebrowText tone="dim">4.5 / 5</EyebrowText>
          <MetaRule />
          <EyebrowText tone="faint">2019</EyebrowText>
          <MetaRule />
          <EyebrowText tone="faint">Played 62h</EyebrowText>
        </View>
      </Section>

      <Section label="Card">
        <Card interactive>
          <CardHeader>
            <View style={styles.avatar} />
            <View style={styles.headerText}>
              <Text weight="medium">Rin Kobayashi</Text>
              <EyebrowText tone="faint">@rin · 2 days ago</EyebrowText>
            </View>
            <Badge tone="outline">4.5</Badge>
          </CardHeader>
          <CardBody>
            <Text tone="dim" relaxed>
              A card reads as raised because it is two steps lighter than the canvas and has a 1px
              edge — not because of a shadow. On a near-black page a shadow is invisible anyway.
            </Text>
          </CardBody>
          <CardFooter>
            <Button variant="ghost" size="sm">
              Like
            </Button>
            <Button variant="ghost" size="sm">
              Comment
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section label="Over media">
        {/* The scrim stands in for cover art. Inside it the four pinned roles
            must look identical in both themes — that is the whole test. */}
        <View style={styles.scrim}>
          <OverMedia>
            <View style={styles.scrimRow}>
              <Badge tone="overlay">4 photos</Badge>
              <Text size={13} tone="dim">
                Metadata over artwork
              </Text>
            </View>
            <Text variant="display" size={22}>
              Outer Wilds
            </Text>
            <EyebrowText tone="star">★★★★☆ · 4.5</EyebrowText>
          </OverMedia>
        </View>
      </Section>

      <Section label="Stats">
        <View style={styles.grid}>
          <Stat label="Reviews" value={42} />
          <Stat label="Followers" value="1.2k" />
        </View>
      </Section>

      <Section label="Rating">
        {/* The one control drawn from a shared path rather than from type, and
            the one whose halves have to be checked in both themes: an empty star
            is `line-strong` and a filled one is `star`, which invert against
            each other if either is taken from the wrong palette. */}
        <StarRating rating={7} size={20} />
        <StarRatingInput value={rating} onChange={setRating} />
      </Section>

      <Section label="Sheet">
        {/* The web's `Dialog`. Worth having here because it is the one surface
            that is drawn *over* the app rather than in it — the scrim, the
            grabber and the panel's own shadow are all invisible until something
            opens one. */}
        <Button onPress={() => setSheet(true)}>Open a sheet</Button>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Hollow Knight"
          description="A game sits on one list at a time."
        >
          <SheetOption
            label="Playing"
            hint="What you're in the middle of."
            selected
            onPress={() => setSheet(false)}
          />
          <SheetOption
            label="Completed"
            hint="Finished, credits and all."
            onPress={() => setSheet(false)}
          />
          <SheetOption label="Remove from lists" destructive onPress={() => setSheet(false)} />
        </Sheet>
      </Section>

      <Section label="Form">
        <SearchInput label="Search games" placeholder="Elden Ring" />
        <Field label="Username" placeholder="rin" autoCapitalize="none" hint="Letters and numbers." />
        <Field label="Email" placeholder="you@example.com" error="That address is already in use." />
        <Textarea label="Review" placeholder="What did you think?" rows={4} value={note} onChangeText={setNote} />
        <SubmitButton pending={false} onPress={() => {}}>
          Post review
        </SubmitButton>
      </Section>

      <Section label="Messages">
        <Alert tone="error">Your session expired. Sign in again to keep going.</Alert>
        <Alert tone="success">Review posted.</Alert>
      </Section>

      <Section label="Loading">
        <Skeleton style={styles.skeletonLine} />
        <ListSkeleton count={2} />
      </Section>

      <Section label="Empty">
        <EmptyState
          icon={Compass}
          title="No reviews yet"
          description="Follow a few people and their reviews will show up here."
          action={<Button variant="primary">Find people</Button>}
        />
      </Section>

      {/* The document renderer, on one of everything it can draw: two heading
          levels, a paragraph with both kinds of emphasis in it, a list, and all
          three kinds of link. The links are live — the mailto opens a mail app,
          the external one an in-app browser, the internal one pushes — which is
          the only way to check the three branches without reading a policy to
          the bottom looking for one of each. */}
      <Section label="Prose">
        <Prose blocks={PROSE_SPECIMEN} />
      </Section>

      {/* The two screens Expo Router would otherwise draw itself, and the two
          this app is most likely to ship without ever having looked at: one
          needs a broken link to reach and the other needs a crash. */}
      <Section label="Failure">
        <View style={styles.failures}>
          <Button icon={Compass} onPress={() => open("/this-route-does-not-exist")}>
            Not found
          </Button>
          {/* `retry` is a no-op here: there is nothing to re-render, and the
              button is on screen to be pressed rather than to work. */}
          <Button
            icon={TriangleAlert}
            variant="danger"
            onPress={() => setThrown(new Error("Specimen: this is what a render error looks like."))}
          >
            Error screen
          </Button>
        </View>
        {thrown ? <ErrorScreenPreview error={thrown} onDismiss={() => setThrown(null)} /> : null}
      </Section>

      <Section label="Mark">
        <Wordmark size="md" />
        {/* The store marks, at the two sizes they are actually drawn at — a chip
            on game detail and the connect card's heading — and beside a source
            we have no mark for, which is the case that has to render as nothing
            rather than as a box. */}
        <View style={styles.marks}>
          <StoreMark source="steam" size={13} color={tokens.color.fgDim} />
          <StoreMark source="steam" size={22} color={tokens.color.fg} />
          <StoreMark source="epic" size={22} color={tokens.color.fg} />
          <EyebrowText tone="faint">steam · steam · epic (no mark)</EyebrowText>
        </View>
        <Text size={12} tone="faint" style={styles.api}>
          API: {apiUrl()}
        </Text>
      </Section>
    </Screen>
  );
}

/**
 * The error screen, on screen without anything having gone wrong.
 *
 * A `Modal` because that is the only way to see it as it really is: it is a
 * full-height `flex: 1` view, and rendering one inside a scrolling specimen
 * would show it squashed into whatever space was left. "Try again" is wired to
 * the dismiss, which is what retrying looks like from here.
 */
function ErrorScreenPreview({ error, onDismiss }: { error: Error; onDismiss: () => void }) {
  return (
    <Modal visible animationType="fade" onRequestClose={onDismiss}>
      <ErrorScreen error={error} retry={onDismiss} />
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles(make);
  return (
    <View style={styles.section}>
      <Eyebrow rule heading>
        {label}
      </Eyebrow>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    section: { gap: 16 },
    sectionBody: { gap: 12 },
    row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
    strip: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
    grid: { flexDirection: "row", gap: 12 },

    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.color.surface2 },
    headerText: { flex: 1, gap: 4 },

    scrim: {
      gap: 8,
      ...rounded(t.radius.lg),
      backgroundColor: t.color.scrim,
      padding: 16,
    },
    scrimRow: { flexDirection: "row", alignItems: "center", gap: 8 },

    skeletonLine: { height: 14, width: "60%" },
    failures: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    marks: { flexDirection: "row", alignItems: "center", gap: 10 },
    api: { marginTop: 4 },
  });
