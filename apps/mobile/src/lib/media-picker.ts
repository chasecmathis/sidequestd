/**
 * Getting a photo or a clip off the phone and into the shape the API takes.
 *
 * This is the native half of what `<input type="file">` does on the web, and it
 * is more work for one reason that is worth stating plainly: the browser hands
 * over a `File`, which already carries a MIME type, a size and the bytes.
 * `expo-image-picker` hands over an *asset* — a URI into the photo library, plus
 * whatever metadata the platform felt like including — and three of those fields
 * are optional in practice. Everything below is the reconciliation.
 *
 * `rejectMedia` in `@sidequestd/core` is the reason this file is small. The
 * limits, the one-clip rule and the wording of every refusal are shared with the
 * web and tested there; the only thing this module adds is the type and size to
 * check them against, which is exactly the two fields `MediaCandidate` asks for.
 *
 * **What happens when the platform withholds a size.** `fileSize` is absent for
 * some library items on Android, and 0 is the honest stand-in: it means the
 * client cannot refuse the file, not that the file is empty. The server checks
 * every limit again — that is the contract `reviews.ts` states — so the cost of
 * a missed pre-check is one round trip and a real error message, rather than a
 * silently accepted 200 MB upload.
 *
 * The camera is here because it is the whole reason this app exists on a phone:
 * the web's composer can only offer files that already exist, and the person
 * writing a review about a game they just finished is holding the device the
 * screenshot is on.
 */
import * as ImagePicker from "expo-image-picker";

import { MAX_MEDIA_PER_REVIEW, rejectMedia, tally } from "@sidequestd/core";

/** A file, in the shape both `rejectMedia` and a multipart body can read. */
export interface PickedMedia {
  /** A `file://` or `ph://` URI. React Native's `FormData` reads the bytes from it. */
  uri: string;
  name: string;
  /** A real MIME type — inferred when the platform did not supply one. */
  type: string;
  size: number;
  isVideo: boolean;
}

export interface PickResult {
  items: PickedMedia[];
  /** The first refusal, if the reader chose more than the rules allow. */
  error: string | null;
}

/**
 * The MIME type, whatever the platform did or did not say.
 *
 * `mimeType` is populated on iOS and often absent on Android, where all we get
 * is `type: "image" | "video"`. Guessing the container is safe here because the
 * type is only ever read for its `video/` prefix — by `rejectMedia`, which
 * branches on nothing else, and by the server, which sniffs the bytes.
 */
function mimeOf(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType;
  return asset.type === "video" ? "video/mp4" : "image/jpeg";
}

function nameOf(asset: ImagePicker.ImagePickerAsset, mime: string): string {
  if (asset.fileName) return asset.fileName;
  // The URI's last segment is a UUID on iOS and a real filename on Android;
  // either is a better multipart name than "blob", which is what the server logs
  // when the part has none.
  const tail = asset.uri.split("/").pop();
  if (tail && tail.includes(".")) return tail;
  return `upload.${mime.split("/")[1] ?? "jpg"}`;
}

/**
 * Assets → candidates, refusing at the first one that breaks a rule.
 *
 * `existing` is what is already attached, so the ten-item and one-clip limits
 * are judged against the whole carousel rather than against this batch — and the
 * tally grows as the batch is walked, which is what stops two videos chosen in
 * one gesture from both passing the one-video check.
 */
function accept(
  assets: ImagePicker.ImagePickerAsset[],
  existing: { images: number; videos: number },
): PickResult {
  const running = { ...existing };
  const items: PickedMedia[] = [];

  for (const asset of assets) {
    const type = mimeOf(asset);
    const size = asset.fileSize ?? 0;

    const reason = rejectMedia({ type, size }, running);
    if (reason) return { items, error: reason };

    const isVideo = type.startsWith("video/");
    items.push({ uri: asset.uri, name: nameOf(asset, type), type, size, isVideo });
    if (isVideo) running.videos += 1;
    else running.images += 1;
  }

  return { items, error: null };
}

/**
 * The photo library.
 *
 * No permission request in front of it: iOS's modern picker runs out of process
 * and hands back only what was chosen, so it needs no library access at all, and
 * Android's document picker is the same bargain. Asking for permission we do not
 * need is how an app trains people to say no to the one it does.
 *
 * `selectionLimit` is what is *left*, so the picker itself stops the reader at
 * ten rather than letting them choose twelve and refusing two.
 */
export async function pickFromLibrary(existing: { images: number; videos: number }): Promise<PickResult> {
  const remaining = Math.max(MAX_MEDIA_PER_REVIEW - (existing.images + existing.videos), 0);
  if (remaining === 0) {
    return { items: [], error: `A review can hold at most ${MAX_MEDIA_PER_REVIEW} photos or clips.` };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    // Untouched bytes. The server strips metadata and derives its own
    // renditions (see the media pipeline), so re-encoding here would cost
    // quality to save nothing.
    quality: 1,
    exif: false,
  });

  if (result.canceled) return { items: [], error: null };
  return accept(result.assets, existing);
}

/**
 * The camera.
 *
 * This one *does* need permission, and the failure is worth a sentence rather
 * than a silent no-op: a reader who declined the prompt months ago has no way to
 * connect a dead button to a setting three screens into the OS.
 */
export async function captureWithCamera(existing: {
  images: number;
  videos: number;
}): Promise<PickResult> {
  if (existing.images + existing.videos >= MAX_MEDIA_PER_REVIEW) {
    return { items: [], error: `A review can hold at most ${MAX_MEDIA_PER_REVIEW} photos or clips.` };
  }

  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { items: [], error: "Sidequestd needs camera access to take a photo. Turn it on in Settings." };
  }

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false });
  if (result.canceled) return { items: [], error: null };
  return accept(result.assets, existing);
}

/**
 * A square image, for an avatar.
 *
 * The one place cropping is offered, and the only place it makes sense: an
 * avatar is drawn in a circle at eight sizes, so a reader who cannot choose the
 * square gets to find out where their face ended up after the upload.
 */
export async function pickAvatar(): Promise<PickedMedia | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
    exif: false,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const type = mimeOf(asset);
  return {
    uri: asset.uri,
    name: nameOf(asset, type),
    type,
    size: asset.fileSize ?? 0,
    isVideo: false,
  };
}

/**
 * The multipart body the API's upload endpoints take.
 *
 * The cast is React Native's own shape rather than a lie about types: RN's
 * `FormData` accepts `{ uri, name, type }` and streams the file from disk, which
 * is the whole reason a phone can upload a 90 MB clip without reading it into
 * memory first. TypeScript's DOM lib only knows about `Blob`, and there is no
 * spelling of this that satisfies both.
 */
export function uploadBody(file: PickedMedia, field = "file"): FormData {
  const form = new FormData();
  form.append(field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  return form;
}

/** Re-exported so a caller counting what is attached does not import two modules. */
export { tally };
