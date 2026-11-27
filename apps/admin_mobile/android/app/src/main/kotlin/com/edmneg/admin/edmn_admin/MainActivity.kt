package com.edmneg.admin.edmn_admin

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Policy SEC-127 (MASVS-PLATFORM): the staff app shows TOTP enrolment secrets, personal data and financial queues.
 * FLAG_SECURE blocks screenshots and screen recording and blanks the app in the recent-apps switcher.
 *
 * MOBILE-REL-01: exposes a best-effort rooted-device signal to Dart over the `edmn/device_integrity` channel.
 */
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "edmn/device_integrity").setMethodCallHandler { call, result ->
            when (call.method) {
                "isCompromised" -> result.success(RootCheck.isRooted())
                else -> result.notImplemented()
            }
        }
    }
}
