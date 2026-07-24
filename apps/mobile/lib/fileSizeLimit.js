import ImageResizer from '@bam.tech/react-native-image-resizer';

// Every file the app uploads (KYC photos/PDFs, and any future upload point)
// must fit this cap — keeps storage + bandwidth costs predictable.
export const MAX_UPLOAD_BYTES = 30 * 1024;

// Progressively smaller/lower-quality JPEG passes, tried in order until one
// lands at or under MAX_UPLOAD_BYTES. Camera photos are typically 3-5MB, so
// the early steps rarely suffice — later ones trade legibility for size.
const COMPRESSION_STEPS = [
  { width: 1280, quality: 70 },
  { width: 1024, quality: 60 },
  { width: 800, quality: 50 },
  { width: 640, quality: 40 },
  { width: 480, quality: 30 },
  { width: 360, quality: 25 },
  { width: 280, quality: 20 },
  { width: 200, quality: 15 }
];

export async function getUriByteSize(uri) {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return buffer.byteLength;
}

// Resizes/re-encodes an image URI down until it fits under maxBytes,
// returning the winning JPEG's uri + size. Throws if even the smallest step
// doesn't fit.
export async function compressImageToLimit(uri, maxBytes = MAX_UPLOAD_BYTES) {
  let current = uri;
  let size = await getUriByteSize(current);
  if (size <= maxBytes) return { uri: current, size };

  for (const step of COMPRESSION_STEPS) {
    const resized = await ImageResizer.createResizedImage(
      current,
      step.width,
      step.width,
      'JPEG',
      step.quality,
      0,
      undefined,
      false
    );
    current = resized.uri;
    size = await getUriByteSize(current);
    if (size <= maxBytes) return { uri: current, size };
  }

  throw new Error(`Could not compress image below ${Math.round(maxBytes / 1024)}KB`);
}

// PDFs aren't re-encodable client-side here, so this just rejects oversized
// ones instead of silently uploading a file bigger than the cap.
export async function assertFileWithinLimit(uri, maxBytes = MAX_UPLOAD_BYTES) {
  const size = await getUriByteSize(uri);
  if (size > maxBytes) {
    throw new Error(`File is too large (max ${Math.round(maxBytes / 1024)}KB)`);
  }
  return size;
}
