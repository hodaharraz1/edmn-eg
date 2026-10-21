import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/app.dart';

/// EDMN Admin App — a separate binary and identity from the Customer App. Build per environment:
///   flutter run --dart-define=EDMN_ENV=local|staging|production [--dart-define=EDMN_API_BASE_URL=...]
void main() => runApp(const ProviderScope(child: AdminApp()));
