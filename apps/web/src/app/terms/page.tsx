/**
 * The terms of service.
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
 *     the numbers they shipped with** — §4 in particular, which `page.test.tsx`
 *     asserts by name. Renumbering a published document also breaks any link
 *     anyone has made to a clause.
 *   * §8 is a real DMCA procedure rather than "email us a link", because §512
 *     safe harbor needs all three of a conforming notice path, a counter-notice
 *     path, and a repeat-infringer policy. **It only protects the operator once a
 *     designated agent is registered with the U.S. Copyright Office** — that
 *     registration is not something this file can do.
 *
 * §14 names Minnesota. The dispute clause pairs a class-action waiver with an
 * explicit small-claims carve-out: the waiver is the point, and the carve-out is
 * what keeps it from reading as an attempt to leave members with no forum at all.
 */
import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { CONTACT_EMAIL, IGDB_URL, POLICY_UPDATED, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description: `The rules for using ${SITE_NAME}, and what happens to what you post.`,
};

export default function TermsPage() {
  return (
    <AppShell>
      <div className="max-w-2xl">
        <PageHeader
          eyebrow="Terms"
          title="Terms of service"
          description={`The agreement between you and ${SITE_NAME}. Short, and worth reading once.`}
        />

        <p className="type-eyebrow mt-8 text-fg-faint">Last updated {POLICY_UPDATED}</p>

        <div className="prose-legal mt-12">
          <h2>The short version</h2>
          <p>
            You keep ownership of everything you write and upload. Be decent to other people. Do not
            post things you have no right to post. {SITE_NAME} is an independent project run without
            guarantees, so keep your own copy of anything you would hate to lose.
          </p>
          <p>
            Two things below are worth knowing before you agree rather than after: section 10 caps
            what {SITE_NAME} could ever owe you, and section 14 says disputes are brought
            individually rather than as a class action. Small claims court stays open to you either
            way.
          </p>

          <h2>1. Accepting these terms</h2>
          <p>
            By creating an account or using {SITE_NAME}, you agree to these terms. If you do not
            agree with them, please do not use the service.
          </p>
          <p>
            {SITE_NAME} is an independent project, not a company, and is provided as-is. There is no
            paid tier, no service level agreement, and no commitment that the service will continue
            to exist.
          </p>

          <h2>2. Who can use it</h2>
          <p>
            You must be at least 13 years old, or at least 16 if you are in the European Economic
            Area. If you are under the age of majority where you live, you should have a parent or
            guardian&apos;s permission.
          </p>

          <h2>3. Your account</h2>
          <ul>
            <li>Give accurate registration details and keep your email address current.</li>
            <li>
              Keep your password to yourself. Anything done through your account is your
              responsibility.
            </li>
            <li>
              Tell us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you believe your
              account has been accessed by someone else.
            </li>
            <li>Do not impersonate another person or misrepresent your association with anyone.</li>
          </ul>

          <h2>4. What you post stays yours</h2>
          <p>
            <strong>You keep full ownership of your reviews, comments, photos and clips.</strong>{" "}
            Nothing here transfers your copyright, and {SITE_NAME} will not sell your content or
            license it to anyone else.
          </p>
          <p>
            To actually show your work to the people you intend to show it to, we need your
            permission to handle it. So you grant {SITE_NAME} a non-exclusive, worldwide,
            royalty-free licence to store, reproduce, resize and display your content{" "}
            <strong>within the service</strong>, and only to the audience your privacy settings
            allow. That licence exists for the purpose of operating {SITE_NAME} and for no other.
          </p>
          <p>
            When you delete content, or delete your account, that licence ends and the content is
            removed. Copies may remain briefly in backups before they age out, and we cannot recall
            anything another member has already seen or saved.
          </p>
          <p>
            You are responsible for having the right to post what you post — that includes
            screenshots and clips, which are generally fine to share as commentary but remain
            subject to the rights of the game&apos;s publisher.
          </p>

          <h2>5. How to behave</h2>
          <p>Do not use {SITE_NAME} to:</p>
          <ul>
            <li>Harass, threaten, bully or incite violence against anyone.</li>
            <li>
              Post hate speech, or attack people on the basis of race, ethnicity, national origin,
              religion, disability, gender, gender identity, sexual orientation, or age.
            </li>
            <li>
              Post sexual content involving minors, of any kind, under any pretext. This results in
              an immediate and permanent ban and a report to the authorities.
            </li>
            <li>
              Post another person&apos;s private information — a home address, a phone number, a
              workplace, a real name they do not use here — without their permission.
            </li>
            <li>Post spam, scams, malware, or bulk unsolicited promotion.</li>
            <li>
              Post content you have no right to post, or that infringes someone&apos;s copyright or
              trademark.
            </li>
            <li>
              Scrape, crawl, or bulk-download the service, or hammer the API with automated
              requests.
            </li>
            <li>
              Probe, breach, or circumvent security or authentication, or try to reach data that is
              not yours — in particular the content of private accounts.
            </li>
            <li>Reverse engineer the service, except where the law expressly says you may.</li>
            <li>Evade a ban, or run automated or fake accounts.</li>
          </ul>

          <h2>6. Game data belongs to IGDB</h2>
          <p>
            Game titles, cover art, release dates, genres, platforms and ratings come from{" "}
            <a href={IGDB_URL} target="_blank" rel="noreferrer">
              IGDB
            </a>{" "}
            and remain subject to IGDB&apos;s own terms. {SITE_NAME} does not own that data and
            grants you no rights to it. {SITE_NAME} is not affiliated with, endorsed by, or
            sponsored by IGDB or Twitch.
          </p>
          <p>
            Game names, cover art and other trademarks belong to their respective publishers and
            appear here for identification and commentary.
          </p>

          <h2>7. Moderation and ending an account</h2>
          <p>
            Content that breaks these terms may be removed, and accounts that break them may be
            suspended or deleted. Where it is reasonable to do so we will say why, but a serious or
            repeated violation may be acted on immediately.
          </p>
          <p>
            To report content or an account, email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with a link. Copyright
            complaints have their own procedure, set out in the next section.
          </p>
          <p>
            You can stop using {SITE_NAME} at any time and ask for your account to be deleted, as
            described in the <a href="/privacy">privacy policy</a>. If your account ends — whether
            you closed it or we did — your content is removed and the licence in section 4 ends with
            it.
          </p>

          <h2>8. Copyright complaints</h2>
          <p>
            {SITE_NAME} responds to notices of claimed copyright infringement under the Digital
            Millennium Copyright Act. If you own a work and believe something posted here infringes
            it, send a written notice to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{" "}
            containing all of the following:
          </p>
          <ul>
            <li>
              Your physical or electronic signature, as the owner of the work or someone authorised
              to act for them.
            </li>
            <li>
              Identification of the work you say has been infringed — or, if several are covered by
              one notice, a representative list.
            </li>
            <li>
              The URL of the material you are complaining about, specific enough for us to find it.
            </li>
            <li>Your name, postal address, telephone number and email address.</li>
            <li>
              A statement that you have a good-faith belief that the use is not authorised by the
              owner, its agent, or the law.
            </li>
            <li>
              A statement that the information in the notice is accurate, and{" "}
              <strong>under penalty of perjury</strong> that you are the owner or authorised to act
              on their behalf.
            </li>
          </ul>
          <p>
            An incomplete notice may not be actionable. Please also be aware that misrepresenting
            material as infringing can make you liable for damages under section 512(f) of the Act,
            including costs and legal fees.
          </p>

          <h3>If your content was removed and you believe that was wrong</h3>
          <p>
            You may send a counter-notice to the same address. It needs your signature,
            identification of what was removed and where it appeared, a statement{" "}
            <strong>under penalty of perjury</strong> that you have a good-faith belief it was
            removed by mistake or misidentification, your name, address and telephone number, and
            your consent to the jurisdiction of the federal court for your district — or, if you are
            outside the United States, for the district in which {SITE_NAME} may be found. If we
            receive a valid counter-notice we may restore the material as the Act permits.
          </p>

          <h3>Repeat infringers</h3>
          <p>
            Accounts that repeatedly infringe the copyright of others are terminated. This is a
            standing policy, not a discretionary one.
          </p>

          <h2>9. No warranty</h2>
          <p>
            {SITE_NAME} is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
            warranties of any kind, whether express, implied or statutory.{" "}
            <strong>
              All implied warranties are disclaimed, including the implied warranties of
              merchantability, fitness for a particular purpose, title, and non-infringement.
            </strong>{" "}
            There is no guarantee that it will be uninterrupted, free of errors, secure against
            every attack, or available in the future.
          </p>
          <p>
            <strong>Keep your own copies of anything irreplaceable.</strong> Data loss should not
            happen, and it is not promised that it will not.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            To the fullest extent the law allows, {SITE_NAME} and whoever operates it are not liable
            for any indirect, incidental, consequential or punitive damages, or for lost profits,
            lost data, or lost goodwill, arising from your use of the service.
          </p>
          <p>
            Total liability for any claim relating to {SITE_NAME}, taken together, will not exceed
            the greater of the amount you have paid to use it — which is nothing, as it is free — or
            one hundred US dollars.
          </p>
          <p>
            Nothing here limits liability that cannot be limited by law, and some jurisdictions do
            not allow certain exclusions — in which case they simply do not apply to you.
          </p>

          <h2>11. Indemnification</h2>
          <p>
            If someone brings a claim against {SITE_NAME} because of what you posted, how you used
            the service, or a right you said you had and did not, you agree to cover the resulting
            claims, losses and reasonable legal costs. We will tell you about any such claim and
            will not settle it in a way that puts an obligation on you without asking first.
          </p>

          <h2>12. Content posted by other people</h2>
          <p>
            Reviews and comments are written by members, and their opinions are their own.{" "}
            {SITE_NAME} does not endorse or verify what members post, and is not responsible for it.
          </p>

          <h2>13. Changes to these terms</h2>
          <p>
            These terms may change as the service does. The date at the top of the page changes with
            them, and material changes will be announced in the app. Continuing to use {SITE_NAME}{" "}
            after a change means you accept the revised terms.
          </p>

          <h2>14. Governing law and disputes</h2>
          <p>
            These terms are governed by the laws of the{" "}
            <strong>State of Minnesota, United States</strong>, without regard to its
            conflict-of-law rules. Any dispute that does go to court will be brought exclusively in
            the state or federal courts located in Minnesota, and both you and {SITE_NAME} consent
            to the jurisdiction of those courts.
          </p>
          <p>
            <strong>Claims are brought individually.</strong> You and {SITE_NAME} each agree not to
            bring a claim as a plaintiff or class member in any class, consolidated or
            representative action, and no court may hear the claims of more than one person at once
            under these terms.
          </p>
          <p>
            <strong>Small claims court is still open to you.</strong> Either of us may bring a
            qualifying claim there instead, and nothing above is meant to take away the cheapest
            forum available to an individual.
          </p>
          <p>
            Before filing anything, please email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Most disagreements are settled
            faster by someone reading them than by anyone filing.
          </p>

          <h2>15. General</h2>
          <ul>
            <li>
              <strong>Severability.</strong> If a provision here is found unenforceable, it is
              limited or removed to the minimum extent necessary and the rest stays in force.
            </li>
            <li>
              <strong>No waiver.</strong> Not enforcing a provision on one occasion does not give it
              up on the next.
            </li>
            <li>
              <strong>Entire agreement.</strong> These terms and the{" "}
              <a href="/privacy">privacy policy</a> are the whole agreement between you and{" "}
              {SITE_NAME}, and replace anything said before them.
            </li>
            <li>
              <strong>Assignment.</strong> You may not transfer your rights under these terms.{" "}
              {SITE_NAME} may transfer them if the project changes hands, in which case this page
              will say so.
            </li>
          </ul>

          <h2>16. Contact</h2>
          <p>
            Questions about these terms go to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
