/**
 * The privacy policy.
 *
 * Written against what the code actually does, not against what a template says
 * a policy should claim. Three places where that mattered:
 *
 *   * **Metadata is stripped, and this page only says so because it is true.**
 *     `strip_metadata` in `apps/api/app/services/media.py` runs on both upload
 *     paths — review media and avatars — before anything reaches the bucket, and
 *     `app.cli.strip_media_metadata` cleaned what was already there. An earlier
 *     draft of this page had to warn users that originals kept their EXIF,
 *     because at the time they did. If that pipeline ever changes, this section
 *     changes back.
 *   * **Cover art is hotlinked.** Images load in the reader's browser straight
 *     from IGDB's CDN, which means IGDB sees an IP address we never send them.
 *     Easy to omit; worth saying.
 *   * **Every claim under "Keeping it secure" is one the code makes good on** —
 *     password hashing, server-side visibility checks, refresh-token rotation
 *     with family revocation on reuse. Nothing aspirational goes in that
 *     section; a security promise is the one kind that gets read back to you.
 *
 * Keep all of those true. A policy that describes behaviour the app does not
 * have is worse than having no policy.
 *
 * **No vendor names, deliberately.** Which host, object store or mail provider
 * sits behind the service is not something a reader needs and not something
 * worth handing to whoever is probing it. The section names categories instead,
 * which is what the disclosure obligations actually ask for. `page.test.tsx`
 * guards this with a regex over the rendered text.
 */
import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { CONTACT_EMAIL, IGDB_URL, POLICY_UPDATED, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${SITE_NAME} collects, what it does not, and how to get your data removed.`,
};

export default function PrivacyPage() {
  return (
    <AppShell>
      <div className="max-w-2xl">
        <PageHeader
          eyebrow="Privacy"
          title="Privacy policy"
          description={`How ${SITE_NAME} handles your account, your writing, and the photos you upload.`}
        />

        <p className="type-eyebrow mt-8 text-fg-faint">Last updated {POLICY_UPDATED}</p>

        <div className="prose-legal mt-12">
          <h2>The short version</h2>
          <p>
            {SITE_NAME} stores the things you deliberately put into it — your account, your reviews,
            your lists, your photos — plus the minimum needed to keep the service running and
            secure. There are no advertisers, no analytics trackers, and nothing is sold. If you
            want your account and its contents gone, email us and they will be.
          </p>
          <p>
            The rest of this page is the detail behind those sentences. It describes what the
            software does today, not what it might do later — if the behaviour changes, this page
            changes with it.
          </p>

          <h2>Who runs this</h2>
          <p>
            {SITE_NAME} is an independent project, not a company. It is operated from the United
            States, and using it means your information is handled there — including if you are
            somewhere with stronger local protections, which continue to apply to you regardless.
          </p>
          <p>
            Questions about privacy, requests for your data, and account deletions all go to the
            same place: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <h2>What is collected</h2>

          <h3>Your account</h3>
          <ul>
            <li>
              <strong>Email address.</strong> Used to sign in, to reset a password, and to reach you
              about your account. It is never shown on your profile or to other members.
            </li>
            <li>
              <strong>Username, display name, bio and avatar.</strong> These are the public parts of
              a profile — visible to anyone who can see your account under the visibility rules
              below.
            </li>
            <li>
              <strong>Password.</strong> Stored only as a cryptographic hash. It is never stored in
              a readable form and cannot be recovered, only reset.
            </li>
          </ul>

          <h3>What you write and upload</h3>
          <ul>
            <li>Reviews: the rating, the text, and the playtime if you record one.</li>
            <li>
              Photos and video clips attached to reviews, and the thumbnails generated from them.
            </li>
            <li>Comments and replies, and which reviews you have liked.</li>
            <li>
              Your four backlog lists, your favourite games, and the pinned games on your profile.
            </li>
          </ul>

          <h3>Your connections</h3>
          <p>
            Who you follow, who follows you, and any pending follow requests in either direction.
          </p>

          <h3>Technical records</h3>
          <p>
            Ordinary server logs, which include IP addresses and browser user-agent strings. Your IP
            address is also used to enforce rate limits on sign-in, password reset and search, which
            is what stops those endpoints from being brute-forced. These records exist for security
            and reliability, and are not used to build a profile of you.
          </p>

          <h2>What is not collected</h2>
          <ul>
            <li>No advertising networks and no ad targeting.</li>
            <li>No third-party analytics or behavioural tracking scripts.</li>
            <li>
              No selling, renting or sharing of personal data with data brokers or advertisers.
            </li>
            <li>No tracking of you across other websites.</li>
          </ul>

          <h2>Photos, clips, and camera metadata</h2>
          <p>
            Files from a camera or phone carry more than the picture. Photos embed EXIF data — the
            date and time, the device make and model, camera settings, and, if location services
            were on, <strong>the GPS coordinates the photo was taken at</strong>. Video files keep
            the same things in their own container.
          </p>
          <p>
            <strong>{SITE_NAME} removes all of it before your file is stored.</strong> Photos are
            re-encoded without their metadata, and clips have their location and device atoms
            blanked out. This happens on the way into storage, so the version we keep — the one
            anyone else could ever download — has never carried it. It applies to review photos,
            review clips, and profile pictures alike.
          </p>
          <p>
            Two honest caveats. Rotation is the one piece of that data we act on before discarding
            it, so a photo taken sideways still appears the right way up. And anything visible{" "}
            <em>in</em> the image — a street sign behind you, a name in a screenshot — is content
            rather than metadata, and is published exactly as you uploaded it.
          </p>
          <p>
            Uploads are checked by their actual file contents rather than by the name or content
            type your browser claims, and every stored file is given a server-generated name, so an
            upload cannot overwrite anyone else&apos;s.
          </p>

          <h2>Who can see what</h2>
          <p>Every account is either public or private, and you can change this at any time.</p>
          <ul>
            <li>
              <strong>Public.</strong> Your profile, reviews, stats and lists can be seen by anyone,
              including people who are not signed in. Anyone can follow you without asking.
            </li>
            <li>
              <strong>Private.</strong> Your profile still appears in search so that people can find
              and request to follow you, but your reviews, stats and lists are visible only to
              followers you have approved. New followers must send a request that you accept or
              decline.
            </li>
          </ul>
          <p>
            This is enforced on the server, on every request that returns content — not merely
            hidden in the interface. Changing to private applies immediately to everything you have
            already posted.
          </p>
          <p>
            Two things are worth being clear about. Anyone who can see your content can copy it, and
            no privacy setting prevents that. And removing a follower stops future access, but not
            what they have already read.
          </p>

          <h2>Service providers</h2>
          <p>
            Running {SITE_NAME} means a small number of outside companies necessarily handle some of
            your data. They act on our instructions, for the purpose described, and for nothing
            else. None of them is permitted to use your data for their own ends.
          </p>
          <ul>
            <li>
              <strong>Infrastructure.</strong> The application, its database and the files you
              upload run on third-party hosting and storage providers.
            </li>
            <li>
              <strong>Email delivery.</strong> Account email — password resets and similar — is sent
              through a third-party delivery provider, which handles your email address in order to
              deliver the message.
            </li>
          </ul>
          <p>
            One outside service is worth describing separately, because it sees something we never
            send it:
          </p>
          <ul>
            <li>
              <strong>
                <a href={IGDB_URL} target="_blank" rel="noreferrer">
                  IGDB
                </a>{" "}
                (via Twitch).
              </strong>{" "}
              The games catalog is imported from IGDB on a schedule, and no personal data is sent to
              them as part of that. However, game cover images are loaded by your browser directly
              from IGDB&apos;s image servers, which means those servers see your IP address and
              user-agent whenever a cover renders, exactly as any third-party image on any website
              would.
            </li>
          </ul>

          <h2>Cookies and sessions</h2>
          <p>
            {SITE_NAME} uses authentication tokens to keep you signed in and to refresh that session
            as it expires. That is the extent of it: there are no advertising cookies and no
            analytics cookies. Signing out invalidates the session.
          </p>
          <p>
            Because nothing here tracks you in the first place, a &ldquo;Do Not Track&rdquo; signal
            from your browser has nothing to switch off. There is no behaviour to opt out of.
          </p>

          <h2>Keeping it secure</h2>
          <p>Concretely, and only what is actually true:</p>
          <ul>
            <li>
              Passwords are stored as cryptographic hashes and never in a form anyone — including us
              — could read.
            </li>
            <li>
              Traffic between your browser and the service travels over an encrypted connection.
            </li>
            <li>
              Sessions use short-lived tokens that rotate as they refresh. Presenting a token that
              has already been used invalidates the whole chain and forces a fresh sign-in, which is
              what limits the damage a stolen token can do.
            </li>
            <li>
              Sign-in, password reset and search are rate limited per IP address, which is what
              stops passwords being guessed at scale and the member directory being harvested.
            </li>
            <li>
              Every request that returns someone&apos;s content re-checks who is allowed to see it
              on the server, rather than relying on the interface to hide it.
            </li>
          </ul>
          <p>
            None of this makes any service invulnerable, and nobody honest claims otherwise. If
            something does go wrong in a way that affects your data, we will tell you.
          </p>

          <h2>How long things are kept</h2>
          <p>
            Your account and its contents are kept for as long as the account exists. Deleting a
            review, comment or list entry removes it. Server logs are short-lived and rotate in the
            ordinary course of running the service.
          </p>

          <h2>Deleting your account</h2>
          <p>
            You can have your account deleted by emailing{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address on the account.
            Deletion removes or anonymises your personal data: profile, email address, reviews,
            comments, likes, lists, uploaded media, and your follow relationships. Requests are
            acted on within 30 days.
          </p>
          <p>
            Backups are retained for a short period for disaster recovery, so a copy may persist
            there briefly after deletion before ageing out.
          </p>

          <h2>Your rights</h2>
          <p>
            Wherever you live, you can ask for a copy of the data held about you, ask for something
            inaccurate to be corrected, or ask for your data to be deleted. Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address on your account
            and we will act on it. You will not be charged for asking, and you will not get a worse
            version of {SITE_NAME} for having asked.
          </p>

          <h3>If you are in the United States</h3>
          <p>
            California and a growing number of other states give residents specific rights over
            their personal information. The most important one is the easiest to state:{" "}
            <strong>
              {SITE_NAME} does not sell your personal information, and does not share it for
              cross-context behavioural advertising.
            </strong>{" "}
            There is no such arrangement to opt out of, because there is no advertising here at all.
          </p>
          <p>Beyond that, you have the right to:</p>
          <ul>
            <li>Know what personal information is held about you and where it came from.</li>
            <li>Get a copy of it.</li>
            <li>Have it corrected if it is wrong.</li>
            <li>Have it deleted.</li>
            <li>Not be discriminated against for exercising any of these.</li>
          </ul>
          <p>
            If someone is authorised to make a request on your behalf, we may need to confirm that
            with you before acting on it.
          </p>

          <h3>If you are in the UK or the European Economic Area</h3>
          <p>
            You have the rights above, and in addition the right to object to or restrict certain
            processing, the right to receive your data in a portable form, and the right to complain
            to your local data protection authority. Your data is processed in order to provide a
            service you asked for, and on the basis of our legitimate interest in keeping that
            service running and secure.
          </p>

          <h2>Children</h2>
          <p>
            {SITE_NAME} is not intended for children under 13, and under 16 in the European Economic
            Area. It is not directed at children, and information is not knowingly collected from
            them. Accounts belonging to anyone younger will be removed when identified — if you
            believe a child has created one, email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and it will be handled.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            When this policy changes, the date at the top of the page changes with it. For a change
            that materially affects how your data is handled, we will give notice in the app rather
            than relying on you to re-read this page.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
