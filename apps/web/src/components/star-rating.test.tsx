import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StarRating, StarRatingInput } from "./star-rating";

describe("StarRating", () => {
  it("announces the value in stars, not in the stored integer", () => {
    // "7" would be meaningless read aloud; SPEC §6.3 displays 0.5-5.0.
    render(<StarRating rating={7} />);

    expect(screen.getByText("3.5 out of 5 stars")).toBeInTheDocument();
  });
});

describe("StarRatingInput", () => {
  it("offers a stop for every half star", () => {
    render(<StarRatingInput value={null} onChange={vi.fn()} />);

    expect(screen.getAllByRole("radio")).toHaveLength(10);
  });

  it("labels each stop with what it means", () => {
    render(<StarRatingInput value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "0.5 out of 5 stars" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "5 out of 5 stars" })).toBeInTheDocument();
  });

  it("reports the stored 1-10 value, not the star count", () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={null} onChange={onChange} />);

    screen.getByRole("radio", { name: "4 out of 5 stars" }).click();

    expect(onChange).toHaveBeenCalledWith(8);
  });

  it("checks exactly the chosen stop", () => {
    render(<StarRatingInput value={7} onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "3.5 out of 5 stars" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "4 out of 5 stars" })).not.toBeChecked();
  });

  it("says so when nothing has been picked", () => {
    render(<StarRatingInput value={null} onChange={vi.fn()} />);

    expect(screen.getByText("Not rated")).toBeInTheDocument();
  });

  it("shows the running value once one has", () => {
    render(<StarRatingInput value={9} onChange={vi.fn()} />);

    expect(screen.getByText("4.5 / 5")).toBeInTheDocument();
  });

  it("cannot be changed while disabled", async () => {
    const onChange = vi.fn();
    render(<StarRatingInput value={null} onChange={onChange} disabled />);

    await userEvent.click(screen.getByRole("radio", { name: "5 out of 5 stars" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
