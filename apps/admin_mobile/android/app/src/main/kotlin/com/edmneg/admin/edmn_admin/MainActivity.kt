package com.edmneg.admin.edmn_admin

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity

/**
 * Policy SEC-127 (MASVS-PLATFORM): the staff app shows TOTP enrolment secrets, personal data and financial queues.
 * FLAG_SECURE blocks screenshots and screen recording and blanks the app in the recent-apps switcher.
 */
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }
}
