/**
 * Email Service
 * Handles sending emails via SendGrid, Mailgun, or AWS SES
 */

const Handlebars = require('handlebars');
const config = require('../config');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.provider = null;
    this.providerName = null;
  }

  /**
   * Initialize email provider based on configuration
   */
  async init(settings) {
    const provider = settings?.email_provider || 'sendgrid';

    try {
      if (provider === 'sendgrid' && config.email.sendgrid.apiKey) {
        this.provider = await this.initSendGrid();
        this.providerName = 'sendgrid';
      } else if (provider === 'mailgun' && config.email.mailgun.apiKey) {
        this.provider = await this.initMailgun();
        this.providerName = 'mailgun';
      } else if (provider === 'ses' && config.email.ses.accessKeyId) {
        this.provider = await this.initSES();
        this.providerName = 'ses';
      } else {
        throw new Error(`Email provider not configured: ${provider}`);
      }

      logger.info(`Email service initialized with ${this.providerName}`);
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
      throw error;
    }
  }

  /**
   * Initialize SendGrid
   */
  async initSendGrid() {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(config.email.sendgrid.apiKey);
    return sgMail;
  }

  /**
   * Initialize Mailgun
   */
  async initMailgun() {
    const formData = require('form-data');
    const Mailgun = require('mailgun.js');
    const mailgun = new Mailgun(formData);

    return mailgun.client({
      username: 'api',
      key: config.email.mailgun.apiKey,
      url: `https://${config.email.mailgun.host}`,
    });
  }

  /**
   * Initialize AWS SES
   */
  async initSES() {
    const { SESClient } = require('@aws-sdk/client-ses');

    return new SESClient({
      region: config.email.ses.region,
      credentials: {
        accessKeyId: config.email.ses.accessKeyId,
        secretAccessKey: config.email.ses.secretAccessKey,
      },
    });
  }

  /**
   * Send invoice email with PDF attachment
   * @param {Object} params - Email parameters
   * @returns {Promise<Object>} Send result with message ID
   */
  async sendInvoiceEmail(params) {
    const {
      to,
      customerName,
      invoiceData,
      pdfBuffer,
      pdfFileName,
      invoiceUrl,
      unsubscribeUrl,
      settings,
    } = params;

    try {
      // Render email template
      const { subject, htmlBody, textBody } = await this.renderTemplate({
        customerName,
        invoiceData,
        invoiceUrl,
        unsubscribeUrl,
        settings,
      });

      // Prepare email data
      const emailData = {
        to,
        from: {
          email: settings.email_from || config.email.from,
          name: settings.email_from_name || config.email.fromName,
        },
        replyTo: config.email.replyTo,
        subject,
        html: htmlBody,
        text: textBody,
        customArgs: {
          invoice_id: String(invoiceData.id),
          invoice_number: invoiceData.invoiceNumber,
        },
        trackingSettings: {
          clickTracking: { enable: config.features.emailTracking },
          openTracking: { enable: config.features.emailTracking },
        },
      };

      // Only add PDF attachment if buffer exists
      if (pdfBuffer) {
        emailData.attachments = [
          {
            content: pdfBuffer.toString('base64'),
            filename: pdfFileName,
            type: 'application/pdf',
            disposition: 'attachment',
          },
        ];
      }

      // Send based on provider
      let result;
      if (this.providerName === 'sendgrid') {
        result = await this.sendViaSendGrid(emailData);
      } else if (this.providerName === 'mailgun') {
        result = await this.sendViaMailgun(emailData);
      } else if (this.providerName === 'ses') {
        result = await this.sendViaSES(emailData);
      }

      logger.info(`Email sent to ${to} via ${this.providerName}`, {
        messageId: result.messageId,
        invoiceId: invoiceData.id,
      });

      return {
        success: true,
        provider: this.providerName,
        messageId: result.messageId,
        response: result.response,
      };
    } catch (error) {
      logger.error('Email send failed:', error);
      throw {
        success: false,
        provider: this.providerName,
        error: error.message,
        errorCode: error.code,
        response: error.response?.body || error.response,
      };
    }
  }

  /**
   * Send via SendGrid
   */
  async sendViaSendGrid(emailData) {
    const msg = {
      to: emailData.to,
      from: emailData.from,
      replyTo: emailData.replyTo,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      attachments: emailData.attachments,
      customArgs: emailData.customArgs,
      trackingSettings: emailData.trackingSettings,
    };

    const response = await this.provider.send(msg);
    return {
      messageId: response[0].headers['x-message-id'],
      response: response[0],
    };
  }

  /**
   * Send via Mailgun
   */
  async sendViaMailgun(emailData) {
    const messageData = {
      from: `${emailData.from.name} <${emailData.from.email}>`,
      to: emailData.to,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      attachment: emailData.attachments.map(att => ({
        data: Buffer.from(att.content, 'base64'),
        filename: att.filename,
      })),
      'v:invoice_id': emailData.customArgs.invoice_id,
      'v:invoice_number': emailData.customArgs.invoice_number,
    };

    if (emailData.replyTo) {
      messageData['h:Reply-To'] = emailData.replyTo;
    }

    const response = await this.provider.messages.create(
      config.email.mailgun.domain,
      messageData
    );

    return {
      messageId: response.id,
      response,
    };
  }

  /**
   * Send via AWS SES
   */
  async sendViaSES(emailData) {
    const { SendRawEmailCommand } = require('@aws-sdk/client-ses');
    const nodemailer = require('nodemailer');

    // Create transporter using SES
    const transporter = nodemailer.createTransport({
      SES: { ses: this.provider, aws: require('@aws-sdk/client-ses') },
    });

    const mailOptions = {
      from: `${emailData.from.name} <${emailData.from.email}>`,
      to: emailData.to,
      replyTo: emailData.replyTo,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      attachments: emailData.attachments.map(att => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
        contentType: att.type,
      })),
    };

    const info = await transporter.sendMail(mailOptions);

    return {
      messageId: info.messageId,
      response: info,
    };
  }

  /**
   * Render email template with data
   */
  async renderTemplate(params) {
    const {
      customerName,
      invoiceData,
      invoiceUrl,
      unsubscribeUrl,
      settings,
    } = params;

    // Prepare template data
    const templateData = {
      customer_name: customerName,
      company_name: settings.company_name || 'Your Company',
      invoice_number: invoiceData.invoiceNumber,
      invoice_date: this.formatDate(invoiceData.invoiceDate),
      due_date: this.formatDate(invoiceData.dueDate),
      amount_due: this.formatCurrency(
        invoiceData.balanceDue || invoiceData.grandTotal,
        invoiceData.currency
      ),
      invoice_link: invoiceUrl,
      payment_link: invoiceData.paymentLink || '',
      unsubscribe_link: unsubscribeUrl,
      company_address: settings.company_address || '',
      company_phone: settings.company_phone || '',
      company_email: settings.company_email || config.email.from,
    };

    // Compile templates
    const subjectTemplate = Handlebars.compile(
      settings.email_subject_template ||
        'Invoice {{invoice_number}} from {{company_name}}'
    );
    const htmlTemplate = Handlebars.compile(
      settings.email_body_template || this.getDefaultHtmlTemplate()
    );

    // Render
    const subject = subjectTemplate(templateData);
    const htmlBody = htmlTemplate(templateData);
    const textBody = this.htmlToText(htmlBody);

    return { subject, htmlBody, textBody };
  }

  /**
   * Get default HTML template
   */
  getDefaultHtmlTemplate() {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .invoice-box { background: #f9f9f9; padding: 15px; margin: 20px 0; border-left: 4px solid #4CAF50; }
    .button { background: #4CAF50; color: white !important; padding: 12px 24px; text-decoration: none; display: inline-block; border-radius: 4px; }
    .footer { background: #f1f1f1; padding: 20px; text-align: center; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{company_name}}</h1>
    </div>
    <div class="content">
      <h2>Invoice {{invoice_number}}</h2>
      <p>Dear {{customer_name}},</p>
      <p>Thank you for your business! Your invoice is attached to this email.</p>
      <div class="invoice-box">
        <strong>Invoice Number:</strong> {{invoice_number}}<br>
        <strong>Date:</strong> {{invoice_date}}<br>
        <strong>Due Date:</strong> {{due_date}}<br>
        <strong>Amount Due:</strong> {{amount_due}}
      </div>
      <p>
        <a href="{{invoice_link}}" class="button">View Invoice Online</a>
      </p>
      {{#if payment_link}}
      <p>
        <a href="{{payment_link}}" class="button">Pay Now</a>
      </p>
      {{/if}}
      <p>Best regards,<br>{{company_name}}</p>
    </div>
    <div class="footer">
      <p>{{company_address}}</p>
      <p>{{company_phone}} | {{company_email}}</p>
      <p><a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Convert HTML to plain text
   */
  htmlToText(html) {
    return html
      .replace(/<style[^>]*>.*<\/style>/gim, '')
      .replace(/<script[^>]*>.*<\/script>/gim, '')
      .replace(/<[^>]+>/gim, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Format date
   */
  formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Format currency
   */
  formatCurrency(amount, currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  }
}

module.exports = new EmailService();
