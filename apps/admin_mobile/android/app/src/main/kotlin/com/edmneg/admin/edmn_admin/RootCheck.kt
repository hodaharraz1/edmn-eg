package com.edmneg.admin.edmn_admin

import android.os.Build
import java.io.File

/**
 * MOBILE-REL-01 (MASVS-RESILIENCE): best-effort rooted-device heuristics for the staff app warning.
 * No detection is complete — this is a WARNING signal, not a gate. The server remains the enforcer.
 */
object RootCheck {
    private val suPaths = listOf(
        "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/su",
        "/system/bin/.ext/su", "/system/usr/we-need-root/su", "/data/local/xbin/su",
        "/data/local/bin/su", "/data/local/su", "/system/app/Superuser.apk",
    )

    private val rootApps = listOf(
        "com.topjohnwu.magisk", "eu.chainfire.supersu", "com.koushikdutta.superuser",
        "com.noshufou.android.su", "com.thirdparty.superuser", "com.yellowes.su",
    )

    fun isRooted(): Boolean = hasTestKeys() || hasSuBinary() || hasRootManagementApps()

    private fun hasTestKeys(): Boolean = Build.TAGS?.contains("test-keys") == true

    private fun hasSuBinary(): Boolean = suPaths.any { runCatching { File(it).exists() }.getOrDefault(false) }

    private fun hasRootManagementApps(): Boolean = rootApps.any { pkg ->
        runCatching { File("/data/data/$pkg").exists() }.getOrDefault(false)
    }
}
