import { describe, expect, it } from "vitest";

import {
  browseQuery,
  formatGameRating,
  formatIgdbRating,
  igdbMeterFill,
  linkableStores,
  orderFacetOptions,
  ratingCountLabel,
  releaseYearLabel,
  searchQuery,
  storeLinkLabel,
  toggleFacet,
  visibleFacetOptions,
} from "./catalog";
import type { StoreLink } from "@sidequestd/api-types";

/** The shape both facet helpers are generic over. */
const facets = (...slugs: string[]) => slugs.map((slug) => ({ slug }));
const slugsOf = (options: { slug: string }[]) => options.map((option) => option.slug);

describe("browseQuery", () => {
  it("repeats a facet key rather than comma-joining it", () => {
    // The API reads repeated keys as "any of these"; a comma-joined value would
    // arrive as one nonexistent slug.
    expect(browseQuery({ genres: ["indie", "puzzle"] })).toBe("/games?genre=indie&genre=puzzle");
  });

  it("combines facets, sort and pagination", () => {
    const query = browseQuery({
      genres: ["indie"],
      platforms: ["nintendo-switch"],
      sort: "release_date",
      cursor: "abc",
      limit: 10,
    });

    expect(query).toBe(
      "/games?genre=indie&platform=nintendo-switch&sort=release_date&cursor=abc&limit=10",
    );
  });

  it("omits an absent cursor so page one is not requested with cursor=null", () => {
    expect(browseQuery({ sort: "title", cursor: null })).toBe("/games?sort=title");
  });

  it("asks for the unfiltered catalog when nothing is selected", () => {
    expect(browseQuery({})).toBe("/games");
  });
});

describe("searchQuery", () => {
  it("percent-encodes the term", () => {
    expect(searchQuery("games", "mario & luigi")).toBe("/search/games?q=mario+%26+luigi");
  });

  it("targets the user endpoint and carries a cursor", () => {
    expect(searchQuery("users", "ripley", "next")).toBe("/search/users?q=ripley&cursor=next");
  });

  it("carries a page size when one is asked for", () => {
    expect(searchQuery("games", "hades", null, 6)).toBe("/search/games?q=hades&limit=6");
  });
});

describe("toggleFacet", () => {
  it("adds a slug that is not selected", () => {
    expect(toggleFacet(["indie"], "puzzle")).toEqual(["indie", "puzzle"]);
  });

  it("removes one that is", () => {
    expect(toggleFacet(["indie", "puzzle"], "indie")).toEqual(["puzzle"]);
  });

  it("does not mutate the array it was given", () => {
    const selected = ["indie"];
    toggleFacet(selected, "puzzle");
    expect(selected).toEqual(["indie"]);
  });
});

describe("orderFacetOptions", () => {
  it("pins the selected options to the front", () => {
    const ordered = orderFacetOptions(facets("action", "indie", "puzzle", "rpg"), [
      "puzzle",
      "rpg",
    ]);
    expect(slugsOf(ordered)).toEqual(["puzzle", "rpg", "action", "indie"]);
  });

  it("keeps the API's order within each group", () => {
    // Selected in the reverse of catalog order: the catalog order is what wins,
    // so the chips do not reshuffle depending on which one was clicked first.
    const ordered = orderFacetOptions(facets("action", "indie", "puzzle", "rpg"), [
      "rpg",
      "action",
    ]);
    expect(slugsOf(ordered)).toEqual(["action", "rpg", "indie", "puzzle"]);
  });

  it("leaves an unfiltered list alone", () => {
    expect(slugsOf(orderFacetOptions(facets("action", "indie"), []))).toEqual(["action", "indie"]);
  });

  it("does not mutate the array it was given", () => {
    const options = facets("action", "indie");
    orderFacetOptions(options, ["indie"]);
    expect(slugsOf(options)).toEqual(["action", "indie"]);
  });
});

describe("visibleFacetOptions", () => {
  const ordered = facets("a", "b", "c", "d", "e");

  it("truncates to the limit when collapsed", () => {
    expect(slugsOf(visibleFacetOptions(ordered, [], false, 3))).toEqual(["a", "b", "c"]);
  });

  it("returns everything when expanded", () => {
    expect(slugsOf(visibleFacetOptions(ordered, [], true, 3))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("never hides a selected option, even past the limit", () => {
    // Four selected against a limit of three: the filter stays fully readable
    // rather than the collapse quietly cutting one of the active chips off.
    const pinned = orderFacetOptions(ordered, ["a", "b", "c", "d"]);
    expect(slugsOf(visibleFacetOptions(pinned, ["a", "b", "c", "d"], false, 3))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("shows a short list whole rather than padding it", () => {
    expect(slugsOf(visibleFacetOptions(facets("a", "b"), [], false, 8))).toEqual(["a", "b"]);
  });
});

describe("releaseYearLabel", () => {
  it("shows the year when there is one", () => {
    expect(releaseYearLabel(2015)).toBe("2015");
  });

  it("says TBA rather than rendering null", () => {
    expect(releaseYearLabel(null)).toBe("TBA");
    expect(releaseYearLabel(undefined)).toBe("TBA");
  });
});

describe("formatGameRating", () => {
  it("shows the stored 1-10 average on the 5-star scale a reader sees", () => {
    expect(formatGameRating(10)).toBe("5.0");
    expect(formatGameRating(7)).toBe("3.5");
  });

  it("keeps the fraction an average actually has", () => {
    expect(formatGameRating(7.4)).toBe("3.7");
  });

  it("says nothing rather than zero when nobody has rated it", () => {
    expect(formatGameRating(null)).toBeNull();
    expect(formatGameRating(undefined)).toBeNull();
  });
});

describe("formatIgdbRating", () => {
  it("rounds to the whole number IGDB is read as", () => {
    expect(formatIgdbRating(87.4321)).toBe("87");
    expect(formatIgdbRating(87.6)).toBe("88");
  });

  it("shows a zero score rather than hiding it", () => {
    // The falsy-check trap: 0 is a score IGDB can publish, and it is not "unrated".
    expect(formatIgdbRating(0)).toBe("0");
  });

  it("says nothing when IGDB has no score", () => {
    expect(formatIgdbRating(null)).toBeNull();
    expect(formatIgdbRating(undefined)).toBeNull();
  });
});

describe("igdbMeterFill", () => {
  it("reads the score as a fraction of 100", () => {
    expect(igdbMeterFill(87)).toBeCloseTo(0.87);
  });

  it("clamps, so a bad upstream value cannot overrun the track", () => {
    expect(igdbMeterFill(150)).toBe(1);
    expect(igdbMeterFill(-5)).toBe(0);
  });
});

describe("ratingCountLabel", () => {
  it("names how many ratings the average is over", () => {
    expect(ratingCountLabel(1)).toBe("1 rating");
    expect(ratingCountLabel(1204)).toBe("1,204 ratings");
  });

  it("says nothing at zero, so the caller can say 'Not yet rated' instead", () => {
    expect(ratingCountLabel(0)).toBeNull();
    expect(ratingCountLabel(null)).toBeNull();
    expect(ratingCountLabel(undefined)).toBeNull();
  });
});

describe("linkableStores", () => {
  const steam: StoreLink = {
    source: "steam",
    uid: "620",
    label: "Steam",
    url: "https://store.steampowered.com/app/620/",
  };
  // The API hands over ids it cannot address rather than dropping them, because
  // `source` is a free string so a new store widens the catalog instead of
  // failing an import.
  const unaddressable: StoreLink = { source: "itch", uid: "12345", label: "itch", url: null };

  it("keeps a store somebody can actually be sent to", () => {
    expect(linkableStores([steam])).toEqual([
      { source: "steam", label: "Steam", url: "https://store.steampowered.com/app/620/" },
    ]);
  });

  it("drops a store with no address, so no link looks broken", () => {
    expect(linkableStores([unaddressable])).toEqual([]);
    expect(linkableStores([steam, unaddressable])).toHaveLength(1);
  });

  it("treats an absent field as no stores rather than throwing", () => {
    // A summary shape or an older cached response has no `store_links` at all,
    // and the metadata line it sits in must not take the page down with it.
    expect(linkableStores(undefined)).toEqual([]);
    expect(linkableStores(null)).toEqual([]);
  });
});

describe("storeLinkLabel", () => {
  it("names the game and warns that the link leaves the site", () => {
    // The visible text is the single word "Steam", which on its own tells a
    // screen-reader user neither which game it opens nor that it navigates away.
    const label = storeLinkLabel(
      { source: "steam", label: "Steam", url: "https://store.steampowered.com/app/620/" },
      "Portal 2",
    );

    expect(label).toBe("View Portal 2 on Steam (opens in a new tab)");
  });
});
