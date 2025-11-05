/**
 * Invoice Worker - Processes PDF generation and email/SMS sending
 */
const invoiceQueue = require('../queue/invoiceQueue');
const db = require('../utils/db');
const pdfGenerator = require('../services/pdfGeneratorSimple'); // Using PDFKit (no Chromium needed)
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const { generateSignedUrl } = require('../utils/urlSigning');
const config = require('../config');
const logger = require('../utils/logger');

// Process invoice sending jobs
invoiceQueue.process('send-invoice', config.queue.concurrentJobs, async (job) => {
  const { invoiceId, invoiceData, triggeredBy, triggerType } = job.data;

  logger.info(`Processing invoice ${invoiceId}`, { jobId: job.id });

  try {
    // Get settings
    const settings = await db.get('SELECT * FROM invoice_settings WHERE id = 1');

    // Get customer preferences (optional - table may not exist)
    let prefs = null;
    try {
      prefs = await db.get(
        'SELECT * FROM customer_preferences WHERE customer_email = ?',
        [invoiceData.customerEmail]
      );
    } catch (err) {
      // Table doesn't exist yet - that's okay, proceed without preferences
      logger.debug('Customer preferences table not found, proceeding without preference check');
    }

    // Check consent
    if (prefs?.email_unsubscribed) {
      logger.warn(`Customer ${invoiceData.customerEmail} has unsubscribed`);
      return { skipped: true, reason: 'unsubscribed' };
    }

    // Step 1: Generate PDF using PDFKit (no Chromium needed!)
    job.progress(10);
    let pdfBuffer = null;
    let fileName = null;
    let invoiceUrl = null;

    try {
      logger.info(`Generating PDF for invoice ${invoiceId} using PDFKit`);

      // Prepare company data
      const companyData = {
        name: settings.company_name || 'Finverse',
        email: settings.company_email || settings.email_from || 'noreply@finverse.info',
        address: settings.company_address || '',
        phone: settings.company_phone || '',
      };

      // Generate PDF buffer
      pdfBuffer = await pdfGenerator.generateInvoicePDF(invoiceData, companyData);
      fileName = `invoice-${invoiceData.invoiceNumber}.pdf`;

      logger.info(`PDF generated: ${fileName} (${pdfBuffer.length} bytes)`);

      job.progress(25);

      // Save PDF to storage
      const fileInfo = await pdfGenerator.savePDF(pdfBuffer, fileName);

      // Generate signed URL (valid for configured days)
      const signedUrl = generateSignedUrl(
        `/api/invoices/${invoiceId}/pdf`,
        settings.signed_url_expiry_days || 7
      );
      invoiceUrl = signedUrl;

      // Save file record to database
      await db.run(
        `INSERT INTO invoice_files (invoice_id, file_name, file_path, file_size,
         file_hash, storage_type, signed_url, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          invoiceId,
          fileInfo.fileName,
          fileInfo.filePath,
          fileInfo.fileSize,
          fileInfo.fileHash,
          fileInfo.storageType,
          signedUrl,
        ]
      );

      logger.info(`PDF saved and signed URL generated for invoice ${invoiceId}`);
    } catch (pdfError) {
      logger.error(`PDF generation failed for invoice ${invoiceId}:`, pdfError);
      // Continue without PDF - email can still be sent
      pdfBuffer = null;
      fileName = null;
      invoiceUrl = null;
    }

    job.progress(40);

    // Step 2: Send Email
    if (settings.email_enabled && invoiceData.customerEmail) {
      const emailLog = await db.run(
        `INSERT INTO send_logs (invoice_id, send_type, recipient, provider,
         status, triggered_by, trigger_type, queued_at)
         VALUES (?, 'email', ?, ?, 'sending', ?, ?, datetime('now'))`,
        [invoiceId, invoiceData.customerEmail, settings.email_provider, triggeredBy, triggerType]
      );

      try {
        await emailService.init(settings);

        const result = await emailService.sendInvoiceEmail({
          to: invoiceData.customerEmail,
          customerName: invoiceData.customerName,
          invoiceData,
          pdfBuffer,
          pdfFileName: fileName,
          invoiceUrl,
          unsubscribeUrl: `${config.appUrl}/unsubscribe?token=${prefs?.unsubscribe_token || ''}`,
          settings,
        });

        await db.run(
          `UPDATE send_logs SET status = 'sent', provider_message_id = ?,
           provider_response = ?, sent_at = datetime('now') WHERE id = ?`,
          [result.messageId, JSON.stringify(result.response), emailLog.lastID]
        );

        await db.run(
          'UPDATE invoices SET email_sent = 1, email_sent_at = datetime(\'now\') WHERE id = ?',
          [invoiceId]
        );

        logger.info(`Email sent for invoice ${invoiceId}`, { messageId: result.messageId });
      } catch (error) {
        await db.run(
          `UPDATE send_logs SET status = 'failed', error_message = ?,
           error_code = ?, failed_at = datetime('now') WHERE id = ?`,
          [error.error, error.errorCode, emailLog.lastID]
        );
        throw error;
      }
    }

    job.progress(70);

    // Step 3: Send SMS
    if (settings.sms_enabled && invoiceData.customerPhone && prefs?.sms_opt_in) {
      const smsLog = await db.run(
        `INSERT INTO send_logs (invoice_id, send_type, recipient, provider,
         status, triggered_by, trigger_type, queued_at)
         VALUES (?, 'sms', ?, ?, 'sending', ?, ?, datetime('now'))`,
        [invoiceId, invoiceData.customerPhone, settings.sms_provider, triggeredBy, triggerType]
      );

      try {
        await smsService.init(settings);

        const result = await smsService.sendInvoiceSMS({
          to: invoiceData.customerPhone,
          customerName: invoiceData.customerName,
          invoiceData,
          invoiceUrl,
          settings,
        });

        await db.run(
          `UPDATE send_logs SET status = 'sent', provider_message_id = ?,
           sent_at = datetime('now') WHERE id = ?`,
          [result.messageId, smsLog.lastID]
        );

        await db.run(
          'UPDATE invoices SET sms_sent = 1, sms_sent_at = datetime(\'now\') WHERE id = ?',
          [invoiceId]
        );

        logger.info(`SMS sent for invoice ${invoiceId}`);
      } catch (error) {
        await db.run(
          `UPDATE send_logs SET status = 'failed', error_message = ?,
           failed_at = datetime('now') WHERE id = ?`,
          [error.error, smsLog.lastID]
        );
        // Don't throw - email success is enough
        logger.error(`SMS failed for invoice ${invoiceId}:`, error);
      }
    }

    job.progress(100);

    await db.run(
      'UPDATE invoices SET send_status = \'sent\' WHERE id = ?',
      [invoiceId]
    );

    return { success: true, invoiceId, fileName };
  } catch (error) {
    logger.error(`Invoice ${invoiceId} processing failed:`, error);

    await db.run(
      'UPDATE invoices SET send_status = \'failed\' WHERE id = ?',
      [invoiceId]
    );

    throw error;
  }
});

logger.info('Invoice worker started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing worker...');
  await invoiceQueue.close();
  // await pdfGenerator.close(); // Disabled temporarily
  process.exit(0);
});
