/**
 * URL Signing utility for secure, expiring invoice links
 */
const crypto = require('crypto');

const SECRET = process.env.SIGNED_URL_SECRET || 'default-secret-change-in-production';
const EXPIRY_DAYS = parseInt(process.env.SIGNED_URL_EXPIRY_DAYS) || 7;

/**
 * Generate a signed URL token for an invoice
 * @param {number} invoiceId - The invoice ID
 * @param {number} expiryDays - Days until expiration (optional)
 * @returns {string} Base64 encoded token
 */
function generateSignedUrl(invoiceId, expiryDays = EXPIRY_DAYS) {
  const expiry = Date.now() + (expiryDays * 24 * 60 * 60 * 1000);
  const payload = `${invoiceId}:${expiry}`;

  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex');

  const token = Buffer.from(`${payload}:${signature}`).toString('base64');
  return token;
}

/**
 * Verify a signed URL token
 * @param {string} token - The base64 encoded token
 * @param {number} invoiceId - The invoice ID to verify against
 * @returns {boolean} True if valid and not expired
 */
function verifySignedUrl(token, invoiceId) {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const [id, expiry, signature] = decoded.split(':');

    // Check invoice ID matches
    if (parseInt(id) !== parseInt(invoiceId)) {
      console.log('Invoice ID mismatch');
      return false;
    }

    // Check not expired
    if (Date.now() > parseInt(expiry)) {
      console.log('Token expired');
      return false;
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', SECRET)
      .update(`${id}:${expiry}`)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('Invalid signature');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error verifying signed URL:', error);
    return false;
  }
}

module.exports = {
  generateSignedUrl,
  verifySignedUrl,
};
