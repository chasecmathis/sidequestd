/**
 * The web half of `@sidequestd/core`'s prose model.
 *
 * The About page and both policy documents used to be written as JSX directly
 * inside their `page.tsx` files. The words moved into the shared package when
 * the phone grew the same three screens — `prose.ts` there has the argument, and
 * the short version is that a privacy policy which says two different things on
 * two clients is not two pages, it is one of them being wrong.
 *
 * What is left here is the rendering, and it is deliberately the *same* markup
 * those pages emitted before the move: bare `<h2>`, `<h3>`, `<p>`, `<ul>` and
 * `<li>`, styled by whichever container they land in. `prose-legal` in
 * `globals.css` selects on descendants, so the policy pages get their measure,
 * their serif headings and their leading without a class appearing in this file
 * — and About's intro paragraphs inherit their own container's type instead.
 * That is what makes one renderer serve both without a variant prop.
 *
 * No `"use client"`. There is not a hook or a handler in it, and all three pages
 * that render it are server components that export `metadata`.
 */
import Link from "next/link";

import { linkKind, type Block, type Inline } from "@sidequestd/core";

/**
 * One run of text.
 *
 * `Inline` is flat — no nesting — so a run carries at most a link, an emphasis
 * and a stress, and the order they wrap in here is fixed rather than derived.
 * The one place the original markup nested (`<strong>` around a link) is two
 * adjacent emphasised runs in the model and renders identically.
 */
function Run({ run }: { run: Inline }) {
  if (typeof run === "string") return run;

  let node: React.ReactNode = run.text;

  if (run.href) {
    const kind = linkKind(run.href);

    node =
      kind === "internal" ? (
        <Link href={run.href}>{node}</Link>
      ) : (
        // `noreferrer` on the outside links for the reason it is everywhere else
        // in this app: an outbound click should not hand the destination the
        // page somebody was reading when they made it.
        <a
          href={run.href}
          {...(kind === "external" ? { target: "_blank", rel: "noreferrer" } : {})}
        >
          {node}
        </a>
      );
  }

  if (run.em) node = <em>{node}</em>;
  if (run.strong) node = <strong>{node}</strong>;

  return node;
}

function Runs({ content }: { content: Inline[] }) {
  return content.map((run, index) => <Run key={index} run={run} />);
}

/**
 * A document's blocks, as elements.
 *
 * Keyed by index, which is the one place that is safe: these lists are module
 * constants and nothing reorders, filters or appends to them at runtime.
 */
export function Prose({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case "heading":
        // The level is in the model rather than inferred, because it is what
        // makes the document outline — and a screen reader's heading list —
        // match the shape a sighted reader sees.
        return block.level === 2 ? (
          <h2 key={index}>{block.text}</h2>
        ) : (
          <h3 key={index}>{block.text}</h3>
        );

      case "paragraph":
        return (
          <p key={index}>
            <Runs content={block.content} />
          </p>
        );

      case "list":
        return (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Runs content={item} />
              </li>
            ))}
          </ul>
        );
    }
  });
}
