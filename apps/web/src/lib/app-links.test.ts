import { describe, expect, it } from "vitest";

import { androidAssetLinks, appleAppSiteAssociation } from "./app-links";

/**
 * The two association files, which nothing in a test run can exercise end to
 * end — the thing that reads them is an operating system fetching over HTTPS
 * from a real domain. So these pin the parts a typo would break silently: the
 * app identifier both platforms match on, the scoping, and the deliberate 404.
 *
 * The values are passed in rather than set on `process.env`, which keeps these
 * from racing each other under a parallel runner. The defaults are the
 * environment; the arguments exist for exactly this.
 */
describe("appleAppSiteAssociation", () => {
  it("is absent until a Team ID is configured", () => {
    // Absent beats wrong: Apple caches this through a CDN for up to a day, so a
    // file naming a placeholder team would outlive its own correction.
    expect(appleAppSiteAssociation(undefined)).toBeNull();
    expect(appleAppSiteAssociation("")).toBeNull();
    expect(appleAppSiteAssociation("   ")).toBeNull();
  });

  it("names the bundle identifier the app is actually built with", () => {
    // `TEAMID.bundleId`, and the bundle half has to match `ios.bundleIdentifier`
    // in apps/mobile/app.json or iOS associates the domain with nothing.
    const payload = appleAppSiteAssociation("ABCDE12345");

    expect(payload?.applinks.details[0].appIDs).toEqual(["ABCDE12345.app.sidequestd.client"]);
  });

  it("claims the reset path and nothing else", () => {
    // The scope of the whole feature. Widening this changes what happens when
    // somebody taps any Sidequestd link on a phone with the app installed, so it
    // is a line worth a test rather than a review comment.
    const components = appleAppSiteAssociation("ABCDE12345")?.applinks.details[0].components;

    expect(components).toHaveLength(1);
    expect(components?.[0]["/"]).toBe("/reset-password");
  });

  it("does not require the token to be present", () => {
    // A tokenless /reset-password should still open the app: the screen has a
    // branch that says the link is missing its token and offers a new one, which
    // is a better answer than bouncing that case to a browser.
    expect(
      appleAppSiteAssociation("ABCDE12345")?.applinks.details[0].components[0],
    ).not.toHaveProperty("?");
  });
});

describe("androidAssetLinks", () => {
  it("is absent until a fingerprint is configured", () => {
    expect(androidAssetLinks(undefined)).toBeNull();
    expect(androidAssetLinks("")).toBeNull();
    expect(androidAssetLinks(" , ,  ")).toBeNull();
  });

  it("carries every fingerprint it is given", () => {
    // Two is the normal case and shipping one is how this half silently
    // half-works: the upload key, and the key Play App Signing re-signs with —
    // which is the one a store install is verified against.
    const upload = "AA:BB:CC";
    const play = "DD:EE:FF";

    const target = androidAssetLinks(`${upload}, ${play}`)?.[0].target;

    expect(target?.sha256_cert_fingerprints).toEqual([upload, play]);
    expect(target?.package_name).toBe("app.sidequestd.client");
  });

  it("delegates the whole host, because Android has no other relation", () => {
    // The asymmetry with iOS, pinned so nobody "fixes" it into a path list.
    // Android scopes in the app's intent filter, not here.
    expect(androidAssetLinks("AA:BB:CC")?.[0].relation).toEqual([
      "delegate_permission/common.handle_all_urls",
    ]);
  });
});
