# EDMN Market — Mobile Design System (`packages/edmn_design`)

Source of truth: the approved **EDMN Market — Approved Final UI Board** (design locked) and the **original EDMN logo**.
Screens never declare their own colors, spacing or radii; they use the tokens and components below.

## Brand

| Asset | File | How it was made |
|---|---|---|
| Full logo (light bg) | `assets/brand/edmn_logo.png` (+2.0x, 3.0x) | Tight crop of the supplied original logo (`docs/mobile/brand/edmn_logo_original.png`) |
| Full logo (dark bg) | `assets/brand/edmn_logo_on_dark.png` | Same crop; ONLY the dark-blue wordmark pixels recolored to white (emblem and cyan "EDMN" untouched) — as the board shows on blue |
| Emblem | `assets/brand/edmn_emblem.png` | Crop of wings + shield |
| Wordmark | `assets/brand/edmn_wordmark{,_on_dark}.png` | Crop of "إضمن / EDMN" |

Nothing was redrawn. "ماركت" next to the logo is rendered text in brand cyan (the supplied logo has no "ماركت";
see VISUAL_AUDIT V-01). The supplied file is 752×720; the `@2x/@3x` originals named in the directive were not
available in this environment — the 3.0x variant is the original resolution.

## Colors (`EdmnColors`)

| Token | Value | Use |
|---|---|---|
| primary | `#1A57A1` | Logo blue — buttons, active states, links |
| primaryDark / primaryDeep | `#103F7D` / `#0B2F63` | Header gradient (board) |
| primaryLight | `#E8F2FC` | Active nav pill, totals box, soft fills |
| accentCyan | `#1FA7E1` | "ماركت", badges, Protected Deal tag |
| brandRed | `#ED181E` | Badges / unread dot only |
| background / surface | `#FFFFFF` | Content sheet, cards |
| subtle | `#F6F8FC` | Search fields, tiles |
| border | `#E3EAF2` | Card / field borders |
| textPrimary / textSecondary / disabled | `#17243B` / `#66758A` / `#A9B4C3` | Text |
| success / warning / error (+ light) | `#198754` / `#B7791F` / `#D92D20` | States only (timeline, chips, notices) |

`headerGradient` (deep → dark → primary) is used only where the board shows it: headers, splash/onboarding,
the Protected Deal banner and the wallet balance card.

## Typography (`EdmnType`)

Font: **Cairo** (bundled TTF 400–800, SIL OFL — `fonts/OFL.txt`). The web uses IBM Plex Sans Arabic; Cairo was
chosen because it is the closer match to the board's lettering (directive §5 fallback). Scale: page 24 bold,
section 20 bold, card title 16 semibold, body 14, secondary 12, caption 11 medium, button 15 semibold, price 18–22
bold, balance 30 extra-bold. Money and dates always use Western digits (`formatEgp`, `formatDateTime`).

## Spacing, radii, sizes

4-pt scale `4/8/12/16/20/24/32` (`EdmnSpacing`), screen gutter 16. Radii: card/tile 16, field 24, sheet 24, small 10,
buttons and chips pill (999). Button 52, secondary 44, field 52, min touch 48, header 64, bottom nav 68. Shadows:
one very soft card shadow + one floating shadow (`EdmnShadows`).

## Components

| Directive name | Implementation | States |
|---|---|---|
| EdmnAppScaffold / EdmnHeader | `layout.dart` — blue gradient header, centered white title, back, actions, white rounded sheet, pinned bottom action with safe area | keyboard-aware |
| EdmnBottomNavigation | 4 items, active pill (board) | selected, badge |
| EdmnPrimaryButton / EdmnSecondaryButton | pill buttons | default, pressed, disabled, loading (blocks double tap), destructive |
| EdmnTextField | rounded field, start icon, password eye, LTR option for phone/amount | focus, error, disabled |
| EdmnSearchBar | pill, light or on-dark (home header) | clear |
| EdmnCard, EdmnMenuItem, EdmnMenuGroup | cards / grouped account menus | tap |
| EdmnProductCard | image, 2-line title, price (+old price), "أضف" | adding, unavailable |
| EdmnCategoryItem | grid tile or compact header icon | selected |
| EdmnSectionHeader | title + icon + "عرض الكل" | |
| EdmnStatusChip | pill tones neutral/info/success/warning/danger | |
| EdmnOrderCard | number, date, status, thumbnails, total | |
| EdmnTrackingTimeline | vertical: done ✓ green, current blue, pending gray, failed red | |
| EdmnStepper | checkout steps | done/current/upcoming |
| EdmnWalletCard, EdmnQuickAction, EdmnTransactionRow | wallet (used when the wallet API exists) | signed amounts |
| EdmnBottomSheet / showEdmnBottomSheet | rounded sheet | |
| EdmnLoadingState, EdmnSkeletonList, EdmnEmptyState, EdmnErrorState | page states; error state follows the API error kind (offline, session expired → sign in, no permission, not found) | |
| EdmnUploadField | receipt / evidence picker field | empty, selected, uploading, error |
| EdmnAmountSummary | rows + highlighted total (server values only) | |
| EdmnConfirmationDialog / showEdmnConfirmation | confirm money-related / irreversible actions | |
| EdmnSellerSummary, EdmnStatTile, EdmnProfileHeader | seller center / account headers | |
| EdmnSecureDealCard, EdmnNotificationItem | Protected Deal list / notifications | unread |
| EdmnPagination | load more / retry footer | loading, error, end |
| EdmnImageGallery, EdmnPageDots, EdmnNetworkImage, EdmnThumb | images with placeholder and fallback | |
| EdmnRadioCard, EdmnFilterPills, EdmnQuantityStepper, EdmnNotice | checkout methods, list filters, quantity, inline notices | disabled, busy |

## RTL / LTR

Arabic (RTL) is the default, English (LTR) is complete. Layout uses only directional insets/alignments; phone
numbers, codes and amounts are forced LTR inside Arabic. All strings live in `lib/l10n/app_{ar,en}.arb`.
