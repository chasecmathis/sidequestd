/**
 * A `SyncNotice`, drawn.
 *
 * Two callers — the card, for what the last sync did, and the screen, for what
 * the link attempt did — and one shape, because `syncNotice` and
 * `callbackMessage` in `@sidequestd/core` both return it. Keeping the rendering
 * in one place is what stops the two from drifting into a boxed one and a bare
 * one.
 *
 * **The steps are why this exists.** Every other message in this feature is a
 * sentence and could have gone straight into `<Alert>`. The `PROFILE_PRIVATE`
 * case is four instructions — open Steam, edit profile, privacy, set Game
 * details to Public — and it is, as core's own comment says, the single most
 * valuable string in the feature: the one failure with a cure, spelled out. A
 * numbered list that arrived as one run-on paragraph would be a cure nobody
 * follows.
 *
 * They are nested `<Text>` rather than a `<View>` per row, and that is the
 * platform rather than a preference: `Alert` wraps its children in a `<Text>` so
 * the message can wrap and be selected as one block, and a `<View>` inside a
 * `<Text>` is laid out as an inline attachment with none of that. Nested text
 * inherits, so each step only says what differs.
 */
import type { SyncNotice as Notice } from "@sidequestd/core";

import { Alert } from "./ui/alert";
import { Text } from "./ui/text";

export function SyncNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;

  const tone = notice.tone === "error" ? "danger" : "success";

  return (
    <Alert tone={notice.tone}>
      <Text size={14} weight="medium" tone={tone}>
        {notice.title}
      </Text>
      {notice.steps.map((step, index) => (
        <Text key={step} size={13} tone={tone} relaxed>
          {"\n"}
          {index + 1}. {step}
        </Text>
      ))}
    </Alert>
  );
}
