/* A separate database, so running the tests never touches development data. */
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '5432';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'edupyramids_test';
process.env.DB_USER = process.env.TEST_DB_USER || 'postgres';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';
process.env.JWT_EXPIRY = '1h';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.SCHOOL_AUTH_URL = '';
process.env.LOGIN_MAX_ATTEMPTS = '5';
process.env.LOGIN_WINDOW_MINUTES = '15';
