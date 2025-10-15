const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const crypto = require('crypto');

// Helper: generate URL-safe session id
function generateSessionId({ length = 22, prefix = 'sess' } = {}) {
  // 16 bytes -> 22 chars when base64url-encoded; tweak length if needed
  const bytes = crypto.randomBytes(16);
  const b64 = bytes.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${prefix}-${b64}`;
}

// All routes require auth
router.use(authenticateToken);

// POST /api/negotiations/session
// Body: { peerUserId?: number, seed?: string, prefix?: string }
// Returns: { sessionId: string }
router.post('/session', async (req, res) => {
  try {
    const { peerUserId, seed, prefix } = req.body || {};

    // If a deterministic seed is provided, derive a stable id for idempotency
    if (seed) {
      const hash = crypto.createHash('sha256')
        .update(String(seed))
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const sessionId = `${prefix || 'sess'}-${hash.substring(0, 22)}`;
      return res.json({ success: true, sessionId });
    }

    // Otherwise generate a random session id
    const sessionId = generateSessionId({ prefix: prefix || 'sess' });
    return res.json({ success: true, sessionId });
  } catch (err) {
    console.error('[negotiations] create session error:', err);
    return res.status(500).json({ success: false, message: 'Không thể tạo sessionId' });
  }
});

module.exports = router;
