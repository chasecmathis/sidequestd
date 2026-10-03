"use client";

/** Profile picture, with a lettered fallback when there isn't one. */
import Image from "next/image";

import { cn } from "@/lib/cn";
import { avatarInitial } from "@sidequestd/core";
import type { UserPublic } from "@sidequestd/api-types";

type Subject = Pick<UserPublic, "username" | "display_name" | "avatar_url">;

export function Avatar({
  user,
  size = 96,
  className,
}: {
  user: Subject;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full border border-line bg-surface-2",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {user.avatar_url ? (
        <Image
          src={user.avatar_url}
          alt={`${user.display_name ?? user.username}'s profile picture`}
          fill
          sizes={`${size}px`}
          className="object-cover"
        />
      ) : (
        // The initial in the display serif rather than the UI sans: at avatar
        // sizes a single letter is a piece of lettering, not a label, and the
        // serif is the only face here with enough character to carry one.
        <span
          aria-hidden
          className="type-display flex h-full w-full items-center justify-center text-fg-faint"
          style={{ fontSize: size / 2.2 }}
        >
          {avatarInitial(user)}
        </span>
      )}
    </div>
  );
}
