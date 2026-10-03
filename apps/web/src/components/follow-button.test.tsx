import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@sidequestd/core";
import type { FollowResult } from "@sidequestd/api-types";

import { FollowButton, RemoveFollowerButton } from "./follow-button";

const authedRequest = vi.fn();

vi.mock("@sidequestd/core/auth", () => ({
  useAuth: () => ({ authedRequest, user: null, isLoading: false, logout: vi.fn() }),
}));

const RIPLEY = { id: "u1", username: "ripley", is_private: false };
const NEWT = { id: "u2", username: "newt", is_private: true };

function result(overrides: Partial<FollowResult> = {}): FollowResult {
  return {
    follower_id: "viewer",
    followee_id: "u1",
    state: "FOLLOWING",
    follower_count: 1,
    ...overrides,
  };
}

beforeEach(() => {
  authedRequest.mockResolvedValue(result());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("FollowButton", () => {
  it("starts from the state the profile reported", () => {
    render(<FollowButton user={RIPLEY} state="FOLLOWING" />);

    expect(screen.getByRole("button", { name: "Unfollow ripley" })).toHaveTextContent("Following");
  });

  it("follows a public account", async () => {
    render(<FollowButton user={RIPLEY} state="NONE" />);

    await userEvent.click(screen.getByRole("button", { name: "Follow ripley" }));

    expect(authedRequest).toHaveBeenCalledWith("/follow/u1", { method: "POST" });
    expect(await screen.findByText("Following")).toBeInTheDocument();
  });

  it("shows a private account as Requested before the server answers", async () => {
    // SPEC §6.7 turns a follow into a request; the button should not read
    // "Follow" for a frame after it was pressed.
    let settle: (value: FollowResult) => void = () => {};
    authedRequest.mockReturnValue(
      new Promise<FollowResult>((resolve) => {
        settle = resolve;
      }),
    );
    render(<FollowButton user={NEWT} state="NONE" />);

    await userEvent.click(screen.getByRole("button", { name: "Follow newt" }));

    expect(screen.getByRole("button")).toHaveTextContent("Requested");
    settle(result({ state: "REQUESTED", followee_id: "u2", follower_count: 0 }));
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
  });

  it("takes the server's word over its own guess", async () => {
    // The account's privacy may have changed since this client read it, so the
    // API decides which of the two happened.
    authedRequest.mockResolvedValue(result({ state: "REQUESTED", follower_count: 0 }));
    render(<FollowButton user={RIPLEY} state="NONE" />);

    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByText("Requested")).toBeInTheDocument();
  });

  it("unfollows with the same path", async () => {
    authedRequest.mockResolvedValue(result({ state: "NONE", follower_count: 0 }));
    render(<FollowButton user={RIPLEY} state="FOLLOWING" />);

    await userEvent.click(screen.getByRole("button"));

    expect(authedRequest).toHaveBeenCalledWith("/follow/u1", { method: "DELETE" });
    expect(await screen.findByText("Follow")).toBeInTheDocument();
  });

  it("withdraws a request with the same call as an unfollow", async () => {
    authedRequest.mockResolvedValue(result({ state: "NONE", follower_count: 0 }));
    render(<FollowButton user={NEWT} state="REQUESTED" />);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(authedRequest).toHaveBeenCalledWith("/follow/u2", { method: "DELETE" });
  });

  it("reports the new count to whoever is showing it", async () => {
    const onChange = vi.fn();
    authedRequest.mockResolvedValue(result({ state: "FOLLOWING", follower_count: 1205 }));
    render(<FollowButton user={RIPLEY} state="NONE" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ state: "FOLLOWING", followerCount: 1205 }),
    );
  });

  it("puts the button back when the call fails", async () => {
    // Leaving it on the optimistic value would tell the user they are following
    // someone they are not.
    authedRequest.mockRejectedValue(new ApiError("Can't reach the server.", 0));
    render(<FollowButton user={RIPLEY} state="NONE" />);

    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
    expect(screen.getByRole("button")).toHaveTextContent("Follow");
  });

  it("cannot be pressed twice while it is working", async () => {
    authedRequest.mockReturnValue(new Promise(() => {}));
    render(<FollowButton user={RIPLEY} state="NONE" />);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toBeDisabled();
    expect(authedRequest).toHaveBeenCalledTimes(1);
  });

  it("resets when it is pointed at somebody else", async () => {
    const { rerender } = render(<FollowButton user={RIPLEY} state="FOLLOWING" />);
    expect(screen.getByRole("button")).toHaveTextContent("Following");

    rerender(<FollowButton user={NEWT} state="NONE" />);

    expect(screen.getByRole("button")).toHaveTextContent("Follow");
  });
});

describe("RemoveFollowerButton", () => {
  it("revokes the edge pointing at you", async () => {
    authedRequest.mockResolvedValue(undefined);
    render(<RemoveFollowerButton user={RIPLEY} />);

    await userEvent.click(screen.getByRole("button", { name: /remove ripley/i }));

    expect(authedRequest).toHaveBeenCalledWith("/followers/u1", { method: "DELETE" });
  });

  it("disappears once there is nothing left to revoke", async () => {
    authedRequest.mockResolvedValue(undefined);
    render(<RemoveFollowerButton user={RIPLEY} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.queryByRole("button")).not.toBeInTheDocument());
  });

  it("stays put and explains itself when the call fails", async () => {
    authedRequest.mockRejectedValue(new ApiError("That user is not one of your followers.", 404));
    render(<RemoveFollowerButton user={RIPLEY} />);

    await userEvent.click(screen.getByRole("button"));

    expect(await screen.findByRole("alert")).toHaveTextContent("not one of your followers");
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
