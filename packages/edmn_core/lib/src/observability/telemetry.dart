import 'package:flutter/foundation.dart';

/// Observability facade. Every attribute passes through [redact] before reaching any sink, so credentials, delivery
/// codes and personal data cannot leave the device by accident. Phase 1 ships only a debug-console sink; a crash /
/// analytics provider plugs in behind [TelemetrySink] later without touching call sites.
abstract class TelemetrySink {
  void record(String name, Map<String, Object?> attributes);
}

class DebugPrintSink implements TelemetrySink {
  @override
  void record(String name, Map<String, Object?> attributes) {
    if (kDebugMode) debugPrint('[telemetry] $name $attributes');
  }
}

class Telemetry {
  Telemetry([List<TelemetrySink>? sinks]) : _sinks = sinks ?? [DebugPrintSink()];
  final List<TelemetrySink> _sinks;

  static final _sensitiveKey = RegExp(
    r'(token|password|secret|otp|code|pin|authorization|cookie|session|phone|mobile|email|national|address|iban|card|refresh|installation)',
    caseSensitive: false,
  );
  // Values that look like credentials or personal data even under an innocent key.
  static final _sensitiveValue = RegExp(r'(em1\.[\w-]+\.[\w-]+|\b\d{6}\b|\+?20\d{9,10}|[\w.+-]+@[\w-]+\.[\w.]+|\b\d{14}\b)');

  /// Keeps only non-sensitive scalar attributes. Error codes are allow-listed explicitly by callers (`code` is a
  /// sensitive key name because delivery codes share it) — use `errorCode` for API error codes.
  static Map<String, Object?> redact(Map<String, Object?> input) {
    final out = <String, Object?>{};
    input.forEach((k, v) {
      if (k != 'errorCode' && _sensitiveKey.hasMatch(k)) {
        out[k] = '[redacted]';
      } else if (v is String) {
        out[k] = v.replaceAll(_sensitiveValue, '[redacted]');
      } else if (v == null || v is num || v is bool) {
        out[k] = v;
      } else {
        out[k] = '[${v.runtimeType}]';
      }
    });
    return out;
  }

  void event(String name, Map<String, Object?> attributes) {
    final safe = redact({for (final e in attributes.entries) (e.key == 'code' ? 'errorCode' : e.key): e.value});
    for (final s in _sinks) {
      s.record(name, safe);
    }
  }
}
