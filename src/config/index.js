/**
 * Configuration Management
 * Centralizes all environment variables and configuration
 */

require('dotenv').config();

const config = {
  // Application
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 3000,
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  apiSecretKey: process.env.API_SECRET_KEY,

  // Database
  database: {
    path: process.env.DB_PATH || './data/invoices.db',
    poolMin: parseInt(process.env.DB_POOL_MIN) || 2,
    poolMax: parseInt(process.env.DB_POOL_MAX) || 10,
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB) || 0,
  },

  // Storage
  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    localPath: process.env.STORAGE_LOCAL_PATH || './storage/invoices',
    baseUrl: process.env.STORAGE_BASE_URL,
    s3: {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      bucketName: process.env.S3_BUCKET_NAME,
      presignedUrlExpiry: parseInt(process.env.S3_PRESIGNED_URL_EXPIRY) || 604800,
    },
  },

  // Email Providers
  email: {
    from: process.env.EMAIL_FROM || 'invoices@yourcompany.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Your Company',
    replyTo: process.env.EMAIL_REPLY_TO,

    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY,
    },

    mailgun: {
      apiKey: process.env.MAILGUN_API_KEY,
      domain: process.env.MAILGUN_DOMAIN,
      host: process.env.MAILGUN_HOST || 'api.mailgun.net',
    },

    ses: {
      region: process.env.AWS_SES_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_SES_ACCESS_KEY,
      secretAccessKey: process.env.AWS_SES_SECRET_KEY,
    },
  },

  // SMS Providers
  sms: {
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    },

    vonage: {
      apiKey: process.env.VONAGE_API_KEY,
      apiSecret: process.env.VONAGE_API_SECRET,
      phoneNumber: process.env.VONAGE_PHONE_NUMBER,
    },
  },

  // PDF Generation
  pdf: {
    generator: process.env.PDF_GENERATOR || 'puppeteer',
    puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    pageFormat: process.env.PDF_PAGE_FORMAT || 'A4',
    margin: {
      top: process.env.PDF_MARGIN_TOP || '20mm',
      bottom: process.env.PDF_MARGIN_BOTTOM || '20mm',
      left: process.env.PDF_MARGIN_LEFT || '15mm',
      right: process.env.PDF_MARGIN_RIGHT || '15mm',
    },
  },

  // Queue
  queue: {
    concurrentJobs: parseInt(process.env.QUEUE_CONCURRENT_JOBS) || 5,
    maxRetryAttempts: parseInt(process.env.QUEUE_MAX_RETRY_ATTEMPTS) || 3,
    retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY) || 300000, // 5 minutes
    backoffType: process.env.QUEUE_BACKOFF_TYPE || 'exponential',
  },

  // Security
  security: {
    signedUrlSecret: process.env.SIGNED_URL_SECRET || 'change-this-secret',
    signedUrlExpiryDays: parseInt(process.env.SIGNED_URL_EXPIRY_DAYS) || 7,
    jwtSecret: process.env.JWT_SECRET || 'change-this-jwt-secret',
    jwtExpiry: process.env.JWT_EXPIRY || '24h',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/app.log',
  },

  // Monitoring
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },

  // Webhooks
  webhooks: {
    secret: process.env.WEBHOOK_SECRET,
    sendgridUrl: process.env.SENDGRID_WEBHOOK_URL || '/webhooks/sendgrid',
    twilioUrl: process.env.TWILIO_WEBHOOK_URL || '/webhooks/twilio',
  },

  // Feature Flags
  features: {
    autoSendEmail: process.env.FEATURE_AUTO_SEND_EMAIL === 'true',
    autoSendSMS: process.env.FEATURE_AUTO_SEND_SMS === 'true',
    emailTracking: process.env.FEATURE_EMAIL_TRACKING === 'true',
    smsTracking: process.env.FEATURE_SMS_TRACKING === 'true',
  },

  // GDPR
  gdpr: {
    dataRetentionDays: parseInt(process.env.GDPR_DATA_RETENTION_DAYS) || 2555,
    requireConsent: process.env.GDPR_REQUIRE_CONSENT === 'true',
  },
};

// Validation
const validateConfig = () => {
  // Only validate API secret key in production if explicitly required
  const required = [];
  if (config.env === 'production' && process.env.REQUIRE_API_SECRET === 'true') {
    required.push('apiSecretKey');
  }

  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  // Warn about defaults in production
  if (config.env === 'production') {
    if (config.security.signedUrlSecret === 'change-this-secret') {
      console.warn('WARNING: Using default SIGNED_URL_SECRET in production!');
    }
    if (config.security.jwtSecret === 'change-this-jwt-secret') {
      console.warn('WARNING: Using default JWT_SECRET in production!');
    }
  }
};

validateConfig();

module.exports = config;
