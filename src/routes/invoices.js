/**
 * Invoice API Routes
 */
const express = require('express');
const multer = require('multer');
const { body, param, validationResult } = require('express-validator');
const invoiceQueue = require('../queue/invoiceQueue');
const db = require('../utils/db');
const { generateSignedUrl, verifySignedUrl } = require('../utils/urlSigning');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for PDF uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /api/invoices
 * Create invoice and queue send job (with optional PDF upload)
 */
router.post(
  '/',
  upload.single('pdf'),
  async (req, res, next) => {
    try {
      // Parse invoice data (sent as JSON in 'data' field or as individual fields)
      let invoiceData;
      if (req.body.data) {
        invoiceData = JSON.parse(req.body.data);
      } else {
        invoiceData = req.body;
      }

      // Validate required fields
      if (!invoiceData.invoiceNumber || !invoiceData.customerName || !invoiceData.customerEmail) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Insert invoice
      const result = await db.run(
        `INSERT INTO invoices (invoiceNumber, customerName, customerEmail,
         customerPhone, grandTotal, currency, invoiceDate, dueDate, items, send_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
        [
          invoiceData.invoiceNumber,
          invoiceData.customerName,
          invoiceData.customerEmail,
          invoiceData.customerPhone,
          invoiceData.grandTotal,
          invoiceData.currency || 'USD',
          invoiceData.invoiceDate,
          invoiceData.dueDate,
          JSON.stringify(invoiceData.items),
        ]
      );

      const invoiceId = result.lastID;

      // Get PDF buffer if uploaded
      const pdfBuffer = req.file ? req.file.buffer : null;

      // Queue send job if auto-send enabled
      const settings = await db.get('SELECT * FROM invoice_settings WHERE id = 1');

      if (settings?.auto_send_on_create) {
        const job = await invoiceQueue.add('send-invoice', {
          invoiceId,
          invoiceData: { ...invoiceData, id: invoiceId },
          pdfBuffer, // Pass PDF buffer to worker
          triggeredBy: req.user?.id || 'system',
        });

        logger.info(`Invoice ${invoiceId} created and queued (Job ${job.id})`);
      }

      res.status(201).json({
        success: true,
        invoiceId,
        message: settings?.auto_send_on_create
          ? 'Invoice created and queued for sending'
          : 'Invoice created successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/invoices/:id/send
 * Manually trigger invoice send (with idempotency)
 */
router.post(
  '/:id/send',
  [param('id').isInt()],
  validate,
  async (req, res, next) => {
    try {
      const invoiceId = parseInt(req.params.id);

      // Check if already sent recently (idempotency - within last hour)
      const recentSend = await db.get(
        `SELECT * FROM send_logs
         WHERE invoice_id = ? AND send_type = 'email'
         AND status IN ('sent', 'delivered')
         AND created_at > datetime('now', '-1 hour')
         ORDER BY created_at DESC LIMIT 1`,
        [invoiceId]
      );

      if (recentSend) {
        return res.status(200).json({
          success: true,
          message: 'Invoice was already sent recently',
          sendLog: recentSend,
        });
      }

      // Fetch invoice data
      const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      // Queue send job
      const job = await invoiceQueue.add('send-invoice', {
        invoiceId,
        invoiceData: invoice,
        triggeredBy: req.user?.id || 'manual',
        triggerType: 'manual',
      });

      res.json({
        success: true,
        message: 'Invoice queued for sending',
        jobId: job.id,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/invoices/:id/pdf
 * Download PDF with signed URL verification
 */
router.get(
  '/:id/pdf',
  [param('id').isInt()],
  validate,
  async (req, res, next) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const token = req.query.token;

      // Verify signed URL token
      if (!token || !verifySignedUrl(token, invoiceId)) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }

      // Get PDF file info
      const file = await db.get(
        'SELECT * FROM invoice_files WHERE invoice_id = ? ORDER BY generated_at DESC LIMIT 1',
        [invoiceId]
      );

      if (!file) {
        return res.status(404).json({ error: 'PDF not found' });
      }

      // Serve file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${file.file_name}"`);

      if (file.storage_type === 'local') {
        const fs = require('fs');
        const fileStream = fs.createReadStream(file.file_path);
        fileStream.pipe(res);
      } else {
        // Redirect to S3 signed URL
        res.redirect(file.signed_url);
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/invoices/:id/view
 * View invoice PDF online in browser
 */
router.get(
  '/:id/view',
  [param('id').isInt()],
  validate,
  async (req, res, next) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const token = req.query.token;

      // Verify signed URL token
      if (!token || !verifySignedUrl(token, invoiceId)) {
        return res.status(403).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Access Denied</title>
            <style>
              body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .error-box { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
              h1 { color: #d32f2f; margin: 0 0 10px 0; }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h1>Access Denied</h1>
              <p>Invalid or expired link. Please contact the sender for a new link.</p>
            </div>
          </body>
          </html>
        `);
      }

      // Get PDF file info
      const file = await db.get(
        'SELECT * FROM invoice_files WHERE invoice_id = ? ORDER BY generated_at DESC LIMIT 1',
        [invoiceId]
      );

      if (!file) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>PDF Not Found</title>
            <style>
              body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .error-box { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
              h1 { color: #d32f2f; margin: 0 0 10px 0; }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h1>PDF Not Found</h1>
              <p>The invoice PDF is not available yet.</p>
            </div>
          </body>
          </html>
        `);
      }

      // Serve PDF file inline (display in browser)
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${file.file_name}"`);

      if (file.storage_type === 'local') {
        const fs = require('fs');
        const fileStream = fs.createReadStream(file.file_path);
        fileStream.pipe(res);
      } else {
        // Redirect to S3 signed URL
        res.redirect(file.signed_url);
      }
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/invoices/:id/status
 * Get send status for invoice
 */
router.get('/:id/status', async (req, res, next) => {
  try {
    const invoiceId = parseInt(req.params.id);

    const logs = await db.all(
      `SELECT send_type, status, provider, provider_message_id,
       sent_at, delivered_at, opened_at, error_message
       FROM send_logs WHERE invoice_id = ? ORDER BY created_at DESC`,
      [invoiceId]
    );

    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
