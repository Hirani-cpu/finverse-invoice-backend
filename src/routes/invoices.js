/**
 * Invoice API Routes
 */
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const invoiceQueue = require('../queue/invoiceQueue');
const db = require('../utils/db');
const { generateSignedUrl, verifySignedUrl } = require('../utils/urlSigning');
const logger = require('../utils/logger');

const router = express.Router();

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
 * Create invoice and queue send job
 */
router.post(
  '/',
  [
    body('invoiceNumber').notEmpty(),
    body('customerName').notEmpty(),
    body('customerEmail').isEmail(),
    body('customerPhone').optional(),
    body('items').isArray({ min: 1 }),
    body('grandTotal').isNumeric(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const invoiceData = req.body;

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

      // Queue send job if auto-send enabled
      const settings = await db.get('SELECT * FROM invoice_settings WHERE id = 1');

      if (settings?.auto_send_on_create) {
        const job = await invoiceQueue.add('send-invoice', {
          invoiceId,
          invoiceData: { ...invoiceData, id: invoiceId },
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
 * View invoice online as HTML page
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

      // Get invoice data
      const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);

      if (!invoice) {
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>Invoice Not Found</title>
            <style>
              body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .error-box { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
              h1 { color: #d32f2f; margin: 0 0 10px 0; }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h1>Invoice Not Found</h1>
              <p>The requested invoice could not be found.</p>
            </div>
          </body>
          </html>
        `);
      }

      // Get settings for company info
      const settings = await db.get('SELECT * FROM invoice_settings WHERE id = 1');

      // Parse items
      const items = JSON.parse(invoice.items || '[]');
      const subtotal = items.reduce((sum, item) => sum + item.total, 0);
      const taxAmount = items.reduce((sum, item) => sum + (item.total * item.taxPercent / 100), 0);
      const total = subtotal + taxAmount;

      // Format currency
      const formatCurrency = (amount, currency) => {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: currency || 'USD',
        }).format(amount);
      };

      // Format date
      const formatDate = (date) => {
        return new Date(date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      };

      // Render HTML
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 60px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
    .company-name { font-size: 32px; font-weight: bold; color: #2563eb; margin-bottom: 5px; }
    .company-details { font-size: 14px; color: #666; }
    .invoice-info { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .invoice-title { font-size: 24px; font-weight: bold; color: #111; margin-bottom: 10px; }
    .invoice-meta { font-size: 14px; color: #666; line-height: 1.8; }
    .bill-to { margin-bottom: 40px; }
    .bill-to-title { font-size: 16px; font-weight: bold; color: #111; margin-bottom: 10px; }
    .bill-to-details { font-size: 14px; color: #666; line-height: 1.8; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    .items-table th { background: #f9f9f9; padding: 12px; text-align: left; font-size: 13px; font-weight: 600; color: #111; border-bottom: 2px solid #e5e7eb; }
    .items-table td { padding: 12px; font-size: 14px; color: #666; border-bottom: 1px solid #e5e7eb; }
    .items-table tr:last-child td { border-bottom: none; }
    .totals { margin-left: auto; width: 300px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #666; }
    .totals-row.total { border-top: 2px solid #e5e7eb; margin-top: 10px; padding-top: 15px; font-size: 18px; font-weight: bold; color: #111; }
    .amount-due { background: #f0f9ff; padding: 20px; border-radius: 8px; margin-top: 20px; }
    .amount-due-label { font-size: 16px; color: #666; margin-bottom: 5px; }
    .amount-due-value { font-size: 28px; font-weight: bold; color: #2563eb; }
    .footer { margin-top: 60px; padding-top: 30px; border-top: 1px solid #e5e7eb; text-align: center; }
    .footer-text { font-size: 12px; color: #999; line-height: 1.8; }
    .download-btn { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; font-size: 14px; font-weight: 500; }
    .download-btn:hover { background: #1d4ed8; }
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; }
      .download-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="company-name">${settings?.company_name || 'Finverse'}</div>
      <div class="company-details">${settings?.company_email || settings?.email_from || 'noreply@finverse.info'}</div>
    </div>

    <div class="invoice-info">
      <div class="bill-to">
        <div class="bill-to-title">Bill To:</div>
        <div class="bill-to-details">
          <div><strong>${invoice.customerName}</strong></div>
          ${invoice.customerEmail ? `<div>${invoice.customerEmail}</div>` : ''}
          ${invoice.customerPhone ? `<div>${invoice.customerPhone}</div>` : ''}
        </div>
      </div>
      <div>
        <div class="invoice-title">INVOICE</div>
        <div class="invoice-meta">
          <div><strong>Invoice #:</strong> ${invoice.invoiceNumber}</div>
          <div><strong>Date:</strong> ${formatDate(invoice.invoiceDate)}</div>
          <div><strong>Due Date:</strong> ${formatDate(invoice.dueDate)}</div>
        </div>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Tax</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${item.description}</td>
            <td>${item.quantity.toFixed(2)}</td>
            <td>${formatCurrency(item.unitPrice, invoice.currency)}</td>
            <td>${item.taxPercent || 0}%</td>
            <td style="text-align: right;">${formatCurrency(item.total, invoice.currency)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal:</span>
        <span>${formatCurrency(subtotal, invoice.currency)}</span>
      </div>
      <div class="totals-row">
        <span>Tax:</span>
        <span>${formatCurrency(taxAmount, invoice.currency)}</span>
      </div>
      <div class="totals-row total">
        <span>Total:</span>
        <span>${formatCurrency(total, invoice.currency)}</span>
      </div>
    </div>

    <div class="amount-due">
      <div class="amount-due-label">Amount Due</div>
      <div class="amount-due-value">${formatCurrency(total, invoice.currency)}</div>
    </div>

    <div style="text-align: center;">
      <a href="/api/invoices/${invoiceId}/pdf?token=${token}" class="download-btn">Download PDF</a>
    </div>

    <div class="footer">
      <div class="footer-text">
        Thank you for your business!<br>
        Generated by Finverse
      </div>
    </div>
  </div>
</body>
</html>
      `;

      res.send(html);
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
