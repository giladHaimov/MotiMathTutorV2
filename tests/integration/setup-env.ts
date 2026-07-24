// Ensure required configuration exists in every test worker. Values are safe
// test defaults; real CI provides DATABASE_URL for its Postgres service.
function setDefault(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

setDefault('NODE_ENV', 'test');
setDefault('DATABASE_URL', 'postgres://postgres:postgres@localhost:5439/reasoning_tutor');
setDefault('BETTER_AUTH_SECRET', 'integration-test-secret-please-change-32');
setDefault('BETTER_AUTH_URL', 'http://localhost:8080');
setDefault('TRUSTED_ORIGINS', 'http://localhost:8080');
setDefault('LOG_LEVEL', 'silent');
setDefault('ENGINE_VERSION', '1.0.0');
