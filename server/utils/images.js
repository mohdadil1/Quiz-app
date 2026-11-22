const crypto = require('crypto');
const QuestionImage = require('../models/QuestionImage');

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024; // the browser shrinks images first; this is the hard cap
const KEY_PATTERN = /^[a-f0-9]{32}$/;
const LETTERS = ['a', 'b', 'c', 'd'];

/**
 * Work out the real image type from the file's first bytes. The browser-supplied
 * MIME type is ignored, and SVG is never accepted (it can carry scripts).
 */
function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  return null;
}

const newKey = () => crypto.randomBytes(16).toString('hex');
const isKey = (value) => typeof value === 'string' && KEY_PATTERN.test(value);

// Every image key a question uses (question image + option images)
function imageKeysOf(question) {
  const keys = [question?.image, ...LETTERS.map((l) => question?.optionImages?.[l])];
  return keys.filter(isKey);
}

/**
 * Validate the image fields of a question body. Each must be '' / null (no image)
 * or the key of an image this teacher uploaded. Returns { fields } or { error }.
 */
async function buildImageFields(body, teacherId) {
  const clean = (value) => (value == null || value === '' ? '' : String(value));
  const image = clean(body.image);
  const optionImages = {};
  for (const l of LETTERS) optionImages[l] = clean(body.optionImages?.[l]);

  const keys = [image, ...Object.values(optionImages)].filter(Boolean);
  if (keys.some((k) => !isKey(k))) return { error: 'Invalid image' };
  if (keys.length) {
    const found = await QuestionImage.countDocuments({ key: { $in: [...new Set(keys)] }, teacher: teacherId });
    if (found !== new Set(keys).size) return { error: 'Image not found — please upload it again' };
  }
  return { fields: { image, optionImages } };
}

// Mark images as used so the one-day clean-up of unused uploads leaves them alone
async function markAttached(keys) {
  if (keys.length) await QuestionImage.updateMany({ key: { $in: keys } }, { $set: { attached: true } });
}

// Delete images no remaining question uses (after a question is edited or deleted)
async function deleteUnusedImages(keys) {
  const unique = [...new Set(keys.filter(isKey))];
  if (!unique.length) return;
  const Question = require('../models/Question');
  const stillUsed = new Set();
  const users = await Question.find({
    $or: [
      { image: { $in: unique } },
      ...LETTERS.map((l) => ({ [`optionImages.${l}`]: { $in: unique } }))
    ]
  }).select('image optionImages');
  users.forEach((q) => imageKeysOf(q).forEach((k) => stillUsed.add(k)));
  const unused = unique.filter((k) => !stillUsed.has(k));
  if (unused.length) await QuestionImage.deleteMany({ key: { $in: unused } });
}

// Width / height from the image header, so the page can reserve space before it loads
function imageSize(buf, type) {
  try {
    if (type === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) return {};
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch { /* unknown layout — size is optional */ }
  return {};
}

module.exports = {
  MAX_IMAGE_BYTES,
  LETTERS,
  sniffImageType,
  newKey,
  isKey,
  imageKeysOf,
  buildImageFields,
  markAttached,
  deleteUnusedImages,
  imageSize
};
