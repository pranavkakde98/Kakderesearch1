'use strict';

const { ok } = require('./http');

// A dummy deployment must never send mail or change live records.
function isPreview() { return process.env.VERCEL_ENV !== 'production'; }

function previewResult(req, res) {
  return ok(req, res, {
    ok: true,
    preview: true,
    delivered: false,
    message: 'V15 preview complete. Your test passed validation. No email has been sent and no live record has been created or changed.'
  });
}

module.exports = { isPreview, previewResult };
