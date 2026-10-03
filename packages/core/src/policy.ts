/**
 * The privacy policy and the terms of service.
 *
 * Both were written against what the code actually does rather than against
 * what a template says a policy should claim, and both are now read by two
 * clients — see `prose.ts` for why the words live here rather than in a page.
 *
 * ## What has to stay true in the privacy policy
 *
 *   * **Metadata is stripped, and the document only says so because it is.**
 *     `strip_metadata` in `apps/api/app/services/media.py` runs on both upload
 *     paths — review media and avatars — before anything reaches the bucket, and
 *     `app.cli.strip_media_metadata` cleaned what was already there. An earlier
 *     draft had to warn members that originals kept their EXIF, because at the
 *     time they did. If that pipeline ever changes, this section changes back.
 *   * **Cover art is hotlinked.** Images load on the reader's own device
 *     straight from IGDB's CDN, which means IGDB sees an IP address we never
 *     send them. Easy to omit; worth saying.
 *   * **Every claim under "Keeping it secure" is one the code makes good on** —
 *     password hashing, server-side visibility checks, refresh-token rotation
 *     with family revocation on reuse. Nothing aspirational goes in that
 *     section; a security promise is the one kind that gets read back to you.
 *
 * **No vendor names, deliberately.** Which host, object store or mail provider
 * sits behind the service is not something a reader needs and not something
 * worth handing to whoever is probing it. The section names categories instead,
 * which is what the disclosure obligations actually ask for. `policy.test.ts`
 * guards this with a regex over the document's own text, which is a stronger
 * place for that guard than the web page it used to live on — it now holds for
 * every client rather than for the one that happened to have a test.
 *
 * ## What has to stay true in the terms
 *
 * The ownership section is placed early and stated plainly on purpose. "Who owns
 * what I wrote" is the only question in a document like this that most people
 * actually want answered, and burying it under nine headings of boilerplate is
 * how these documents earn their reputation.
 *
 * Two things about the numbering, since it looks arbitrary and is not:
 *
 *   * Sections **8 (copyright)**, **11 (indemnity)** and **15 (general)** were
 *     inserted after the first draft. They land where they do so that **1–7 keep
 *     the numbers they shipped with** — §4 in particular, which the tests assert
 *     by name. Renumbering a published document also breaks any link anyone has
 *     made to a clause.
 *   * §8 is a real DMCA procedure rather than "email us a link", because §512
 *     safe harbor needs all three of a conforming notice path, a counter-notice
 *     path, and a repeat-infringer policy. **It only protects the operator once a
 *     designated agent is registered with the U.S. Copyright Office** — that
 *     registration is not something this file can do.
 *
 * §14 names Minnesota. The dispute clause pairs a class-action waiver with an
 * explicit small-claims carve-out: the waiver is the point, and the carve-out is
 * what keeps it from reading as an attempt to leave members with no forum at all.
 *
 * ## The four sentences that changed when the phone arrived
 *
 * The originals said "your browser" in four places, which was accurate while
 * there was only one client and became false the moment there were two. They now
 * say device, or name both. Nothing else about those sentences moved — a policy
 * that describes a client the reader is not using is the same failure as one
 * that describes behaviour the app does not have.
 */
import { a, b, em, h2, h3, mail, p, strongLink, ul, type ProseDocument } from "./prose";
import { CONTACT_EMAIL, IGDB_URL, SITE_NAME } from "./site";

export const PRIVACY_POLICY: ProseDocument = {
  eyebrow: "Privacy",
  title: "Privacy policy",
  description: `How ${SITE_NAME} handles your account, your writing, and the photos you upload.`,
  blocks: [
    h2("The short version"),
    p(
      `${SITE_NAME} stores the things you deliberately put into it — your account, your reviews, your lists, your photos — plus the minimum needed to keep the service running and secure. There are no advertisers, no analytics trackers, and nothing is sold. If you want your account and its contents gone, email us and they will be.`,
    ),
    p(
      "The rest of this page is the detail behind those sentences. It describes what the software does today, not what it might do later — if the behaviour changes, this page changes with it.",
    ),

    h2("Who runs this"),
    p(
      `${SITE_NAME} is an independent project, not a company. It is operated from the United States, and using it means your information is handled there — including if you are somewhere with stronger local protections, which continue to apply to you regardless.`,
    ),
    p(
      "Questions about privacy, requests for your data, and account deletions all go to the same place: ",
      mail(CONTACT_EMAIL),
      ".",
    ),

    h2("What is collected"),

    h3("Your account"),
    ul(
      [
        b("Email address."),
        " Used to sign in, to reset a password, and to reach you about your account. It is never shown on your profile or to other members.",
      ],
      [
        b("Username, display name, bio and avatar."),
        " These are the public parts of a profile — visible to anyone who can see your account under the visibility rules below.",
      ],
      [
        b("Password."),
        " Stored only as a cryptographic hash. It is never stored in a readable form and cannot be recovered, only reset.",
      ],
    ),

    h3("What you write and upload"),
    ul(
      ["Reviews: the rating, the text, and the playtime if you record one."],
      ["Photos and video clips attached to reviews, and the thumbnails generated from them."],
      ["Comments and replies, and which reviews you have liked."],
      ["Your four backlog lists, your favourite games, and the pinned games on your profile."],
    ),

    h3("Your connections"),
    p("Who you follow, who follows you, and any pending follow requests in either direction."),

    h3("Technical records"),
    p(
      "Ordinary server logs, which include IP addresses and browser or app user-agent strings. Your IP address is also used to enforce rate limits on sign-in, password reset and search, which is what stops those endpoints from being brute-forced. These records exist for security and reliability, and are not used to build a profile of you.",
    ),

    h2("What is not collected"),
    ul(
      ["No advertising networks and no ad targeting."],
      ["No third-party analytics or behavioural tracking scripts."],
      ["No selling, renting or sharing of personal data with data brokers or advertisers."],
      ["No tracking of you across other websites or apps."],
    ),

    h2("Photos, clips, and camera metadata"),
    p(
      "Files from a camera or phone carry more than the picture. Photos embed EXIF data — the date and time, the device make and model, camera settings, and, if location services were on, ",
      b("the GPS coordinates the photo was taken at"),
      ". Video files keep the same things in their own container.",
    ),
    p(
      b(`${SITE_NAME} removes all of it before your file is stored.`),
      " Photos are re-encoded without their metadata, and clips have their location and device atoms blanked out. This happens on the way into storage, so the version we keep — the one anyone else could ever download — has never carried it. It applies to review photos, review clips, and profile pictures alike.",
    ),
    p(
      "Two honest caveats. Rotation is the one piece of that data we act on before discarding it, so a photo taken sideways still appears the right way up. And anything visible ",
      em("in"),
      " the image — a street sign behind you, a name in a screenshot — is content rather than metadata, and is published exactly as you uploaded it.",
    ),
    p(
      "Uploads are checked by their actual file contents rather than by the name or content type your device claims, and every stored file is given a server-generated name, so an upload cannot overwrite anyone else's.",
    ),

    h2("Who can see what"),
    p("Every account is either public or private, and you can change this at any time."),
    ul(
      [
        b("Public."),
        " Your profile, reviews, stats and lists can be seen by anyone, including people who are not signed in. Anyone can follow you without asking.",
      ],
      [
        b("Private."),
        " Your profile still appears in search so that people can find and request to follow you, but your reviews, stats and lists are visible only to followers you have approved. New followers must send a request that you accept or decline.",
      ],
    ),
    p(
      "This is enforced on the server, on every request that returns content — not merely hidden in the interface. Changing to private applies immediately to everything you have already posted.",
    ),
    p(
      "Two things are worth being clear about. Anyone who can see your content can copy it, and no privacy setting prevents that. And removing a follower stops future access, but not what they have already read.",
    ),

    h2("Service providers"),
    p(
      `Running ${SITE_NAME} means a small number of outside companies necessarily handle some of your data. They act on our instructions, for the purpose described, and for nothing else. None of them is permitted to use your data for their own ends.`,
    ),
    ul(
      [
        b("Infrastructure."),
        " The application, its database and the files you upload run on third-party hosting and storage providers.",
      ],
      [
        b("Email delivery."),
        " Account email — password resets and similar — is sent through a third-party delivery provider, which handles your email address in order to deliver the message.",
      ],
      [
        b("Push notifications."),
        " If you use the mobile app and allow notifications, the message is delivered through the push service run by the app platform, which handles the notification's text and your device's push address in order to deliver it.",
      ],
    ),
    p(
      "One outside service is worth describing separately, because it sees something we never send it:",
    ),
    ul([
      strongLink("IGDB", IGDB_URL),
      b(" (via Twitch)."),
      " The games catalog is imported from IGDB on a schedule, and no personal data is sent to them as part of that. However, game cover images are loaded by your browser or the app directly from IGDB's image servers, which means those servers see your IP address and user-agent whenever a cover renders, exactly as any third-party image on any website would.",
    ]),

    h2("Cookies and sessions"),
    p(
      `${SITE_NAME} uses authentication tokens to keep you signed in and to refresh that session as it expires. On the web those travel in cookies; in the mobile app they are held in the operating system's own encrypted store. That is the extent of it: there are no advertising cookies and no analytics cookies. Signing out invalidates the session.`,
    ),
    p(
      "Because nothing here tracks you in the first place, a “Do Not Track” signal from your browser has nothing to switch off. There is no behaviour to opt out of.",
    ),

    h2("Keeping it secure"),
    p("Concretely, and only what is actually true:"),
    ul(
      [
        "Passwords are stored as cryptographic hashes and never in a form anyone — including us — could read.",
      ],
      ["Traffic between your device and the service travels over an encrypted connection."],
      [
        "Sessions use short-lived tokens that rotate as they refresh. Presenting a token that has already been used invalidates the whole chain and forces a fresh sign-in, which is what limits the damage a stolen token can do.",
      ],
      [
        "Sign-in, password reset and search are rate limited per IP address, which is what stops passwords being guessed at scale and the member directory being harvested.",
      ],
      [
        "Every request that returns someone's content re-checks who is allowed to see it on the server, rather than relying on the interface to hide it.",
      ],
    ),
    p(
      "None of this makes any service invulnerable, and nobody honest claims otherwise. If something does go wrong in a way that affects your data, we will tell you.",
    ),

    h2("How long things are kept"),
    p(
      "Your account and its contents are kept for as long as the account exists. Deleting a review, comment or list entry removes it. Server logs are short-lived and rotate in the ordinary course of running the service.",
    ),

    h2("Deleting your account"),
    p(
      "You can have your account deleted by emailing ",
      mail(CONTACT_EMAIL),
      " from the address on the account. Deletion removes or anonymises your personal data: profile, email address, reviews, comments, likes, lists, uploaded media, and your follow relationships. Requests are acted on within 30 days.",
    ),
    p(
      "Backups are retained for a short period for disaster recovery, so a copy may persist there briefly after deletion before ageing out.",
    ),

    h2("Your rights"),
    p(
      "Wherever you live, you can ask for a copy of the data held about you, ask for something inaccurate to be corrected, or ask for your data to be deleted. Email ",
      mail(CONTACT_EMAIL),
      ` from the address on your account and we will act on it. You will not be charged for asking, and you will not get a worse version of ${SITE_NAME} for having asked.`,
    ),

    h3("If you are in the United States"),
    p(
      "California and a growing number of other states give residents specific rights over their personal information. The most important one is the easiest to state: ",
      b(
        `${SITE_NAME} does not sell your personal information, and does not share it for cross-context behavioural advertising.`,
      ),
      " There is no such arrangement to opt out of, because there is no advertising here at all.",
    ),
    p("Beyond that, you have the right to:"),
    ul(
      ["Know what personal information is held about you and where it came from."],
      ["Get a copy of it."],
      ["Have it corrected if it is wrong."],
      ["Have it deleted."],
      ["Not be discriminated against for exercising any of these."],
    ),
    p(
      "If someone is authorised to make a request on your behalf, we may need to confirm that with you before acting on it.",
    ),

    h3("If you are in the UK or the European Economic Area"),
    p(
      "You have the rights above, and in addition the right to object to or restrict certain processing, the right to receive your data in a portable form, and the right to complain to your local data protection authority. Your data is processed in order to provide a service you asked for, and on the basis of our legitimate interest in keeping that service running and secure.",
    ),

    h2("Children"),
    p(
      `${SITE_NAME} is not intended for children under 13, and under 16 in the European Economic Area. It is not directed at children, and information is not knowingly collected from them. Accounts belonging to anyone younger will be removed when identified — if you believe a child has created one, email `,
      mail(CONTACT_EMAIL),
      " and it will be handled.",
    ),

    h2("Changes to this policy"),
    p(
      "When this policy changes, the date at the top of the page changes with it. For a change that materially affects how your data is handled, we will give notice in the app rather than relying on you to re-read this page.",
    ),
  ],
};

export const TERMS_OF_SERVICE: ProseDocument = {
  eyebrow: "Terms",
  title: "Terms of service",
  description: `The agreement between you and ${SITE_NAME}. Short, and worth reading once.`,
  blocks: [
    h2("The short version"),
    p(
      `You keep ownership of everything you write and upload. Be decent to other people. Do not post things you have no right to post. ${SITE_NAME} is an independent project run without guarantees, so keep your own copy of anything you would hate to lose.`,
    ),
    p(
      `Two things below are worth knowing before you agree rather than after: section 10 caps what ${SITE_NAME} could ever owe you, and section 14 says disputes are brought individually rather than as a class action. Small claims court stays open to you either way.`,
    ),

    h2("1. Accepting these terms"),
    p(
      `By creating an account or using ${SITE_NAME}, you agree to these terms. If you do not agree with them, please do not use the service.`,
    ),
    p(
      `${SITE_NAME} is an independent project, not a company, and is provided as-is. There is no paid tier, no service level agreement, and no commitment that the service will continue to exist.`,
    ),

    h2("2. Who can use it"),
    p(
      "You must be at least 13 years old, or at least 16 if you are in the European Economic Area. If you are under the age of majority where you live, you should have a parent or guardian's permission.",
    ),

    h2("3. Your account"),
    ul(
      ["Give accurate registration details and keep your email address current."],
      [
        "Keep your password to yourself. Anything done through your account is your responsibility.",
      ],
      [
        "Tell us at ",
        mail(CONTACT_EMAIL),
        " if you believe your account has been accessed by someone else.",
      ],
      ["Do not impersonate another person or misrepresent your association with anyone."],
    ),

    h2("4. What you post stays yours"),
    p(
      b("You keep full ownership of your reviews, comments, photos and clips."),
      ` Nothing here transfers your copyright, and ${SITE_NAME} will not sell your content or license it to anyone else.`,
    ),
    p(
      `To actually show your work to the people you intend to show it to, we need your permission to handle it. So you grant ${SITE_NAME} a non-exclusive, worldwide, royalty-free licence to store, reproduce, resize and display your content `,
      b("within the service"),
      `, and only to the audience your privacy settings allow. That licence exists for the purpose of operating ${SITE_NAME} and for no other.`,
    ),
    p(
      "When you delete content, or delete your account, that licence ends and the content is removed. Copies may remain briefly in backups before they age out, and we cannot recall anything another member has already seen or saved.",
    ),
    p(
      "You are responsible for having the right to post what you post — that includes screenshots and clips, which are generally fine to share as commentary but remain subject to the rights of the game's publisher.",
    ),

    h2("5. How to behave"),
    p(`Do not use ${SITE_NAME} to:`),
    ul(
      ["Harass, threaten, bully or incite violence against anyone."],
      [
        "Post hate speech, or attack people on the basis of race, ethnicity, national origin, religion, disability, gender, gender identity, sexual orientation, or age.",
      ],
      [
        "Post sexual content involving minors, of any kind, under any pretext. This results in an immediate and permanent ban and a report to the authorities.",
      ],
      [
        "Post another person's private information — a home address, a phone number, a workplace, a real name they do not use here — without their permission.",
      ],
      ["Post spam, scams, malware, or bulk unsolicited promotion."],
      ["Post content you have no right to post, or that infringes someone's copyright or trademark."],
      [
        "Scrape, crawl, or bulk-download the service, or hammer the API with automated requests.",
      ],
      [
        "Probe, breach, or circumvent security or authentication, or try to reach data that is not yours — in particular the content of private accounts.",
      ],
      ["Reverse engineer the service, except where the law expressly says you may."],
      ["Evade a ban, or run automated or fake accounts."],
    ),

    h2("6. Game data belongs to IGDB"),
    p(
      "Game titles, cover art, release dates, genres, platforms and ratings come from ",
      a("IGDB", IGDB_URL),
      ` and remain subject to IGDB's own terms. ${SITE_NAME} does not own that data and grants you no rights to it. ${SITE_NAME} is not affiliated with, endorsed by, or sponsored by IGDB or Twitch.`,
    ),
    p(
      "Game names, cover art and other trademarks belong to their respective publishers and appear here for identification and commentary.",
    ),

    h2("7. Moderation and ending an account"),
    p(
      "Content that breaks these terms may be removed, and accounts that break them may be suspended or deleted. Where it is reasonable to do so we will say why, but a serious or repeated violation may be acted on immediately.",
    ),
    p(
      "To report content or an account, email ",
      mail(CONTACT_EMAIL),
      " with a link. Copyright complaints have their own procedure, set out in the next section.",
    ),
    p(
      `You can stop using ${SITE_NAME} at any time and ask for your account to be deleted, as described in the `,
      a("privacy policy", "/privacy"),
      ". If your account ends — whether you closed it or we did — your content is removed and the licence in section 4 ends with it.",
    ),

    h2("8. Copyright complaints"),
    p(
      `${SITE_NAME} responds to notices of claimed copyright infringement under the Digital Millennium Copyright Act. If you own a work and believe something posted here infringes it, send a written notice to `,
      mail(CONTACT_EMAIL),
      " containing all of the following:",
    ),
    ul(
      [
        "Your physical or electronic signature, as the owner of the work or someone authorised to act for them.",
      ],
      [
        "Identification of the work you say has been infringed — or, if several are covered by one notice, a representative list.",
      ],
      ["The URL of the material you are complaining about, specific enough for us to find it."],
      ["Your name, postal address, telephone number and email address."],
      [
        "A statement that you have a good-faith belief that the use is not authorised by the owner, its agent, or the law.",
      ],
      [
        "A statement that the information in the notice is accurate, and ",
        b("under penalty of perjury"),
        " that you are the owner or authorised to act on their behalf.",
      ],
    ),
    p(
      "An incomplete notice may not be actionable. Please also be aware that misrepresenting material as infringing can make you liable for damages under section 512(f) of the Act, including costs and legal fees.",
    ),

    h3("If your content was removed and you believe that was wrong"),
    p(
      "You may send a counter-notice to the same address. It needs your signature, identification of what was removed and where it appeared, a statement ",
      b("under penalty of perjury"),
      ` that you have a good-faith belief it was removed by mistake or misidentification, your name, address and telephone number, and your consent to the jurisdiction of the federal court for your district — or, if you are outside the United States, for the district in which ${SITE_NAME} may be found. If we receive a valid counter-notice we may restore the material as the Act permits.`,
    ),

    h3("Repeat infringers"),
    p(
      "Accounts that repeatedly infringe the copyright of others are terminated. This is a standing policy, not a discretionary one.",
    ),

    h2("9. No warranty"),
    p(
      `${SITE_NAME} is provided “as is” and “as available”, without warranties of any kind, whether express, implied or statutory. `,
      b(
        "All implied warranties are disclaimed, including the implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement.",
      ),
      " There is no guarantee that it will be uninterrupted, free of errors, secure against every attack, or available in the future.",
    ),
    p(
      b("Keep your own copies of anything irreplaceable."),
      " Data loss should not happen, and it is not promised that it will not.",
    ),

    h2("10. Limitation of liability"),
    p(
      `To the fullest extent the law allows, ${SITE_NAME} and whoever operates it are not liable for any indirect, incidental, consequential or punitive damages, or for lost profits, lost data, or lost goodwill, arising from your use of the service.`,
    ),
    p(
      `Total liability for any claim relating to ${SITE_NAME}, taken together, will not exceed the greater of the amount you have paid to use it — which is nothing, as it is free — or one hundred US dollars.`,
    ),
    p(
      "Nothing here limits liability that cannot be limited by law, and some jurisdictions do not allow certain exclusions — in which case they simply do not apply to you.",
    ),

    h2("11. Indemnification"),
    p(
      `If someone brings a claim against ${SITE_NAME} because of what you posted, how you used the service, or a right you said you had and did not, you agree to cover the resulting claims, losses and reasonable legal costs. We will tell you about any such claim and will not settle it in a way that puts an obligation on you without asking first.`,
    ),

    h2("12. Content posted by other people"),
    p(
      `Reviews and comments are written by members, and their opinions are their own. ${SITE_NAME} does not endorse or verify what members post, and is not responsible for it.`,
    ),

    h2("13. Changes to these terms"),
    p(
      `These terms may change as the service does. The date at the top of the page changes with them, and material changes will be announced in the app. Continuing to use ${SITE_NAME} after a change means you accept the revised terms.`,
    ),

    h2("14. Governing law and disputes"),
    p(
      "These terms are governed by the laws of the ",
      b("State of Minnesota, United States"),
      `, without regard to its conflict-of-law rules. Any dispute that does go to court will be brought exclusively in the state or federal courts located in Minnesota, and both you and ${SITE_NAME} consent to the jurisdiction of those courts.`,
    ),
    p(
      b("Claims are brought individually."),
      ` You and ${SITE_NAME} each agree not to bring a claim as a plaintiff or class member in any class, consolidated or representative action, and no court may hear the claims of more than one person at once under these terms.`,
    ),
    p(
      b("Small claims court is still open to you."),
      " Either of us may bring a qualifying claim there instead, and nothing above is meant to take away the cheapest forum available to an individual.",
    ),
    p(
      "Before filing anything, please email ",
      mail(CONTACT_EMAIL),
      ". Most disagreements are settled faster by someone reading them than by anyone filing.",
    ),

    h2("15. General"),
    ul(
      [
        b("Severability."),
        " If a provision here is found unenforceable, it is limited or removed to the minimum extent necessary and the rest stays in force.",
      ],
      [
        b("No waiver."),
        " Not enforcing a provision on one occasion does not give it up on the next.",
      ],
      [
        b("Entire agreement."),
        " These terms and the ",
        a("privacy policy", "/privacy"),
        ` are the whole agreement between you and ${SITE_NAME}, and replace anything said before them.`,
      ],
      [
        b("Assignment."),
        ` You may not transfer your rights under these terms. ${SITE_NAME} may transfer them if the project changes hands, in which case this page will say so.`,
      ],
    ),

    h2("16. Contact"),
    p("Questions about these terms go to ", mail(CONTACT_EMAIL), "."),
  ],
};
