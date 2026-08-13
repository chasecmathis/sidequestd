import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GameSummary } from "@sidequestd/api-types";

import { GameScores } from "./game-scores";

function game(fields: Partial<GameSummary> = {}): GameSummary {
  return {
    id: "1",
    slug: "hollow-knight",
    title: "Hollow Knight",
    cover_url: null,
    release_date: "2017-02-24",
    release_year: 2017,
    platforms: [],
    rating_average: null,
    rating_count: 0,
    igdb_rating: null,
    igdb_rating_count: null,
    ...fields,
  };
}

describe("GameScores", () => {
  it("shows the two scores in their own scales", () => {
    render(
      <GameScores
        game={game({
          rating_average: 7.4,
          rating_count: 128,
          igdb_rating: 87.4,
          igdb_rating_count: 1204,
        })}
      />,
    );

    // Ours reads out of 5, theirs out of 100. Neither is converted into the other.
    expect(screen.getByText("3.7")).toBeInTheDocument();
    expect(screen.getByText("128 ratings")).toBeInTheDocument();
    expect(screen.getByText("87")).toBeInTheDocument();
    expect(screen.getByText("1,204 ratings")).toBeInTheDocument();
  });

  it("announces the upstream score with the scale it is on", () => {
    // "87" alone is ambiguous read aloud, and the meter beside it is decoration.
    render(<GameScores game={game({ igdb_rating: 87 })} />);

    expect(screen.getByText("87 out of 100 on IGDB")).toBeInTheDocument();
  });

  it("still names our own score in stars", () => {
    render(<GameScores game={game({ rating_average: 7.4, rating_count: 128 })} />);

    expect(screen.getByText("3.7 out of 5 stars")).toBeInTheDocument();
  });

  it("says a game is unrated rather than drawing it as zero stars", () => {
    render(<GameScores game={game()} />);

    expect(screen.getByText("Not yet rated")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    // Five hollow stars would say the community rated it nothing.
    expect(screen.queryByText(/out of 5 stars/)).not.toBeInTheDocument();
  });

  it("leaves the IGDB half out entirely when there is no upstream score", () => {
    // Absent, not empty: most of the catalog has none until the sync reaches it,
    // and an empty meter would read as "IGDB rated this zero".
    render(<GameScores game={game({ rating_average: 8, rating_count: 3 })} />);

    expect(screen.queryByText("IGDB")).not.toBeInTheDocument();
    expect(screen.queryByText(/on IGDB/)).not.toBeInTheDocument();
  });

  it("shows a zero upstream score rather than hiding it", () => {
    render(<GameScores game={game({ igdb_rating: 0 })} />);

    expect(screen.getByText("0 out of 100 on IGDB")).toBeInTheDocument();
  });

  it("names the block even when the count is unknown", () => {
    render(<GameScores game={game({ igdb_rating: 91, igdb_rating_count: null })} />);

    expect(screen.getByText("Score only")).toBeInTheDocument();
  });
});
