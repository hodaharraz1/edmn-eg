import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// MOBILE-REL-01 (MASVS-RESILIENCE): shows a one-time warning on the staff app when the device looks
/// rooted/jailbroken. Warning only — detection is best-effort and the server stays the real enforcer.
class DeviceIntegrity {
  static const _channel = MethodChannel('edmn/device_integrity');
  static var _warned = false;

  static Future<bool> isCompromised() async {
    try {
      return await _channel.invokeMethod<bool>('isCompromised') ?? false;
    } catch (_) {
      // Channel missing (desktop/web/dev) — treat as not compromised; never block the app on detection failure.
      return false;
    }
  }

  /// Call once after the first frame. Arabic UI copy, dismissible, logged by the caller via telemetry.
  static Future<void> warnIfCompromised(BuildContext context, {void Function()? onDetected}) async {
    if (_warned) return;
    final compromised = await isCompromised();
    if (!compromised || !context.mounted) return;
    _warned = true;
    onDetected?.call();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.gpp_maybe_outlined, size: 40),
        title: const Text('جهاز غير آمن', textDirection: TextDirection.rtl),
        content: const Text(
          'يبدو أن هذا الجهاز معدَّل (Root/Jailbreak). استخدام تطبيق الإدارة على جهاز معدَّل يعرّض '
          'بيانات العملاء والأموال للخطر. استخدم جهازًا غير معدَّل بآخر تحديثات النظام.',
          textDirection: TextDirection.rtl,
        ),
        actionsAlignment: MainAxisAlignment.center,
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('فهمت', textDirection: TextDirection.rtl),
          ),
        ],
      ),
    );
  }
}
