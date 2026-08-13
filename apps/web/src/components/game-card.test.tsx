import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GameSummary } from "@sidequestd/api-types";

import { GameCard } from "./game-card";

function game(fields: Partial<GameSummary> = {}): GameSummary {
  return {
    id: "1",
    slug: "hollow-knight",
    title: "Hollow Knight",
    cover_url: null,
    release_date: "2017-02-24",
    release_year: 2017,
    platforms: [{ id: "p1", name: "Nintendo Switch", slug: "nintendo-switch" }],
    rating_average: null,
    rating_count: 0,
    igdb_rating: null,
    igdb_rating_count: null,
    ...fields,
  };
}

describe("GameCard", () => {
  it("carries both scores on one quiet line", () => {
    render(<GameCard game={game({ rating_average: 7.4, igdb_rating: 87 })} />);

    expect(screen.getByText("3.7")).toBeInTheDocument();
    expect(screen.getByText("IGDB")).toBeInTheDocument();
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("names each scale, since two numbers side by side are otherwise ambiguous", () => {
    render(<GameCard game={game({ rating_average: 7.4, igdb_rating: 87 })} />);

    expect(screen.getByText("out of 5 on sidequestd")).toBeInTheDocument();
    expect(screen.getByText("out of 100 on IGDB")).toBeInTheDocument();
  });

  it("shows our average alone when IGDB has no score", () => {
    render(<GameCard game={game({ rating_average: 8 })} />);

    expect(screen.getByText("4.0")).toBeInTheDocument();
    expect(screen.queryByText("IGDB")).not.toBeInTheDocument();
  });

  it("shows the IGDB score alone before anybody here has rated it", () => {
    // The common case for most of the catalog, so it must not look broken.
    render(<GameCard game={game({ igdb_rating: 87 })} />);

    expect(screen.getByText("87")).toBeInTheDocument();
    expect(screen.queryByText("out of 5 on sidequestd")).not.toBeInTheDocument();
  });

  it("drops the line entirely when there is no score at all", () => {
    render(<GameCard game={game()} />);

    expect(screen.queryByText("IGDB")).not.toBeInTheDocument();
    expect(screen.queryByText(/out of 5 on sidequestd/)).not.toBeInTheDocument();
    // The card still says everything it said before.
    expect(screen.getByText("Hollow Knight")).toBeInTheDocument();
    expect(screen.getByText("Nintendo Switch")).toBeInTheDocument();
  });
});
