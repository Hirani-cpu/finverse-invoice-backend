/**
 * SMS Service - Twilio and Vonage integration
 */
const Handlebars = require('handlebars');
const { parsePhoneNumber } = require('libphonenumber-js');
const config = require('../config');
const logger = require('../utils/logger');

class SMSService {
  async init(settings) {
    const provider = settings?.sms_provider || 'twilio';

    if (provider === 'twilio' && config.sms.twilio.accountSid) {
      this.client = require('twilio')(
        config.sms.twilio.accountSid,
        config.sms.twilio.authToken
      );
      this.providerName = 'twilio';
      this.fromNumber = settings.sms_from || config.sms.twilio.phoneNumber;
    } else if (provider === 'vonage' && config.sms.vonage.apiKey) {
      const { Vonage } = require('@vonage/server-sdk');
      this.client = new Vonage({
        apiKey: config.sms.vonage.apiKey,
        apiSecret: config.sms.vonage.apiSecret,
      });
      this.providerName = 'vonage';
      this.fromNumber = settings.sms_from || config.sms.vonage.phoneNumber;
    } else {
      throw new Error(`SMS provider not configured: ${provider}`);
    }

    logger.info(`SMS service initialized with ${this.providerName}`);
  }

  async sendInvoiceSMS(params) {
    const { to, customerName, invoiceData, invoiceUrl, settings } = params;

    try {
      // Validate and format phone number
      const phoneNumber = this.validatePhoneNumber(to);

      // Render message
      const message = this.renderMessage({
        customerName,
        invoiceData,
        invoiceUrl,
        settings,
      });

      // Send via provider
      let result;
      if (this.providerName === 'twilio') {
        result = await this.sendViaTwilio(phoneNumber, message);
      } else if (this.providerName === 'vonage') {
        result = await this.sendViaVonage(phoneNumber, message);
      }

      logger.info(`SMS sent to ${phoneNumber}`, { messageId: result.messageId });

      return {
        success: true,
        provider: this.providerName,
        messageId: result.messageId,
        response: result.response,
      };
    } catch (error) {
      logger.error('SMS send failed:', error);
      throw {
        success: false,
        provider: this.providerName,
        error: error.message,
        errorCode: error.code,
      };
    }
  }

  validatePhoneNumber(phone) {
    try {
      const parsed = parsePhoneNumber(phone, 'US');
      if (!parsed.isValid()) {
        throw new Error('Invalid phone number');
      }
      return parsed.format('E.164');
    } catch (error) {
      throw new Error(`Invalid phone number: ${phone}`);
    }
  }

  renderMessage(params) {
    const { customerName, invoiceData, invoiceUrl, settings } = params;

    const template = Handlebars.compile(
      settings.sms_template ||
      'Hi {{customer_name}}, invoice {{invoice_number}} ({{amount_due}}) is ready. View: {{invoice_link}}'
    );

    return template({
      customer_name: customerName,
      invoice_number: invoiceData.invoiceNumber,
      amount_due: `$${invoiceData.grandTotal.toFixed(2)}`,
      invoice_link: invoiceUrl,
    });
  }

  async sendViaTwilio(to, message) {
    const result = await this.client.messages.create({
      body: message,
      from: this.fromNumber,
      to,
    });

    return {
      messageId: result.sid,
      response: result,
    };
  }

  async sendViaVonage(to, message) {
    return new Promise((resolve, reject) => {
      this.client.message.sendSms(
        this.fromNumber,
        to,
        message,
        (err, response) => {
          if (err) return reject(err);
          resolve({
            messageId: response.messages[0]['message-id'],
            response,
          });
        }
      );
    });
  }
}

module.exports = new SMSService();
