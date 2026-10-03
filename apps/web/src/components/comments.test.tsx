import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@sidequestd/core";
import { settle } from "@/test-support";
import type { CommentItem, CommentThread, UserMe } from "@sidequestd/api-types";

import { CommentSection } from "./comments";

const authedRequest = vi.fn();

let currentUser: UserMe | null = null;
let isLoading = false;

vi.mock("@sidequestd/core/auth", () => ({
  useAuth: () => ({
    authedRequest,
    user: currentUser,
    isLoading,
    logout: vi.fn(),
    syncUser: vi.fn(),
  }),
}));

function me(id = "u2", username = "hicks"): UserMe {
  return {
    id,
    username,
    display_name: null,
    bio: null,
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    email: `${username}@example.com`,
    email_verified_at: null,
  };
}

function comment(overrides: Partial<CommentItem> = {}): CommentItem {
  return {
    id: "c1",
    review_id: "r1",
    author: {
      id: "u2",
      username: "hicks",
      display_name: "Dwayne Hicks",
      bio: null,
      avatar_url: null,
      is_private: false,
      created_at: "2026-01-01T00:00:00Z",
    },
    parent_comment_id: null,
    text: "Astonishing.",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    edited: false,
    ...overrides,
  };
}

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return { ...comment(), replies: [], ...overrides };
}

/** The section reads the thread and then writes to it, so answers go by path. */
function respondWith(threads: CommentThread[], written: CommentItem = comment({ id: "new" })) {
  authedRequest.mockImplementation((path: string, options?: { method?: string }) => {
    if (path.startsWith("/reviews/") && (options?.method ?? "GET") === "GET") {
      return Promise.resolve({ items: threads, next_cursor: null });
    }
    if (options?.method === "DELETE") return Promise.resolve(undefined);
    return Promise.resolve(written);
  });
}

beforeEach(() => {
  currentUser = me();
  isLoading = false;
  respondWith([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CommentSection", () => {
  it("loads the thread for its review", async () => {
    render(<CommentSection reviewId="r1" />);

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/comments?limit=20"),
    );
  });

  it("lists what people said", async () => {
    respondWith([thread(), thread({ id: "c2", text: "Same." })]);
    render(<CommentSection reviewId="r1" />);

    const list = await screen.findByLabelText("Comments");
    expect(within(list).getByText("Astonishing.")).toBeInTheDocument();
    expect(within(list).getByText("Same.")).toBeInTheDocument();
  });

  it("nests a reply under the comment it answers", async () => {
    respondWith([
      thread({
        replies: [comment({ id: "c2", parent_comment_id: "c1", text: "Agreed." })],
      }),
    ]);
    render(<CommentSection reviewId="r1" />);

    const replies = await screen.findByLabelText("Replies to hicks");
    expect(within(replies).getByText("Agreed.")).toBeInTheDocument();
  });

  it("says so when nobody has commented", async () => {
    render(<CommentSection reviewId="r1" />);

    expect(await screen.findByText(/No comments yet/)).toBeInTheDocument();
  });

  it("posts a comment", async () => {
    render(<CommentSection reviewId="r1" />);

    await userEvent.type(await screen.findByLabelText("Add a comment"), "Astonishing.");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/comments", {
      method: "POST",
      body: { text: "Astonishing." },
    });
  });

  it("shows the new comment without re-reading the list", async () => {
    respondWith([], comment({ id: "new", text: "Astonishing." }));
    render(<CommentSection reviewId="r1" />);

    await userEvent.type(await screen.findByLabelText("Add a comment"), "Astonishing.");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByLabelText("Comments")).toHaveTextContent("Astonishing.");
    expect(authedRequest.mock.calls.filter(([path]) => path.includes("?limit="))).toHaveLength(1);
  });

  it("tells its owner the count moved", async () => {
    const onCountChange = vi.fn();
    render(<CommentSection reviewId="r1" onCountChange={onCountChange} />);

    await userEvent.type(await screen.findByLabelText("Add a comment"), "Hi");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(1));
  });

  it("refuses an empty comment without asking the server", async () => {
    render(<CommentSection reviewId="r1" />);

    await screen.findByLabelText("Add a comment");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/write something/i);
    expect(authedRequest).toHaveBeenCalledTimes(1); // the initial load, and nothing else
  });

  it("replies to a top-level comment", async () => {
    respondWith([thread()], comment({ id: "c2", parent_comment_id: "c1", text: "Agreed." }));
    render(<CommentSection reviewId="r1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Reply" }));
    await userEvent.type(screen.getByLabelText("Reply to hicks"), "Agreed.");
    await userEvent.click(screen.getByRole("button", { name: "Post reply" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/comments", {
        method: "POST",
        body: { text: "Agreed.", parent_comment_id: "c1" },
      }),
    );
  });

  it("offers no reply on a reply, because the API would refuse it", async () => {
    // SPEC §6.10 allows one level. The screen cannot produce a request the
    // server will not take.
    respondWith([
      thread({
        replies: [comment({ id: "c2", parent_comment_id: "c1", text: "Agreed." })],
      }),
    ]);
    render(<CommentSection reviewId="r1" />);

    const replies = await screen.findByLabelText("Replies to hicks");
    expect(within(replies).queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
  });

  it("edits your own comment", async () => {
    respondWith([thread()], comment({ text: "Astounding.", edited: true }));
    render(<CommentSection reviewId="r1" />);

    await userEvent.click(await screen.findByRole("button", { name: /^Edit your comment/ }));
    const box = screen.getByLabelText("Edit your comment");
    await userEvent.clear(box);
    await userEvent.type(box, "Astounding.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/comments/c1", {
        method: "PATCH",
        body: { text: "Astounding." },
      }),
    );
    expect(await screen.findByText("Astounding.")).toBeInTheDocument();
  });

  it("marks an edited comment", async () => {
    respondWith([thread({ edited: true })]);
    render(<CommentSection reviewId="r1" />);

    expect(await screen.findByText("(edited)")).toBeInTheDocument();
  });

  it("deletes your own comment", async () => {
    const onCountChange = vi.fn();
    respondWith([thread()]);
    render(<CommentSection reviewId="r1" onCountChange={onCountChange} />);

    await userEvent.click(await screen.findByRole("button", { name: /^Delete your comment/ }));

    expect(authedRequest).toHaveBeenCalledWith("/comments/c1", { method: "DELETE" });
    await waitFor(() => expect(screen.queryByText("Astonishing.")).not.toBeInTheDocument());
  });

  it("counts the replies that go with a deleted comment", async () => {
    // The API cascades them; the footer has to agree.
    const onCountChange = vi.fn();
    respondWith([
      thread({
        replies: [
          comment({ id: "c2", parent_comment_id: "c1" }),
          comment({ id: "c3", parent_comment_id: "c1" }),
        ],
      }),
    ]);
    render(<CommentSection reviewId="r1" onCountChange={onCountChange} />);

    await userEvent.click(
      (await screen.findAllByRole("button", { name: /^Delete your comment/ }))[0],
    );

    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(-3));
  });

  it("offers no edit or delete on someone else's comment", async () => {
    currentUser = me("u9", "bishop");
    respondWith([thread()]);
    render(<CommentSection reviewId="r1" />);

    await screen.findByText("Astonishing.");
    expect(screen.queryByRole("button", { name: /^Edit your comment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete your comment/ })).not.toBeInTheDocument();
  });

  it("invites a signed-out reader to sign in instead of offering a box", async () => {
    currentUser = null;
    render(<CommentSection reviewId="r1" />);

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText("Add a comment")).not.toBeInTheDocument();
  });

  it("still shows a signed-out reader the conversation", async () => {
    currentUser = null;
    respondWith([thread()]);
    render(<CommentSection reviewId="r1" />);

    expect(await screen.findByText("Astonishing.")).toBeInTheDocument();
  });

  it("waits for the session before asking", async () => {
    isLoading = true;
    render(<CommentSection reviewId="r1" />);

    await settle();
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the server refuses it", async () => {
    authedRequest.mockImplementation((path: string, options?: { method?: string }) =>
      options?.method === "POST"
        ? Promise.reject(new ApiError("This account is private.", 403))
        : Promise.resolve({ items: [], next_cursor: null }),
    );
    render(<CommentSection reviewId="r1" />);

    await userEvent.type(await screen.findByLabelText("Add a comment"), "Let me in");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This account is private.");
    expect(screen.getByLabelText("Add a comment")).toHaveValue("Let me in");
  });

  it("explains a thread that would not load", async () => {
    authedRequest.mockRejectedValue(new ApiError("Can't reach the server.", 0));
    render(<CommentSection reviewId="r1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
