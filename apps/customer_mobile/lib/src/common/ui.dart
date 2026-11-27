import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

/// Renders an AsyncValue with the design-system states: skeleton/spinner while loading, the typed error state (with a
/// sign-in action when the session ended) and the data builder.
class AsyncView<T> extends StatelessWidget {
  const AsyncView({super.key, required this.value, required this.data, this.onRetry, this.skeleton = false});
  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;
  final bool skeleton;

  @override
  Widget build(BuildContext context) => switch (value) {
        AsyncData(:final value) => data(value),
        // An error stays visible while Riverpod retries in the background (otherwise a missing page spins forever).
        AsyncError(:final error) => EdmnErrorState(
            error: error,
            onRetry: onRetry,
            onSignIn: () => context.push('/sign-in?next=${Uri.encodeComponent(GoRouterState.of(context).uri.toString())}'),
          ),
        _ => value.hasValue ? data(value.requireValue) : (skeleton ? const EdmnSkeletonList() : const EdmnLoadingState()),
      };
}

String languageOf(BuildContext context) => Localizations.localeOf(context).languageCode;

/// "25 يناير 2026 - 10:24 ص" (board format). Server timestamps only.
String formatDateTime(BuildContext context, String? iso, {bool time = true}) {
  if (iso == null) return '';
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '';
  final lang = languageOf(context);
  final date = DateFormat.yMMMMd(lang).format(d);
  final out = time ? '$date - ${DateFormat.jm(lang).format(d)}' : date;
  // Western digits everywhere (same as prices and the board); month names stay localized.
  return out.replaceAllMapped(RegExp('[٠-٩]'), (m) => '${m[0]!.codeUnitAt(0) - 0x0660}');
}

/// Converts an amount typed in EGP ("1250.50") to piastres without floating point; null when invalid.
int? parseEgpToPiastres(String input) {
  final s = input.trim().replaceAll(',', '');
  final m = RegExp(r'^(\d{1,9})(?:\.(\d{1,2}))?$').firstMatch(s);
  if (m == null) return null;
  final cents = (m[2] ?? '').padRight(2, '0');
  return int.parse(m[1]!) * 100 + int.parse(cents);
}

/// One idempotency key per user intent, reused by retries of that intent.
class IntentKey {
  String _key = newIdempotencyKey();
  String get value => _key;
  void reset() => _key = newIdempotencyKey();
}

/// A network / rate-limit / 5xx failure: the same request can be sent again (with the same key).
bool isRetryableError(Object e) => e is ApiFailure && e.isRetryable;

/// Runs an action, showing the localized API error on failure. Returns true on success.
Future<bool> runAction(BuildContext context, Future<void> Function() action, {String? success}) async {
  try {
    await action();
    if (context.mounted && success != null) showEdmnMessage(context, success);
    return true;
  } catch (e) {
    if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
    return false;
  }
}

/// Lucide icon names from the category seed → the closest Material outline icon (line icons, as the board's row).
IconData categoryIcon(String? lucide) => switch (lucide) {
      'Smartphone' => Icons.smartphone_outlined,
      'Laptop' => Icons.laptop_outlined,
      'Tablet' => Icons.tablet_android_outlined,
      'Gamepad2' || 'Joystick' => Icons.sports_esports_outlined,
      'Tv' => Icons.tv_outlined,
      'Speaker' => Icons.speaker_outlined,
      'Camera' => Icons.photo_camera_outlined,
      'Headphones' => Icons.headphones_outlined,
      'Cpu' => Icons.memory_outlined,
      'AppWindow' => Icons.web_asset_outlined,
      'Refrigerator' || 'WashingMachine' || 'Blender' => Icons.kitchen_outlined,
      'Shirt' => Icons.checkroom_outlined,
      'Footprints' => Icons.hiking_outlined,
      'Watch' => Icons.watch_outlined,
      'Sofa' => Icons.chair_outlined,
      'Home' || 'House' => Icons.home_outlined,
      'Sparkles' => Icons.spa_outlined,
      'Baby' => Icons.child_friendly_outlined,
      'Dumbbell' || 'Bike' => Icons.fitness_center_outlined,
      'Car' => Icons.directions_car_outlined,
      'Gift' => Icons.card_giftcard_outlined,
      'Book' || 'BookOpen' => Icons.menu_book_outlined,
      'Wrench' || 'Hammer' => Icons.handyman_outlined,
      'ShoppingBasket' || 'Apple' => Icons.local_grocery_store_outlined,
      'PawPrint' => Icons.pets_outlined,
      _ => Icons.category_outlined,
    };
