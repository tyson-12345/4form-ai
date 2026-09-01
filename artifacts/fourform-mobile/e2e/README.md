# UI invariant harness

`audit.js` is an object of functions evaluated **in the page**. They return a
structured report of every invariant this app's UI audit asserts, so coverage is
mechanical rather than a matter of what someone remembered to look at.

## Entry points

`window.__ui.check()` is the one to reach for: it runs all three passes below and
returns `{ pass, failures, informational }`. Ask it one question, get one answer.

The three it wraps, when you want the raw data: `audit()` measures what is
painted, synchronously; `scroll()` is async and drives every scroller to its end,
reporting what is left underneath the floating chrome; `focus()` focuses each
control in turn and reports the ones that look identical focused.
`window.__audit()` remains an alias for `audit()`.

### What fails a run, and what does not

`check()` treats three kinds as **informational** rather than failures, and the
split is the whole of the opinion:

- `contrast-dimmed` — WCAG 1.4.3 exempts an inactive control, and the disabled
  buttons that trip it are meant to look exactly that dim.
- `nonTextInk` — this app draws a lot of deliberately faint furniture, so a
  blanket 3:1 rule would be wrong most of the times it fired. Read it; do not
  gate on it. It is also where a correct-by-design knockout shows up, such as
  the ink-on-ink circle `MeasureFigure` punches out of a limb line.
- `no-focus-indicator` — the product ships to a phone. It matters on the web
  build and with an external keyboard, and it is not a reason to fail a run.

Everything else is a hard failure.

## The sweep target list

`sweep.json` holds the routes, the four phone widths, the accounts each pass
needs, and — deliberately — what is *not* covered, so a green sweep is never
mistaken for full coverage. It is data rather than code so that a CI job, this
README and somebody driving the browser by hand all sweep the same thing.

Widths are phones only: `app.json` sets `supportsTablet: false` and
`orientation: portrait`, so auditing a tablet would be auditing a surface the
product does not sell. The heights are real devices rather than round numbers,
because a short screen is where bottom clearance actually fails.

**Not yet wired to CI.** That needs `playwright` as a devDependency, which is a
call for whoever owns this workspace: `pnpm-workspace.yaml` sets
`minimumReleaseAge: 1440` as a supply-chain defence and the browser binaries are
a few hundred megabytes. Once it is in, a runner is thin — walk `sweep.json`,
call `check()` per route, exit non-zero if any `pass` is false.

## Checks

| kind | entry point | what it catches |
|---|---|---|
| `page-h-overflow` | audit | the document scrolls horizontally at all |
| `escapes-viewport` | audit | an element's box extends past the viewport (outermost offender only) |
| `escapes-viewport-v` | audit | text runs off the bottom of a screen that **cannot scroll** |
| `clipped` | audit | an element extends past an `overflow:hidden` ancestor |
| `clipped-v` | audit | text clipped vertically, excluding deliberate `numberOfLines` truncation |
| `tap-target` | audit | a control smaller than 44x44 CSS px — **including disabled ones** |
| `no-role` | audit | a control with no interactive role |
| `no-name` | audit | a control with a role but **no accessible name** |
| `contrast` | audit | text below WCAG AA, grouped by colour token |
| `contrast-dimmed` | audit | text that only fails once ancestor opacity is applied |
| `placeholder-contrast` | audit | `::placeholder` colour against the field |
| `text-overlap` | audit | two text nodes whose boxes intersect |
| `nested-vscroll` | audit | a vertical scroller inside another one |
| `nonTextInk` | audit | *reported, not judged*: every distinct SVG ink with its measured ratio |
| `unreachable-content` | scroll | content still under the tab bar or dock at full scroll |
| `scroll-blocked` | scroll | a scroller that cannot reach its own end |
| `no-focus-indicator` | focus | a focusable control that looks identical focused |

## What the 2026-08-26 pass added, and why

Every check above the line existed. These did not, and each maps to something
the harness structurally could not see:

- **`scroll()` at all.** The old harness *inventoried* scroll containers and
  stopped — it reported `scrollHeight`, `clientHeight` and `max` and left "can
  you actually reach the bottom?" to the reader. That is the defect class this
  app is most exposed to, because every screen floats chrome over its scroll
  view and reserves clearance by hand. Geometry at rest cannot answer it.
- **Disabled controls.** `Tappable` sets `cursor: pointer` only when
  interactive, and the harness identified a control *by* that cursor — so every
  disabled control was invisible to the 44pt and role checks. The welcome
  screen's nine decorative chips had been rendering as `aria-disabled` buttons,
  unseen, the whole time.
- **Accessible names.** `no-role` passed a `role="button"` with no text and no
  label.
- **Non-ancestor grounds.** `bgOf` walked the ancestor chain only, so it could
  not see the app's commonest dark surface: an absolutely-positioned sibling
  laid *under* content. Every tab-bar icon measured as `onInk` on paper — a
  1.00:1 reading for furniture that was actually fine. Once the composited
  ground (`rgb(56,58,56)`) was measurable, the inactive tab glyphs turned out to
  be at **2.58:1**, under the 3:1 WCAG 1.4.11 asks of a control's graphic.
- **Fractional ancestor opacity.** `vis()` rejected only a hard `opacity: 0`, so
  a button dimmed to 0.4 was measured at full strength.
- **Vertical clipping and escape.** Both old checks compared `left`/`right`.

`nonTextInk` is deliberately a *report* rather than an assertion. This app draws
a great deal of intentionally faint furniture — hairlines at 0.10, ticks at 0.28
— and a blanket 3:1 rule would be wrong most of the times it fired. It also
surfaces knockouts that are correct by design, such as the ink-on-ink circle
`MeasureFigure` punches out of a limb line to make a joint read.

## Deliberate exemptions

These are not bugs, and the harness knows it:

- **Horizontal carousels.** Content past a carousel's edge is the point of a
  carousel. Detected on the computed longhand, because react-native-web's
  scrollers compute `overflow: "auto hidden"` — an equality test against
  `'hidden'` misses them.
- **Floating overlays.** A dock or tab bar sits *over* a scroll view by design.
  An overlap between something inside a scroller and something outside it is
  layering. What matters there is whether content is reachable at full scroll.
- **Inline links in prose.** WCAG 2.5.8 explicitly exempts a target that is "in
  a sentence or block of text" from the 44pt minimum.
- **Wrapped inline text.** An inline element that wraps reports one union rect
  spanning every line it occupies, so two links on adjacent lines look like they
  intersect when nothing is drawn over anything.
- **Expo LogBox.** Development chrome, not the app. One red toast otherwise
  contributes a dozen findings and buries the real ones.

## Running it

Install once — it survives navigation via `addInitScript`:

    browser_run_code_unsafe --filename artifacts/fourform-mobile/e2e/install-audit.mjs

Then on every route:

    browser_evaluate "() => window.__audit()"
    browser_evaluate "async () => await window.__ui.scroll()"
    browser_evaluate "() => window.__ui.focus()"

Iterating on `audit.js` through `install-audit.mjs` costs a full copy of the
source per reinstall. Serving it instead makes an edit free — the page refetches
on every navigation:

    node -e '…static server on 8099 with CORS over e2e/…'
    page.addInitScript(`window.__uiReady = fetch('http://localhost:8099/audit.js')
      .then(r => r.text()).then(t => { window.__ui = eval(t); return true; })`)

Then `await window.__uiReady` before each call.

Regenerate `install-audit.mjs` after editing `audit.js`:

    node artifacts/fourform-mobile/e2e/build-runner.mjs

## What it cannot see

The harness runs against the **Expo Web** build. It cannot observe iOS Dynamic
Type, VoiceOver, native `pageSheet` presentation, haptics, or `hitSlop` (which
react-native-web ignores). Those were verified on the simulator by hand; a
finding here is real, but a clean run is not by itself proof the native build is
clean.
