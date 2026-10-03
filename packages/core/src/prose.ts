/**
 * Long-form copy, as data rather than as markup.
 *
 * `index.ts` opens by saying nothing that renders belongs in this package, and
 * this module does not break that rule — there is not an element in it. What is
 * here is the *text*, and the handful of distinctions a paragraph of it needs to
 * make: this bit is emphasised, that bit is a link, these five are a list. Each
 * client owns the rendering, which on one platform is a `<p>` and on the other a
 * `<Text>`.
 *
 * ## Why this exists at all
 *
 * The privacy policy and the terms are the only documents in this repo where two
 * clients disagreeing is a *correctness* problem rather than an inconsistency.
 * A phone that promises camera metadata is stripped while the web promises
 * something narrower is not two versions of a page; it is one of them being
 * wrong, in the one place being wrong is expensive. `apps/mobile` needed those
 * screens, and the alternative to this module was six hundred lines of legal
 * prose typed out a second time with nothing to notice when the copies drifted.
 *
 * The same argument is already made elsewhere in the tree for a much weaker
 * case: `_PHRASES` in `apps/api/app/services/push.py` is a second copy of a
 * notification's wording, and it is cross-referenced in both directions and
 * pinned by a test because the two must not diverge. A push saying "liked" where
 * a list row says "commented" is a confusing minute. A policy saying two
 * different things is a promise broken on one of the platforms.
 *
 * ## What is deliberately not shared
 *
 * Layout. The About page's five-step band is a numbered editorial list against a
 * 1024px measure on the web and a stack of rules on a 390pt screen; the policy
 * documents have a header, a "last updated" line and a measure that each client
 * sets for itself. Only the sentences are here.
 *
 * And nesting. `Inline` is flat on purpose — no `strong` wrapping a link
 * wrapping an `em` — because a tree needs a recursive renderer on both sides and
 * the documents never went more than one level deep. The one place the web's
 * markup did (an emphasised link followed by emphasised text) flattens into two
 * runs that render identically.
 */

/**
 * A run of text inside a paragraph or a list item.
 *
 * A bare string is the common case and stays a bare string, so the content
 * modules read as prose rather than as an object graph.
 */
export type Inline =
  | string
  | {
      text: string;
      /** Semantic emphasis — the sentence a skimming reader must not miss. */
      strong?: boolean;
      /** The other kind of emphasis: a word being *used* rather than stressed. */
      em?: boolean;
      /** `mailto:`, an absolute `https://`, or an in-app path beginning `/`. */
      href?: string;
    };

export type Block =
  /** `level` is 2 or 3 because a document's own `<h1>` is the page header's. */
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; items: Inline[][] };

/** A document with a header of its own: the two policies. */
export interface ProseDocument {
  eyebrow: string;
  title: string;
  description: string;
  blocks: Block[];
}

/* The builders below exist so the content modules read like the JSX they
 * replaced. `p("You keep ", b("full ownership"), " of your reviews.")` is the
 * shape of the sentence; the object literal for the same thing is not. */

export const h2 = (text: string): Block => ({ kind: "heading", level: 2, text });
export const h3 = (text: string): Block => ({ kind: "heading", level: 3, text });
export const p = (...content: Inline[]): Block => ({ kind: "paragraph", content });
export const ul = (...items: Inline[][]): Block => ({ kind: "list", items });

export const b = (text: string): Inline => ({ text, strong: true });
export const em = (text: string): Inline => ({ text, em: true });
export const a = (text: string, href: string): Inline => ({ text, href });

/** A link that is also emphasised, which flat `Inline` cannot express by nesting. */
export const strongLink = (text: string, href: string): Inline => ({ text, href, strong: true });

/** `hello@sidequestd.app` as both the label and the destination, which is how it always appears. */
export const mail = (address: string): Inline => a(address, `mailto:${address}`);

/**
 * What a client has to do with an `href`, decided in one place.
 *
 * The three cases behave differently enough on a phone that guessing per call
 * site would go wrong: a `mailto:` hands off to the mail app, an outside address
 * opens a browser over this app, and an in-app path is a push onto the
 * navigator. The web collapses all three onto `<a>` and only distinguishes them
 * to decide `target`, which is why this rule was previously invisible.
 */
export type LinkKind = "email" | "external" | "internal";

export function linkKind(href: string): LinkKind {
  if (href.startsWith("mailto:")) return "email";
  if (href.startsWith("/")) return "internal";
  return "external";
}

/**
 * A block's text with every distinction thrown away.
 *
 * For the things that want a string rather than a rendering: a page's
 * description, a test asserting a claim survived an edit, a search index if
 * there is ever one.
 */
export function blockText(block: Block): string {
  switch (block.kind) {
    case "heading":
      return block.text;
    case "paragraph":
      return inlineText(block.content);
    case "list":
      return block.items.map(inlineText).join(" ");
  }
}

export function inlineText(content: Inline[]): string {
  return content.map((run) => (typeof run === "string" ? run : run.text)).join("");
}

/** Every word in a document, for the assertions that have to read across blocks. */
export function documentText(blocks: Block[]): string {
  return blocks.map(blockText).join(" ");
}
