require('dotenv').config();

const corsOrigins = [
  process.env.CORS_ORIGINS,
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://hrms.spaxads.net',
  'https://hrms-ten-lac.vercel.app',
]
  .filter(Boolean)
  .join(',')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

const uniqueCorsOrigins = [...new Set(corsOrigins)];

module.exports = {
  env: process.env.NODE_ENV || 'development',
  // Render (and most PaaS) require binding 0.0.0.0 — 127.0.0.1 fails health checks.
  host: process.env.HOST
    || (process.env.RENDER || process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  port: parseInt(process.env.PORT, 10) || 5000,
  timezone: process.env.TZ || 'Asia/Kolkata',
  workHours: parseFloat(process.env.WORK_HOURS) || 9,
  autoCheckoutTime: process.env.AUTO_CHECKOUT_TIME || '04:00',
  officeIp: process.env.OFFICE_IP || '182.69.179.236',
  officeCidr: process.env.OFFICE_CIDR || '182.69.179.236/32',
  allowRemoteLogin: process.env.ALLOW_REMOTE_LOGIN === 'true',
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expire: process.env.JWT_EXPIRE || '24h',
    refreshExpire: process.env.JWT_REFRESH_EXPIRE || '7d',
  },
  cors: {
    origin(origin, callback) {
      // Requests without Origin are server-to-server tools such as curl/Postman.
      if (!origin || uniqueCorsOrigins.includes(origin.replace(/\/$/, ''))) {
        return callback(null, true);
      }
      const error = new Error('Origin not allowed by CORS');
      error.statusCode = 403;
      error.code = 'CORS_FORBIDDEN';
      return callback(error);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'ngrok-skip-browser-warning'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 86400,
  },
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5242880,
    allowedTypes: (process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,jpg,jpeg,png').split(','),
  },
  rateLimit: {
    windowMs: (parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 1) * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10,
    bootstrapMax: parseInt(process.env.BOOTSTRAP_RATE_LIMIT_MAX, 10) || 10,
    onboardingOtpMax: parseInt(process.env.ONBOARDING_OTP_RATE_LIMIT_MAX, 10) || 30,
    admsMax: parseInt(process.env.ADMS_RATE_LIMIT_MAX, 10) || 120,
  },
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  leaveBalances: {
    CL: 12,
    SL: 12,
    EL: 15,
  },
};
