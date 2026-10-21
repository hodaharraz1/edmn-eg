import 'dart:math';

/// Idempotency keys for mutations. Create ONE key per user intent (e.g. per tap of "Sign out other devices") and
/// reuse it for every retry of that intent; the server then replays the original result instead of acting twice.
String newIdempotencyKey([Random? random]) {
  final r = random ?? Random.secure();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return List.generate(32, (_) => alphabet[r.nextInt(alphabet.length)]).join();
}
