/**
 * PDF Generator Service
 * Generates professional invoices using Puppeteer
 */

const puppeteer = require('puppeteer');
const Handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

class PDFGenerator {
  constructor() {
    this.browser = null;
  }

  /**
   * Initialize browser instance (reuse for performance)
   */
  async init() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
        executablePath: config.pdf.puppeteerExecutablePath || undefined,
      });
      logger.info('PDF Generator: Browser initialized');
    }
    return this.browser;
  }

  /**
   * Close browser instance
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('PDF Generator: Browser closed');
    }
  }

  /**
   * Generate PDF from invoice data
   * @param {Object} invoiceData - Invoice data including items, customer, etc.
   * @param {Object} companyData - Company information
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateInvoicePDF(invoiceData, companyData) {
    try {
      await this.init();

      // Load HTML template
      const templatePath = path.join(__dirname, '../templates/invoice.html');
      const templateSource = await fs.readFile(templatePath, 'utf8');
      const template = Handlebars.compile(templateSource);

      // Prepare data for template
      const templateData = this.prepareTemplateData(invoiceData, companyData);

      // Generate HTML
      const html = template(templateData);

      // Create new page
      const page = await this.browser.newPage();

      try {
        // Set content
        await page.setContent(html, {
          waitUntil: 'networkidle0',
        });

        // Generate PDF
        const pdfBuffer = await page.pdf({
          format: config.pdf.pageFormat,
          margin: config.pdf.margin,
          printBackground: true,
          preferCSSPageSize: false,
        });

        logger.info(`PDF generated for invoice ${invoiceData.invoiceNumber}`);
        return pdfBuffer;
      } finally {
        await page.close();
      }
    } catch (error) {
      logger.error('PDF generation failed:', error);
      throw new Error(`PDF generation failed: ${error.message}`);
    }
  }

  /**
   * Prepare data for template rendering
   */
  prepareTemplateData(invoiceData, companyData) {
    // Calculate totals
    const subtotal = invoiceData.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );

    const taxAmount = invoiceData.items.reduce(
      (sum, item) => sum + (item.quantity * item.unitPrice * item.taxPercent) / 100,
      0
    );

    const discountAmount = invoiceData.discountTotal || 0;
    const shippingAmount = invoiceData.shippingAmount || 0;
    const grandTotal = subtotal + taxAmount - discountAmount + shippingAmount;

    return {
      // Company Information
      companyName: companyData.name || 'Your Company',
      companyAddress: companyData.address || '',
      companyPhone: companyData.phone || '',
      companyEmail: companyData.email || '',
      companyTaxNumber: companyData.taxNumber || '',
      companyLogo: companyData.logoPath || '',
      companyWebsite: companyData.website || '',

      // Invoice Information
      invoiceNumber: invoiceData.invoiceNumber,
      invoiceDate: this.formatDate(invoiceData.invoiceDate),
      dueDate: this.formatDate(invoiceData.dueDate),
      status: invoiceData.status,
      paymentTerms: invoiceData.paymentTerms || 'Net 30',

      // Customer Information
      customerName: invoiceData.customerName,
      customerAddress: invoiceData.customerAddress,
      customerPhone: invoiceData.customerPhone || '',
      customerEmail: invoiceData.customerEmail || '',
      customerTaxNumber: invoiceData.customerTaxNumber || '',

      // Line Items
      items: invoiceData.items.map(item => ({
        description: item.description,
        quantity: item.quantity.toFixed(2),
        unitPrice: this.formatCurrency(item.unitPrice, invoiceData.currency),
        taxPercent: item.taxPercent.toFixed(1),
        total: this.formatCurrency(item.total, invoiceData.currency),
      })),

      // Financial Information
      currency: invoiceData.currency,
      currencySymbol: this.getCurrencySymbol(invoiceData.currency),
      subtotal: this.formatCurrency(subtotal, invoiceData.currency),
      taxAmount: this.formatCurrency(taxAmount, invoiceData.currency),
      discountAmount: this.formatCurrency(discountAmount, invoiceData.currency),
      shippingAmount: this.formatCurrency(shippingAmount, invoiceData.currency),
      grandTotal: this.formatCurrency(grandTotal, invoiceData.currency),
      paidAmount: this.formatCurrency(invoiceData.paidAmount || 0, invoiceData.currency),
      balanceDue: this.formatCurrency(invoiceData.balanceDue || grandTotal, invoiceData.currency),

      // Payment Information (if provided)
      bankName: invoiceData.bankName || '',
      accountNumber: invoiceData.accountNumber || '',
      ifscCode: invoiceData.ifscCode || '',
      accountHolderName: invoiceData.accountHolderName || '',

      // Additional Information
      notes: invoiceData.notes || '',
      termsAndConditions: invoiceData.termsAndConditions || '',

      // QR Code / Payment Link
      paymentLink: invoiceData.paymentLink || '',
      qrCodeData: invoiceData.qrCodeData || '',

      // Display Flags
      showLogo: !!companyData.logoPath,
      showDiscount: discountAmount > 0,
      showShipping: shippingAmount > 0,
      showPaymentInfo: !!invoiceData.bankName,
      showNotes: !!invoiceData.notes,
      showTerms: !!invoiceData.termsAndConditions,
      showQRCode: !!invoiceData.qrCodeData,
      showBalanceDue: invoiceData.balanceDue > 0,

      // Styling
      colorScheme: companyData.colorScheme || 'blue',
      primaryColor: this.getColorFromScheme(companyData.colorScheme || 'blue'),

      // Generation Info
      generatedAt: this.formatDate(new Date()),
    };
  }

  /**
   * Format date for display
   */
  formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /**
   * Format currency for display
   */
  formatCurrency(amount, currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  }

  /**
   * Get currency symbol
   */
  getCurrencySymbol(currency) {
    const symbols = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      INR: '₹',
      JPY: '¥',
      AUD: 'A$',
      CAD: 'C$',
    };
    return symbols[currency] || currency;
  }

  /**
   * Get color from scheme
   */
  getColorFromScheme(scheme) {
    const colors = {
      blue: '#1976D2',
      green: '#388E3C',
      red: '#D32F2F',
      orange: '#F57C00',
      purple: '#7B1FA2',
      grey: '#616161',
    };
    return colors[scheme] || colors.blue;
  }

  /**
   * Generate file hash for integrity verification
   */
  generateFileHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Save PDF to storage
   * @param {Buffer} pdfBuffer - PDF content
   * @param {string} fileName - File name
   * @returns {Promise<Object>} Storage information
   */
  async savePDF(pdfBuffer, fileName) {
    try {
      const fileHash = this.generateFileHash(pdfBuffer);
      const fileSize = pdfBuffer.length;

      if (config.storage.type === 'local') {
        // Save to local filesystem
        const filePath = path.join(config.storage.localPath, fileName);

        // Ensure directory exists
        await fs.mkdir(config.storage.localPath, { recursive: true });

        // Write file
        await fs.writeFile(filePath, pdfBuffer);

        logger.info(`PDF saved locally: ${filePath}`);

        return {
          fileName,
          filePath,
          fileSize,
          fileHash,
          storageType: 'local',
          publicUrl: `${config.storage.baseUrl}/${fileName}`,
        };
      } else if (config.storage.type === 's3') {
        // Save to AWS S3 (implementation below)
        const s3Result = await this.saveToS3(pdfBuffer, fileName);

        return {
          fileName,
          filePath: s3Result.key,
          fileSize,
          fileHash,
          storageType: 's3',
          publicUrl: s3Result.url,
        };
      }

      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    } catch (error) {
      logger.error('Failed to save PDF:', error);
      throw error;
    }
  }

  /**
   * Save PDF to AWS S3
   */
  async saveToS3(pdfBuffer, fileName) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const s3Client = new S3Client({
      region: config.storage.s3.region,
      credentials: {
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey,
      },
    });

    const key = `invoices/${fileName}`;

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.storage.s3.bucketName,
        Key: key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        ContentDisposition: `attachment; filename="${fileName}"`,
      })
    );

    // Generate signed URL
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const command = new GetObjectCommand({
      Bucket: config.storage.s3.bucketName,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, {
      expiresIn: config.storage.s3.presignedUrlExpiry,
    });

    logger.info(`PDF uploaded to S3: ${key}`);

    return { key, url };
  }
}

// Register Handlebars helpers
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('gt', (a, b) => a > b);
Handlebars.registerHelper('lt', (a, b) => a < b);
Handlebars.registerHelper('add', (a, b) => a + b);
Handlebars.registerHelper('multiply', (a, b) => a * b);

module.exports = new PDFGenerator();
