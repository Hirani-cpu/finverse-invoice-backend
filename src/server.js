/**
 * Main Express Server
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const logger = require('./utils/logger');
const invoiceRoutes = require('./routes/invoices');
// const webhookRoutes = require('./routes/webhooks'); // Optional - for provider webhooks

const app = express();

// Trust Railway proxy for rate limiting and client IP detection
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: 'Too many requests, please try again later.',
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// Logging
app.use(require('morgan')('combined', {
  stream: { write: message => logger.info(message.trim()) }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/invoices', invoiceRoutes);
// app.use('/webhooks', webhookRoutes); // Optional - for provider webhooks

// Error handler
app.use((err, req, res, next) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal server error',
      ...(config.env === 'development' && { stack: err.stack }),
    },
  });
});

// Initialize database (ensure tables are created before server starts)
const db = require('./utils/db');

// Load worker to register queue processors
require('./workers/invoice-worker');

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${config.env} mode`);
});

module.exports = app;
