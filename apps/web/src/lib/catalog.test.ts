import { describe, expect, it } from "vitest";

import {
  browseQuery,
  orderFacetOptions,
  releaseYearLabel,
  searchQuery,
  toggleFacet,
  visibleFacetOptions,
} from "./catalog";

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
