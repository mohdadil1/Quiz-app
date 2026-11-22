// Question pictures — file checks and picture-only options (no database needed)
const test = require('node:test');
const assert = require('node:assert/strict');
const { sniffImageType, imageSize, isKey, imageKeysOf } = require('../utils/images');
const { buildQuestionFields, describeAnswer } = require('../utils/questionTypes');

// Smallest valid 1×1 PNG, and a 3×2 GIF header
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const GIF_3x2 = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([3, 0, 2, 0]), Buffer.alloc(8)]);

test('image type comes from the file bytes, not the name', () => {
  assert.equal(sniffImageType(PNG_1x1), 'image/png');
  assert.equal(sniffImageType(GIF_3x2), 'image/gif');
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  // SVG (can contain scripts), HTML and junk are refused
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageType(Buffer.from('<html><script>alert(1)</script>')), null);
  assert.equal(sniffImageType(Buffer.alloc(3)), null);
});

test('reads the picture size from the header', () => {
  assert.deepEqual(imageSize(PNG_1x1, 'image/png'), { width: 1, height: 1 });
  assert.deepEqual(imageSize(GIF_3x2, 'image/gif'), { width: 3, height: 2 });
});

test('image keys are random hex, and every key on a question is found', () => {
  const k1 = 'a'.repeat(32);
  const k2 = 'b'.repeat(32);
  assert.ok(isKey(k1));
  assert.ok(!isKey('../etc/passwd'));
  assert.ok(!isKey('A'.repeat(32)));
  assert.deepEqual(imageKeysOf({ image: k1, optionImages: { a: '', b: k2, c: '', d: '' } }), [k1, k2]);
});

test('an option may be a picture with no text', () => {
  const key = 'c'.repeat(32);
  const body = {
    optionA: '', optionB: 'Graph 2', optionC: 'Graph 3', optionD: 'Graph 4',
    optionImages: { a: key },
    correctAns: 'a'
  };
  assert.equal(buildQuestionFields(body).fields.correctAns, 'a');
  assert.ok(buildQuestionFields({ ...body, optionImages: {} }).error);
  assert.equal(describeAnswer({ ...body, type: 'MCQ' }, 'a'), 'A. [picture]');
});
