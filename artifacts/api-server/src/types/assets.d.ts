/**
 * Files imported for their contents rather than for code.
 *
 * The runtime image contains only `dist/` and `lib/` (see the Dockerfile), so
 * anything the server needs to *serve* has to be inlined into the bundle at
 * build time rather than read from disk — a file read works locally and 404s in
 * production. `build.mjs` does that with esbuild's loaders; these declarations
 * are what makes `tsc --noEmit` agree.
 *
 * Keep the three producers in step: the loader map in `build.mjs`, the plugins
 * in `vitest.config.ts`, and this file. A mismatch is a test suite that cannot
 * parse the module, or a typecheck that passes over a build that does not.
 */

/** `loader: { ".html": "text" }` — the landing page. */
declare module "*.html" {
  const content: string;
  export default content;
}

/**
 * `loader: { ".woff2": "base64" }` — the page's three self-hosted faces.
 *
 * base64 rather than esbuild's `binary`, which emits `Uint8Array.fromBase64` —
 * a method Node 22 does not have, and node:22-alpine is the runtime. The caller
 * decodes with `Buffer.from(value, "base64")`.
 */
declare module "*.woff2" {
  const base64: string;
  export default base64;
}

/** `loader: { ".png": "base64" }` — the Apple touch icon. Same reasoning. */
declare module "*.png" {
  const base64: string;
  export default base64;
}
