/**
 * Simple PDF Generator using PDFKit
 * No Chromium/Puppeteer needed - works everywhere!
 */

const PDFDocument = require('pdfkit');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

class SimplePDFGenerator {
  /**
   * Generate PDF from invoice data
   */
  async generateInvoicePDF(invoiceData, companyData) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];

        // Collect PDF data
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Add content
        this.addHeader(doc, companyData);
        this.addInvoiceInfo(doc, invoiceData);
        this.addCustomerInfo(doc, invoiceData);
        this.addItemsTable(doc, invoiceData);
        this.addTotals(doc, invoiceData);
        this.addFooter(doc, invoiceData);

        doc.end();
      } catch (error) {
        logger.error('PDF generation error:', error);
        reject(error);
      }
    });
  }

  addHeader(doc, companyData) {
    // Company name
    doc.fontSize(24)
       .fillColor('#2563eb')
       .text(companyData.name || 'Finverse', 50, 50);

    // Company details
    doc.fontSize(10)
       .fillColor('#666666')
       .text(companyData.email || 'noreply@finverse.info', 50, 80);

    // Horizontal line
    doc.moveTo(50, 110)
       .lineTo(550, 110)
       .strokeColor('#e5e7eb')
       .stroke();

    doc.moveDown(3);
  }

  addInvoiceInfo(doc, invoiceData) {
    const startY = 130;

    doc.fontSize(16)
       .fillColor('#111827')
       .text('INVOICE', 400, startY);

    doc.fontSize(10)
       .fillColor('#666666')
       .text(`Invoice #: ${invoiceData.invoiceNumber}`, 400, startY + 25)
       .text(`Date: ${this.formatDate(invoiceData.invoiceDate)}`, 400, startY + 40)
       .text(`Due Date: ${this.formatDate(invoiceData.dueDate)}`, 400, startY + 55);

    doc.moveDown(2);
  }

  addCustomerInfo(doc, invoiceData) {
    const startY = 200;

    doc.fontSize(12)
       .fillColor('#111827')
       .text('Bill To:', 50, startY);

    doc.fontSize(10)
       .fillColor('#666666')
       .text(invoiceData.customerName, 50, startY + 20)
       .text(invoiceData.customerEmail || '', 50, startY + 35);

    if (invoiceData.customerPhone) {
      doc.text(invoiceData.customerPhone, 50, startY + 50);
    }

    doc.moveDown(3);
  }

  addItemsTable(doc, invoiceData) {
    const tableTop = 300;
    const itemCodeX = 50;
    const descriptionX = 150;
    const quantityX = 350;
    const priceX = 420;
    const amountX = 490;

    // Table header
    doc.fontSize(10)
       .fillColor('#111827')
       .text('Item', itemCodeX, tableTop)
       .text('Description', descriptionX, tableTop)
       .text('Qty', quantityX, tableTop)
       .text('Price', priceX, tableTop)
       .text('Amount', amountX, tableTop);

    // Header underline
    doc.moveTo(50, tableTop + 15)
       .lineTo(550, tableTop + 15)
       .strokeColor('#e5e7eb')
       .stroke();

    // Items
    let yPosition = tableTop + 30;
    const items = JSON.parse(invoiceData.items || '[]');

    items.forEach((item, index) => {
      const y = yPosition + (index * 25);

      doc.fontSize(9)
         .fillColor('#666666')
         .text(index + 1, itemCodeX, y)
         .text(item.description, descriptionX, y, { width: 180 })
         .text(item.quantity.toFixed(2), quantityX, y)
         .text(this.formatCurrency(item.unitPrice, invoiceData.currency), priceX, y)
         .text(this.formatCurrency(item.total, invoiceData.currency), amountX, y);
    });

    return yPosition + (items.length * 25) + 20;
  }

  addTotals(doc, invoiceData) {
    const items = JSON.parse(invoiceData.items || '[]');
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const taxAmount = items.reduce((sum, item) =>
      sum + (item.total * item.taxPercent / 100), 0
    );
    const total = subtotal + taxAmount;

    const totalsX = 400;
    let y = 500;

    // Subtotal
    doc.fontSize(10)
       .fillColor('#666666')
       .text('Subtotal:', totalsX, y)
       .text(this.formatCurrency(subtotal, invoiceData.currency), 490, y);

    // Tax
    y += 20;
    doc.text('Tax:', totalsX, y)
       .text(this.formatCurrency(taxAmount, invoiceData.currency), 490, y);

    // Line
    doc.moveTo(totalsX, y + 15)
       .lineTo(550, y + 15)
       .strokeColor('#e5e7eb')
       .stroke();

    // Total
    y += 25;
    doc.fontSize(12)
       .fillColor('#111827')
       .text('Total:', totalsX, y)
       .text(this.formatCurrency(total, invoiceData.currency), 490, y);

    // Amount Due
    y += 30;
    doc.fontSize(14)
       .fillColor('#2563eb')
       .text('Amount Due:', totalsX, y)
       .text(this.formatCurrency(total, invoiceData.currency), 490, y);
  }

  addFooter(doc, invoiceData) {
    doc.fontSize(8)
       .fillColor('#999999')
       .text('Thank you for your business!', 50, 700, { align: 'center', width: 500 })
       .text('Generated by Finverse', 50, 720, { align: 'center', width: 500 });
  }

  formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatCurrency(amount, currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  }

  generateFileHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async savePDF(pdfBuffer, fileName) {
    try {
      const fileHash = this.generateFileHash(pdfBuffer);
      const fileSize = pdfBuffer.length;

      if (config.storage.type === 'local') {
        const filePath = path.join(config.storage.localPath, fileName);
        await fs.mkdir(config.storage.localPath, { recursive: true });
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
      }

      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    } catch (error) {
      logger.error('Failed to save PDF:', error);
      throw error;
    }
  }
}

module.exports = new SimplePDFGenerator();
