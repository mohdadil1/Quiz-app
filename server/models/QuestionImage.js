const mongoose = require('mongoose');

/**
 * An image used in a question or an option (a diagram, graph, circuit…).
 *
 * Vercel has no disk, so the bytes live in MongoDB (like teacher avatars). Questions
 * only store the image's `key`; the picture itself is fetched from
 * GET /api/images/:key, which browsers and Vercel's CDN cache for good — so the
 * question list stays small and each student downloads each image once.
 *
 * `key` is a random 128-bit id, not the ObjectId, so image URLs can't be guessed
 * before a test starts. An image is `attached` once a saved question uses it;
 * uploads that never get attached (the teacher closed the form) are removed by
 * MongoDB a day later.
 */
const questionImageSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
    contentType: { type: String, required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    data: { type: Buffer, required: true },
    bytes: { type: Number, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    attached: { type: Boolean, default: false }
  },
  { timestamps: true }
);

questionImageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60, partialFilterExpression: { attached: false } }
);

module.exports = mongoose.model('QuestionImage', questionImageSchema);
