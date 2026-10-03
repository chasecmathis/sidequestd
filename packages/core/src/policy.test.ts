/**
 * The claims that have to survive an edit.
 *
 * These claims are also asserted in `apps/web/src/app/privacy/page.test.tsx` and
 * `terms/page.test.tsx`, and that is not a duplicate. Those tests render a React
 * page and read the DOM, so they answer "does the renderer still carry this
 * claim through to a reader"; this file answers "is the claim still in the
 * document at all". The two fail for different reasons, and both are worth
 * knowing about separately — a `<Prose>` that quietly dropped every `<strong>`
 * would keep every assertion below green.
 *
 * What is genuinely new here is the *scope*. A claim asserted against a page
 * held only for the platform that happened to have a test; asserted against the
 * document it holds for every client that renders it. The phone renders these
 * same blocks, and there is nothing it can do to make the assertions below
 * false — which is the property that made moving the words here worth doing.
 *
 * Deliberately not asserting on wording in general. A test that has to be edited
 * every time a sentence is tuned is a test that gets deleted rather than
 * maintained. Everything below is a promise to a reader that some *other* file
 * could quietly falsify — the media pipeline, the absence of an ad network, a
 * §512 requirement — which is exactly the set worth pinning.
 */
import { describe, expect, it } from "vitest";

import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./policy";
import { blockText, documentText, inlineText, linkKind, type Block } from "./prose";

const privacy = documentText(PRIVACY_POLICY.blocks);
const terms = documentText(TERMS_OF_SERVICE.blocks);

/** Every heading in a document, at either level. */
function headings(blocks: Block[]): string[] {
  return blocks.filter((block) => block.kind === "heading").map((block) => block.text);
}

/** Every `href` a document links to, in order. */
function links(blocks: Block[]): string[] {
  const found: string[] = [];

  for (const block of blocks) {
    const runs = block.kind === "paragraph" ? [block.content] : block.kind === "list" ? block.items : [];
    for (const run of runs) {
      for (const inline of run) {
        if (typeof inline !== "string" && inline.href) found.push(inline.href);
      }
    }
  }

  return found;
}

describe("the privacy policy", () => {
  it("states that camera metadata is stripped before storage", () => {
    // Backed by `strip_metadata` on both upload paths in the API
    // (apps/api/app/services/media.py, covered by test_media_pipeline.py). If
    // that ever stops running, this promise becomes false and has to be
    // rewritten — which is the whole reason it is asserted rather than left to
    // drift.
    expect(headings(PRIVACY_POLICY.blocks)).toContain("Photos, clips, and camera metadata");
    expect(privacy).toMatch(/removes all of it before your file is stored/i);
  });

  it("states that personal information is not sold or shared", () => {
    // "Sell" and "share" are the CCPA/CPRA terms of art, not loose synonyms — a
    // reader (or a regulator) looking for this claim looks for those words.
    expect(privacy).toMatch(/does not sell your personal information, and does not share it/i);
  });

  it("names no infrastructure vendors", () => {
    // The policy discloses the *categories* of provider that handle your data,
    // which is what the disclosure obligations ask for, but deliberately not
    // which companies they are — that is reconnaissance for whoever is probing
    // the service and of no use to a reader. Easy to undo by accident while
    // making the section more specific, so it is asserted rather than trusted.
    expect(privacy).not.toMatch(/fly\.io|amazon|aws|\bs3\b|smtp|postgres/i);
  });

  it("discloses the push service, which only exists because of the phone", () => {
    // The mobile client sends a notification's text and a device address through
    // a third-party push service. That is a data flow the web client does not
    // have, and a policy written before the phone existed did not mention it.
    expect(privacy).toMatch(/push service/i);
  });

  it("says how to get an account deleted", () => {
    expect(headings(PRIVACY_POLICY.blocks)).toContain("Deleting your account");
    expect(links(PRIVACY_POLICY.blocks)).toContain("mailto:hello@sidequestd.app");
  });
});

describe("the terms of service", () => {
  it("states that members keep ownership of what they post", () => {
    expect(headings(TERMS_OF_SERVICE.blocks)).toContain("4. What you post stays yours");
    expect(terms).toMatch(/You keep full ownership of your reviews, comments, photos and clips\./i);
  });

  it("names a jurisdiction rather than a placeholder", () => {
    expect(terms).toMatch(/State of Minnesota, United States/);
    expect(terms).not.toMatch(/\[.*to be specified\]/i);
  });

  it("carries a DMCA procedure rather than an informal one", () => {
    // Safe harbor under §512 needs all three of these. Any one of them going
    // missing forfeits it, and losing one to an edit would be silent otherwise.
    expect(headings(TERMS_OF_SERVICE.blocks)).toContain("8. Copyright complaints");
    expect(headings(TERMS_OF_SERVICE.blocks)).toContain("Repeat infringers");
    expect(terms).toMatch(/Digital Millennium Copyright Act/);
    expect(terms).toMatch(/counter-notice to the same address/i);
  });

  it("keeps a forum open to individuals alongside the class-action waiver", () => {
    // The waiver is the point of §14, but shipping it *without* the small-claims
    // carve-out is the version that reads as leaving members no forum at all —
    // and is the more likely half to be lost in an edit.
    expect(terms).toMatch(/class, consolidated or representative action/i);
    expect(terms).toMatch(/Small claims court is still open to you\./);
  });

  it("keeps sections 1 to 7 on the numbers they shipped with", () => {
    // Renumbering a published document breaks every link anyone has made to a
    // clause, and §8, §11 and §15 were inserted after the fact precisely so this
    // stayed true. See the module header.
    const numbered = headings(TERMS_OF_SERVICE.blocks).filter((text) => /^\d+\./.test(text));
    expect(numbered.slice(0, 7)).toEqual([
      "1. Accepting these terms",
      "2. Who can use it",
      "3. Your account",
      "4. What you post stays yours",
      "5. How to behave",
      "6. Game data belongs to IGDB",
      "7. Moderation and ending an account",
    ]);
  });
});

describe("both documents", () => {
  it("open with a heading rather than with prose", () => {
    // Each client sets its own page header above these blocks. A document whose
    // first block were a paragraph would put an unlabelled wall of text directly
    // under that header on both platforms.
    for (const document of [PRIVACY_POLICY, TERMS_OF_SERVICE]) {
      expect(document.blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    }
  });

  it("link only to destinations both clients can reach", () => {
    // `linkKind` is what each renderer branches on, and the three kinds behave
    // very differently on a phone. An in-app path that no route answers is a
    // dead tap there and a 404 on the web, so the internal ones are enumerated.
    for (const href of [...links(PRIVACY_POLICY.blocks), ...links(TERMS_OF_SERVICE.blocks)]) {
      const kind = linkKind(href);
      if (kind === "internal") expect(["/privacy", "/terms", "/about"]).toContain(href);
      if (kind === "external") expect(href).toMatch(/^https:\/\//);
      if (kind === "email") expect(href).toBe("mailto:hello@sidequestd.app");
    }
  });

  it("flatten to text without losing the words inside a run", () => {
    // `blockText` is what the assertions above read, so a bug in it would make
    // every one of them vacuous. A list item whose emphasis is a separate run is
    // the case that would go missing.
    const owned = TERMS_OF_SERVICE.blocks.find(
      (block) => block.kind === "paragraph" && inlineText(block.content).startsWith("You keep full"),
    );

    expect(owned && blockText(owned)).toMatch(/^You keep full ownership .* license it to anyone else\.$/);
  });
});
