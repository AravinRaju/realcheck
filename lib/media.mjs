import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { budgets } from './budgets.mjs';

export class ValidationError extends Error {}
export const formats = Object.freeze({
  jpg: { kind: 'image', mime: 'image/jpeg', limit: 10 * 1024 * 1024 },
  jpeg: { kind: 'image', mime: 'image/jpeg', limit: 10 * 1024 * 1024 },
  png: { kind: 'image', mime: 'image/png', limit: 10 * 1024 * 1024 },
  webp: { kind: 'image', mime: 'image/webp', limit: 10 * 1024 * 1024 },
  mp3: { kind: 'audio', mime: 'audio/mpeg', limit: 20 * 1024 * 1024 },
  wav: { kind: 'audio', mime: 'audio/wav', limit: 20 * 1024 * 1024 },
  flac: { kind: 'audio', mime: 'audio/flac', limit: 20 * 1024 * 1024 },
  ogg: { kind: 'audio', mime: 'audio/ogg', limit: 20 * 1024 * 1024 },
});

export function validateMetadata(name, size, mime = '') {
  if (typeof name !== 'string' || !name || name.length > 180 || /[\\/\x00-\x1f]/.test(name)) {
    throw new ValidationError('Use a plain filename of 180 characters or fewer.');
  }
  const extension = name.split('.').pop().toLowerCase();
  const format = Object.hasOwn(formats, extension) ? formats[extension] : null;
  if (!format) throw new ValidationError('Choose JPG, PNG, WebP, MP3, WAV, FLAC, or Ogg audio. Video is not supported.');
  if (!Number.isSafeInteger(size) || size < 1) throw new ValidationError('The file is empty or its size is invalid.');
  if (size > format.limit) throw new ValidationError(format.kind === 'image' ? 'Images must be 10 MB or smaller.' : 'Audio must be 20 MB or smaller.');
  const type = mime.split(';')[0].trim().toLowerCase();
  const aliases = { wav: ['audio/x-wav', 'audio/wave', 'audio/vnd.wave'], flac: ['audio/x-flac'], mp3: ['audio/mp3'], ogg: ['audio/opus', 'application/ogg'] };
  if (type && type !== 'application/octet-stream' && type !== format.mime && !(aliases[extension] || []).includes(type)) {
    throw new ValidationError('The file type does not match its extension. Export a fresh copy.');
  }
  return { ...format, extension };
}

const ascii = (bytes, offset, text) => [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
const starts = (bytes, values) => values.every((value, i) => bytes[i] === value);
export function validateBytes(bytes, metadata) {
  const ext = metadata.extension;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let valid = false;
  if (ext === 'jpg' || ext === 'jpeg') {
    valid = bytes.length > 20 && starts(bytes, [255, 216, 255]) && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  } else if (ext === 'png') {
    valid = bytes.length >= 45 && starts(bytes, [137, 80, 78, 71, 13, 10, 26, 10]) &&
      ascii(bytes, 12, 'IHDR') && ascii(bytes, bytes.length - 8, 'IEND');
    if (valid) valid = view.getUint32(16) > 0 && view.getUint32(20) > 0 && view.getUint32(16) * view.getUint32(20) <= 40000000;
  } else if (ext === 'webp') {
    valid = bytes.length > 20 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP') &&
      view.getUint32(4, true) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].some(h => ascii(bytes, 12, h));
  } else if (ext === 'wav') {
    valid = bytes.length >= 44 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE') && view.getUint32(4, true) + 8 === bytes.length;
    let hasFormat = false, hasData = false;
    for (let pos = 12; valid && pos + 8 <= bytes.length;) {
      const length = view.getUint32(pos + 4, true);
      if (pos + 8 + length > bytes.length) { valid = false; break; }
      if (ascii(bytes, pos, 'fmt ')) hasFormat = length >= 16 && view.getUint16(pos + 10, true) > 0;
      if (ascii(bytes, pos, 'data')) hasData = length > 0;
      pos += 8 + length + (length % 2);
    }
    valid = valid && hasFormat && hasData;
  } else if (ext === 'flac') {
    valid = bytes.length > 42 && ascii(bytes, 0, 'fLaC') && (bytes[4] & 127) === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 34;
  } else if (ext === 'ogg') {
    // Check complete Ogg pages and require every logical stream to identify
    // itself as Opus or Vorbis audio. Reject Theora/video and unknown streams.
    let position = 0;
    const streams = new Set();
    valid = bytes.length >= 35;
    while (valid && position < bytes.length) {
      if (position + 27 > bytes.length || !ascii(bytes, position, 'OggS') || bytes[position + 4] !== 0) { valid = false; break; }
      const segments = bytes[position + 26];
      const payload = position + 27 + segments;
      if (payload > bytes.length) { valid = false; break; }
      let size = 0;
      for (let index = 0; index < segments; index++) size += bytes[position + 27 + index];
      if (payload + size > bytes.length) { valid = false; break; }
      const serial = view.getUint32(position + 14, true);
      if (bytes[position + 5] & 2) {
        const audio = (size >= 19 && ascii(bytes, payload, 'OpusHead')) ||
          (size >= 30 && bytes[payload] === 1 && ascii(bytes, payload + 1, 'vorbis'));
        if (!audio || streams.has(serial)) { valid = false; break; }
        streams.add(serial);
      } else if (!streams.has(serial)) { valid = false; break; }
      position = payload + size;
    }
    valid = valid && streams.size > 0 && position === bytes.length;
  } else if (ext === 'mp3') {
    let offset = 0;
    if (ascii(bytes, 0, 'ID3') && bytes.length >= 10) {
      if ([6, 7, 8, 9].some(i => bytes[i] > 127)) throw new ValidationError('The MP3 header is invalid.');
      offset = 10 + (bytes[6] << 21) + (bytes[7] << 14) + (bytes[8] << 7) + bytes[9] + ((bytes[5] & 16) ? 10 : 0);
    }
    valid = bytes.length > offset + 4 && bytes[offset] === 255 && (bytes[offset + 1] & 224) === 224 &&
      (bytes[offset + 1] & 24) !== 8 && (bytes[offset + 1] & 6) !== 0 &&
      (bytes[offset + 2] & 240) !== 0 && (bytes[offset + 2] & 240) !== 240 && (bytes[offset + 2] & 12) !== 12;
  }
  if (!valid) throw new ValidationError('File contents do not match a supported format, or the file is damaged. Export a fresh copy.');
  return metadata;
}

// Each request owns one random directory and one generated filename. Never use
// user filenames as paths. Cleanup is awaited before returning any result.
export async function withTemporaryUpload(stream, metadata, action, { tempRoot = tmpdir(), timeoutMs = budgets.uploadMs } = {}) {
  const format = metadata && Object.hasOwn(formats, metadata.extension) ? formats[metadata.extension] : null;
  if (!format || metadata.kind !== format.kind || metadata.mime !== format.mime ||
      !Number.isSafeInteger(metadata.limit) || metadata.limit < 1 || metadata.limit > format.limit ||
      (metadata.expectedSize != null && (!Number.isSafeInteger(metadata.expectedSize) ||
        metadata.expectedSize < 1 || metadata.expectedSize > metadata.limit))) {
    throw new ValidationError('Invalid upload metadata.');
  }
  const directory = await mkdtemp(join(tempRoot, 'realcheck-upload-'));
  const filePath = join(directory, 'media.' + metadata.extension);
  let handle, bytes, timer, total = 0;
  try {
    handle = await open(filePath, 'wx', 0o600);
    // Start only when the stream consumer can catch the destruction error.
    timer = setTimeout(() => stream.destroy(new ValidationError('Upload timed out. Please try again.')), timeoutMs);
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > metadata.limit) throw new ValidationError('The upload exceeds the file size limit.');
      await handle.writeFile(chunk);
    }
    clearTimeout(timer);
    await handle.close(); handle = null;
    if (!total) throw new ValidationError('The file is empty.');
    if (metadata.expectedSize != null && total !== metadata.expectedSize) throw new ValidationError('The upload was interrupted. Try again.');
    bytes = await readFile(filePath);
    validateBytes(bytes, metadata);
    return await action({ filePath, bytes, metadata });
  } finally {
    clearTimeout(timer);
    bytes?.fill(0);
    try { await handle?.close(); }
    finally {
      // directory comes only from mkdtemp above and contains only this request.
      await rm(directory, { recursive: true, force: true });
    }
  }
}
