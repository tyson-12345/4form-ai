# Search

The goal is narrow: someone who has heard the name and types **4Form AI** into
Google should find us first. That is a *branded entity* query, and it is won by
convincing Google the name refers to a thing that exists — not by content
volume, keywords, or anything that resembles traditional SEO.

## The one thing to understand about the name

"4Form AI" tokenizes into "form ai", which is a large commercial term owned by
form builders — Typeform, Jotform, Zoho, Fillout. Two different queries hide
under one name:

- **`4formai` / `4Form AI`** — a branded query. Winnable, and the one that
  matters: it is what someone who heard about us actually types.
- **`4 form ai`, spaced** — reads to Google as "AI form builder". We will not
  outrank Typeform for it, and we should not want to: that traffic is people
  making surveys, not lifters checking squat depth.

So every decision below optimises for the first and ignores the second. Chasing
the spaced query would mean writing content about web forms.

## Done — 2026-09-02

**The two legal pages stopped returning 503.** `/privacy` and `/terms` were the
only internal links on the site and both were erroring, because the placeholder
guard in `routes/legalPages.ts` was correctly refusing to publish documents with
blanks in them. Filling the blanks fixed the SEO problem as a side effect; the
guard was right.

**`robots.txt` and `sitemap.xml` now exist** (`routes/landingPage.ts`). Both were
returning the API's JSON 404. The sitemap lists `/`, `/privacy`, `/terms` and
carries no `<lastmod>` — the only date available at boot is process start, which
changes on every restart and would claim edits that never happened. Google
discards `lastmod` it does not trust; no date beats a date that lies.

**Structured data** — an `Organization` and a `WebSite` node in a JSON-LD
`@graph` in `landing.html`. `alternateName` is the load-bearing field: it is the
explicit claim that "4FormAI", "4 Form AI", "FourForm AI" and "4formai" are one
entity, which a crawler that has never seen the name cannot infer. The `WebSite`
node is what makes a result read "4Form AI" rather than "4formai.com".

> Adding that block required bumping `inlineBlocks(withAssets, "script", 2)` to
> `3`. The page's CSP pins the SHA-256 of every inline block rather than using a
> nonce — that is what keeps a 90 KB static page cacheable — and the guard throws
> at module load rather than serving a page whose policy omits a block. A JSON-LD
> data block is never executed, so `script-src` does not gate it, but it is
> hashed anyway because the policy is derived from every `<script>` in the file.

**The product name is in prose, not only in the wordmark.** Every mention was a
wordmark, an `sr-only` span, or the footer. The hero lede and the
`og:description` now both open "Film a set. 4Form AI tracks your joints frame by
frame…", matching the `meta description` exactly.

**Google Search Console** — Domain property, verified by DNS TXT. The Domain
property was chosen over URL-prefix deliberately: a URL-prefix property covers
one origin, and this one immediately surfaced that `www` was misconfigured
(below), which the narrower property would have hidden.

**Sitemap submitted, indexing requested** for all three URLs. With no inbound
links anywhere, manual submission is doing the work a backlink would.

**Bing Webmaster Tools** — imported from Search Console. Worth the three minutes
because Bing's index feeds ChatGPT search and Copilot, and being invisible to AI
assistants is a poor look for a product with "AI" in the name.

**`www` no longer lands on a parking host.** It was a `CNAME` to
`uixie.porkbun.com`, Porkbun's wildcard catch-all, which forwarded to
`https://4formai-com.l.ink/`. Same wildcard that made the DKIM lookup look
misconfigured — see the note in `TODO-PRODUCTION.md`. A wildcard is a silent
default that only appears when you query a name you never configured.

## Open

- [ ] **`www` is a 302 to `http://`.** The chain is
      `https://www.4formai.com` → 302 → `http://4formai.com` → 301 →
      `https://4formai.com`. It works, but Porkbun should forward to
      `https://4formai.com` as a **Permanent (301)** instead. One extra hop and
      a temporary redirect where a permanent one belongs.

- [ ] **The profiles. This is the whole remaining job.** There are zero inbound
      links to this domain. Each profile below is simultaneously a backlink, an
      independent corroboration that the entity exists, and a result that ranks
      for the brand name on its own — so the page fills with pages we control
      rather than with `4form.lovable.app` and a bike-trainer repo.

      Name spelled exactly `4Form AI`, `https://4formai.com` in every bio.

      1. LinkedIn company page — ranks fastest, often within days
      2. Crunchbase, free listing — feeds Google's entity graph heavily
      3. Instagram `@4formai` — also where the users are
      4. X `@4formai`
      5. GitHub org `fourformai` — matches the machine-identifier convention
      6. Product Hunt "Coming Soon" — pairs with the waitlist
      7. Wellfound

      The top three are probably sufficient.

- [ ] **Fill `sameAs` once those exist.** It is deliberately absent from the
      JSON-LD rather than empty, because an empty array asserts nothing. The
      array is what closes the loop: the site vouches for the profiles, the
      profiles link back, and Google resolves the pair into one entity.

- [ ] **App Store listing, when the app ships.** `4Form AI` in the app *name*
      field, not only the subtitle. Apple product pages rank for branded app
      queries almost immediately and will likely take a page-one slot alone. Add
      the URL to `sameAs` at the same time.

## Where it stands

Not indexed as of 2026-09-02 — `site:4formai.com` returns nothing, which is
expected within hours of submitting. Expect indexing in 2–7 days, the branded
query in 3–6 weeks, and most of page one in 6–10 weeks once the profiles age in.

Check with `site:4formai.com`, and in Search Console under Pages.
