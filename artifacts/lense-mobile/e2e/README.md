# UI invariant harness

`audit.js` is a single function evaluated **in the page**. It returns a structured
report of every invariant this app's UI audit asserts, so coverage is mechanical
rather than a matter of what someone remembered to look at.

## Checks

| kind | what it catches |
|---|---|
| `page-h-overflow` | the document scrolls horizontally at all |
| `escapes-viewport` | an element's box extends past the viewport (outermost offender only) |
| `clipped` | an element extends past an `overflow:hidden` ancestor |
| `tap-target` | a pressable smaller than 44x44 CSS px |
| `no-role` | a pressable with no interactive role — invisible to a screen reader |
| `contrast` | text below WCAG AA, **grouped by colour token** so one bad token is one finding |
| `text-overlap` | two text nodes whose boxes intersect |
| `scrollers` | every scroll container with its reachable range |

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

    browser_run_code_unsafe --filename artifacts/lense-mobile/e2e/install-audit.mjs

Then on every route:

    browser_evaluate "() => window.__audit()"

Regenerate `install-audit.mjs` after editing `audit.js`:

    node artifacts/lense-mobile/e2e/build-runner.mjs

## What it cannot see

The harness runs against the **Expo Web** build. It cannot observe iOS Dynamic
Type, VoiceOver, native `pageSheet` presentation, haptics, or `hitSlop` (which
react-native-web ignores). Those were verified on the simulator by hand; a
finding here is real, but a clean run is not by itself proof the native build is
clean.
