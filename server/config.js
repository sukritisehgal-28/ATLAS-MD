// Shared runtime configuration.
//
// The JWT signing key has a development default so `npm start` works with no setup,
// but that default is public (this repo is open source) — so in production a real
// secret is mandatory and the server refuses to boot without one.

export const isProduction = process.env.NODE_ENV === 'production';

const DEV_JWT_SECRET = 'atlas-dev-secret-change-in-production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET is required in production — refusing to start with the built-in development key. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

export const JWT_SECRET = process.env.JWT_SECRET || DEV_JWT_SECRET;
