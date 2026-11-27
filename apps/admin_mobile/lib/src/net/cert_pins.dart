import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';

/// MOBILE-REL-01 (SEC-163): certificate pinning for the Admin app only. Pins are full-certificate SHA-256
/// (base64) passed at build time: --dart-define=EDMN_ADMIN_CERT_PINS=sha256/AAAA,sha256/BBBB (current + backup).
/// Rotation plan: docs/mobile/CERT_PINNING.md. With no pins configured the adapter is left untouched so local
/// development keeps working; the staging/production CI always passes pins.
const _pinsDefine = String.fromEnvironment('EDMN_ADMIN_CERT_PINS', defaultValue: '');

List<String> configuredCertPins() =>
    _pinsDefine.split(',').map((p) => p.trim().replaceFirst('sha256/', '')).where((p) => p.isNotEmpty).toList();

String certPinOf(X509Certificate cert) => base64Encode(sha256.convert(cert.der).bytes);

/// Returns a pinning adapter when pins are configured, otherwise null (default adapter).
HttpClientAdapter? buildPinnedAdapter() {
  final pins = configuredCertPins();
  if (pins.isEmpty) return null;
  final adapter = IOHttpClientAdapter();
  adapter.createHttpClient = () {
    final client = HttpClient(context: SecurityContext(withTrustedRoots: true));
    client.badCertificateCallback = (X509Certificate cert, String host, int port) => pins.contains(certPinOf(cert));
    return client;
  };
  // The default validation path is bypassed by badCertificateCallback only on failures; to pin on EVERY
  // connection (including valid chains) we also gate in onHttpClientCreate via validateCertificate.
  adapter.validateCertificate = (cert, host, port) => cert != null && pins.contains(certPinOf(cert));
  return adapter;
}
