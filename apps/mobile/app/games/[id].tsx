/**
 * Game Detail (SPEC §5).
 *
 * The catalog record, and the two things SPEC §6.9 and §6.3 say a reader *does*
 * from here: put the game on a backlog list, and start reviewing it.
 *
 * Those two sit directly under the title, before the scores and the summary,
 * which is a step further up the page than the web puts them. On a 1024px page
 * the controls can sit in the right-hand column beside the artwork and still be
 * on screen; stacked on a phone they would otherwise land below a score band and
 * a paragraph of prose, which is to say below the fold, on the screen whose
 * whole purpose is to be acted on.
 *
 * **The cover is above the title, not beside it.** The web puts them in two
 * columns with the artwork at 240px, which is the layout of a page about a
 * single object. At 390px those columns become 150px of cover and a title set at
 * a size the serif loses its contrast at. Stacked, the artwork gets the width it
 * deserves and the headline gets a full measure — the same "this page can afford
 * the space" decision, made in the axis a phone has space in.
 *
 * The panel shadow comes with it. It is the one place in the app a shadow earns
 * its keep: box art is a physical object, and lifting it off the canvas is what
 * makes the screen read as a shelf rather than as a record.
 */
import { ArrowUpRight, PenLine } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import {
  ApiError,
  linkableStores,
  releaseYearLabel,
  storeLinkLabel,
  useAuth,
  type LinkableStore,
} from "@sidequestd/core";
import type { GameDetail } from "@sidequestd/api-types";

import { BacklogControl } from "@/components/backlog-control";
import { GameScores } from "@/components/game-scores";
import { Cover } from "@/components/media";
import { Screen } from "@/components/screen";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Skeleton } from "@/components/ui/skeleton";
import { StoreMark } from "@/components/ui/store-mark";
import { EyebrowText, Text } from "@/components/ui/text";
import { open } from "@/lib/navigate";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

/** How wide the artwork is allowed to get. Beyond this it stops being a cover. */
const COVER_MAX = 240;

function Tags({ label, items }: { label: string; items: { id: string; name: string }[] }) {
  const styles = useStyles(make);
  if (items.length === 0) return null;

  return (
    <View style={styles.tags}>
      <Eyebrow heading>{label}</Eyebrow>
      <View style={styles.tagRow}>
        {items.map((item) => (
          <View key={item.id} style={styles.tag}>
            <Text size={12} tone="dim">
              {item.name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Where to buy or launch the game.
 *
 * On the web these are inline in the metadata line, because a store listing is
 * something *about* the game rather than something the reader does inside
 * Sidequestd. That reasoning holds; the inline placement does not. Native cannot
 * give a link inside running text a hit area bigger than its glyphs, and these
 * are the only things on the screen that leave the app — the one case where a
 * mis-tap costs the reader their place in the app entirely.
 *
 * So they become their own quiet row under the line they used to sit in: same
 * rank, same greys, real targets. The arrow is doing the same work it does on
 * the web — nothing else here leaves, and a reader deserves to know before they
 * press.
 *
 * The mark leads each label, as it does on the web, and only for the sources we
 * have one for — which today is Steam alone. `StoreMark` renders nothing for the
 * rest rather than a placeholder, so a chip is either a mark and a word or just
 * the word, and never a broken-looking box. `store_links.source` is a free string
 * by design, so that is the permanent state of things rather than a gap.
 */
function StoreLinks({ game }: { game: GameDetail }) {
  const styles = useStyles(make);
  const tokens = useTokens();

  const stores = linkableStores(game.store_links);
  if (stores.length === 0) return null;

  function openStore(store: LinkableStore) {
    // Failure is silent on purpose: `openURL` rejects when no app can handle the
    // scheme, and an error banner about a store link would replace the reader's
    // view of the game with a complaint about something peripheral to it.
    void Linking.openURL(store.url).catch(() => {});
  }

  return (
    <View style={styles.stores}>
      {stores.map((store) => (
        <Pressable
          key={store.source}
          accessibilityRole="link"
          accessibilityLabel={storeLinkLabel(store, game.title)}
          onPress={() => openStore(store)}
          style={({ pressed }) => [styles.store, pressed && styles.storePressed]}
        >
          <StoreMark source={store.source} size={13} color={tokens.color.fgDim} />
          <EyebrowText tone="dim">{store.label}</EyebrowText>
          <ArrowUpRight size={12} strokeWidth={2} color={tokens.color.fgFaint} />
        </Pressable>
      ))}
    </View>
  );
}

function Loading() {
  const styles = useStyles(make);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading game"
      style={styles.loading}
    >
      <Skeleton style={styles.loadingCover} />
      <Skeleton style={{ height: 40, width: "75%" }} />
      {/* Wide enough for "Released 2015 · via igdb" rather than for the shortest
          form of that line, so a game with a source does not widen it on
          arrival. */}
      <Skeleton style={{ height: 14, width: 220 }} />
      {/* The score band, held open so the summary below it does not jump ~110px
          when the game arrives. */}
      <Skeleton style={{ height: 110, width: "100%" }} />
      <Skeleton style={{ height: 80, width: "100%" }} />
    </View>
  );
}

export default function GameDetailScreen() {
  const styles = useStyles(make);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { authedRequest } = useAuth();

  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authedRequest<GameDetail>(`/games/${id}`)
      .then((body) => {
        if (!cancelled) setGame(body);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 404
            ? "That game isn't in the catalog."
            : cause instanceof Error
              ? cause.message
              : "Request failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, id]);

  if (error) {
    return (
      <Screen back>
        <Alert>{error}</Alert>
        <Button onPress={() => open("/discover")} style={styles.away}>
          Back to Discover
        </Button>
      </Screen>
    );
  }

  if (!game) {
    return (
      <Screen back>
        <Loading />
      </Screen>
    );
  }

  return (
    <Screen back>
      <View style={styles.cover}>
        <Cover uri={game.cover_url} title={game.title} />
      </View>

      <View>
        <Text variant="display" size={38} accessibilityRole="header">
          {game.title}
        </Text>
        <EyebrowText tone="faint" style={styles.released}>
          Released {releaseYearLabel(game.release_year)}
          {game.external_source ? ` · via ${game.external_source}` : ""}
        </EyebrowText>
        <StoreLinks game={game} />
      </View>

      {/* The screen's one primary, beside the one control that is a *setting*
          rather than an action. `BacklogControl` renders nothing at all when
          signed out, and the row collapses to a single button when it does. */}
      <View style={styles.actions}>
        <Button
          variant="primary"
          icon={PenLine}
          onPress={() => open(`/reviews/new?game=${game.id}`)}
          style={styles.action}
        >
          Write a review
        </Button>
        <BacklogControl game={game} style={styles.action} />
      </View>

      {/* Above the summary: the summary is prose the eye skips, and how the game
          was received is the second thing a reader wants after its name. */}
      <GameScores game={game} />

      {game.summary ? (
        <Text size={15} tone="dim" relaxed>
          {game.summary}
        </Text>
      ) : null}

      <Tags label="Genres" items={game.genres} />
      <Tags label="Platforms" items={game.platforms} />
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    cover: {
      width: "100%",
      maxWidth: COVER_MAX,
      alignSelf: "center",
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      ...t.elevation.panel,
    },

    released: { marginTop: 12 },

    // Side by side while both fit, wrapping when the list name is long. Each
    // half grows, so two controls of different label lengths still divide the
    // row evenly rather than one hugging its text.
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    action: { flexGrow: 1, flexBasis: 150 },

    stores: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
    store: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      ...rounded(t.radius.sm),
      borderWidth: 1,
      borderColor: t.color.line,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    storePressed: { borderColor: t.color.lineStrong, backgroundColor: t.color.surface2 },

    tags: { gap: 12 },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    tag: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.color.line,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },

    away: { alignSelf: "flex-start" },

    loading: { gap: 16 },
    loadingCover: {
      width: "100%",
      maxWidth: COVER_MAX,
      aspectRatio: 3 / 4,
      alignSelf: "center",
      ...rounded(t.radius.lg),
    },
  });
