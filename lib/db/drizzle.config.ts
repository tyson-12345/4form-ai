import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

/**
 * Load the API server's .env so `drizzle-kit push` works without exporting
 * DATABASE_URL by hand.
 *
 * Doing it here rather than in the npm script is deliberate: the `.bin/`
 * entries pnpm creates are shell wrappers, not JavaScript, so
 * `node --env-file=… ./node_modules/.bin/drizzle-kit` fails with a syntax
 * error. Loading inside the config keeps the invocation plain
 * (`pnpm exec drizzle-kit push`) and keeps the connection string out of shell
 * history either way.
 */
const ENV_PATH = path.join(__dirname, "../../artifacts/api-server/.env");
if (!process.env.DATABASE_URL && fs.existsSync(ENV_PATH)) {
  process.loadEnvFile(ENV_PATH);
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    `DATABASE_URL is not set, and none was found in ${ENV_PATH}. ` +
      "Set it with: node scripts/src/set-database-url.mjs",
  );
}

/**
 * TLS material, if the provider needs a CA this machine does not already trust.
 *
 * Supabase signs with its own CA, so without this `push` fails with
 * SELF_SIGNED_CERT_IN_CHAIN even though the connection string is correct. The
 * runtime pool reads the same variable — see lib/db/src/index.ts — so the two
 * paths cannot drift apart and leave `push` working while the server cannot
 * connect.
 */
function caCert(): string | undefined {
  const value = process.env.DATABASE_CA_CERT;
  if (!value) return undefined;
  if (value.includes("BEGIN CERTIFICATE")) return value.replace(/\\n/g, "\n");

  const resolved = value.startsWith("~")
    ? path.join(process.env.HOME ?? "", value.slice(1))
    : path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new Error(`DATABASE_CA_CERT points at "${resolved}", which does not exist.`);
  }
  return fs.readFileSync(resolved, "utf8");
}

const ca = caCert();

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    // Verification stays on. A CA is supplied when the provider needs one;
    // disabling verification instead would keep the encryption and discard the
    // authentication.
    ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true },
  },
});
