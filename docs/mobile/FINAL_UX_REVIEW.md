# Final UX & Accessibility Review — 2026-11-25

Scope (owner instruction): Arabic + English strings and missing keys, loading / error / empty
states on every screen in both mobile apps, and accessibility labels. Method and results below;
every claim is reproducible with the commands listed.

## 1. String parity (ar / en)

- `packages/edmn_design/lib/l10n/app_ar.arb` and `app_en.arb`: 1164 keys each, identical key sets
  (no ar-only or en-only keys), zero empty values. Verified by key-set diff on both files.
- Hardcoded-copy scan: every user-facing string in both apps resolves through
  `EdmnLocalizations`; the only inline text found is dynamic data interpolation (order
  addresses with Arabic separators), not localized copy. No action needed.

## 2. Loading / error / empty states

- All 18 data screens in the customer app and all data screens in the admin app render through
  the shared `AsyncView`, which owns the loading skeleton, the retryable error state and the
  empty state. Verified per file.
- Form screens carry their own submit state: sign-in and reset-password (customer) and the
  admin security forms show inline errors and a busy submit. Reviewed, acceptable.
- Gap found and fixed: **admin revoke-user-sessions** submitted with no busy indication —
  the button now disables and shows the localized `loading` label while in flight, with the
  flag reset in `finally` so a failed attempt re-enables it.

## 3. Accessibility labels

- The shared `edmn_design` widgets (buttons, cards, media, states, controls, layout, brand)
  carry Semantics/tooltips centrally; every `IconButton` in both apps was audited and has a
  localized tooltip/semanticLabel (remove, delete, sign-out-device, copy-phone, …).
- Gap found and fixed: **review star rating** announced a bare number ("3"). Stars now announce
  the localized `starRatingLabel` — «3 من 5 نجوم» / "3 of 5 stars" — as both tooltip and
  semanticLabel, so screen-reader users hear the value and the scale.
- Tap targets: icon buttons are Flutter defaults (48dp minimum) wrapped by the design system;
  no sub-44dp custom targets found in the audited screens.

## 4. Tests

RUN BY AUTHOR (workspace box, Flutter 3.47.9):
- `flutter analyze` — customer app: no issues; admin app: no issues.
- `flutter test` — customer app: 64/64 (incl. new `review_a11y_test.dart`: the label contract
  in ar + en, and a widget test that star 3 announces «3 من 5 نجوم» and tapping star 4 fills
  four stars). Admin app: 27/27 (existing revoke-session step-up test still passes with the
  busy state).
- Server-side suites: NOT RUN for this package — the diff touches no TypeScript; the web/API
  suites were run green on this same base for PKG-PUSH-01.

## 5. New localization key

`starRatingLabel` (`{count}` int placeholder) added to both arb files, inserted alphabetically
before `rateStore`; `flutter gen-l10n` re-run in `packages/edmn_design`.
