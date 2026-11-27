import 'package:edmn_core/edmn_core.dart' show ApiFailure;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/app.dart';

/// EDMN Customer App. Build per environment:
///   flutter run --dart-define=EDMN_ENV=local|staging|production [--dart-define=EDMN_API_BASE_URL=...]
void main() => runApp(const ProviderScope(retry: apiRetry, child: CustomerApp()));

/// A 4xx answer (not found, forbidden, validation) will not change by asking again, so providers do not retry it;
/// network or server errors are retried a few times with back-off.
Duration? apiRetry(int retryCount, Object error) {
  final status = error is ApiFailure ? error.status : null;
  if (status != null && status >= 400 && status < 500) return null;
  if (retryCount >= 3) return null;
  return Duration(milliseconds: 500 * (1 << retryCount));
}
