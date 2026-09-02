import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    // Everything the server serves but does not execute is inlined here rather
    // than read from disk at runtime: the runtime image contains only dist/ and
    // lib/, so a file read would work locally and 404 in production.
    //
    //   .md    the two legal documents
    //   .html  the landing page (markup, stylesheet and script in one file)
    //   .woff2 its three self-hosted faces
    //   .png   its Apple touch icon
    //
    // The two binary kinds use `base64`, not `binary`, and that is deliberate.
    // esbuild's `binary` loader emits `Uint8Array.fromBase64(...)`, which no
    // Node 22 has — the base image is node:22-alpine, and this build failed at
    // startup with "Uint8Array.fromBase64 is not a function". It compiled, it
    // typechecked and the whole suite passed first; only booting it caught it,
    // which is the same lesson as the @opentelemetry note below. `base64` emits
    // a plain string and the decoding is done explicitly in routes/landingPage.ts.
    //
    // Mirror any change here in vitest.config.ts and src/types/assets.d.ts, or
    // the suite parses something different from what ships.
    loader: { ".md": "text", ".html": "text", ".woff2": "base64", ".png": "base64" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      // "@opentelemetry/*" is deliberately NOT externalized.
      //
      // It was, as part of the precautionary list above. But nothing installs
      // it directly — it arrives as a transitive dependency of @sentry/node —
      // so externalizing it produced a bundle that imported a package tree that
      // was not resolvable from this workspace at runtime. The build succeeded,
      // typecheck passed, all 319 tests passed, and the server then died at
      // startup with ERR_MODULE_NOT_FOUND. Only booting it caught this.
      //
      // These packages are plain JavaScript with no native bindings, so
      // bundling them is fine.
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
