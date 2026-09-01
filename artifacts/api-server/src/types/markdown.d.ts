/**
 * Markdown imported as text.
 *
 * `docs/PRIVACY-POLICY.md` and `docs/TERMS-OF-SERVICE.md` are inlined into the
 * bundle by esbuild's text loader (see `build.mjs`), so the documents ship with
 * the server and there is no copy to drift from the source.
 */
declare module "*.md" {
  const content: string;
  export default content;
}
