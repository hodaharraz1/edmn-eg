import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // MOBILE-REL-01: best-effort jailbreak signal for the staff app warning (MASVS-RESILIENCE).
    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(name: "edmn/device_integrity", binaryMessenger: controller.binaryMessenger)
      channel.setMethodCallHandler { call, result in
        switch call.method {
        case "isCompromised": result(JailbreakCheck.isJailbroken())
        default: result(FlutterMethodNotImplemented)
        }
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}

/// Best-effort jailbreak heuristics — a WARNING signal, not a gate. The server remains the enforcer.
enum JailbreakCheck {
  static func isJailbroken() -> Bool {
    let paths = [
      "/Applications/Cydia.app", "/Applications/Sileo.app", "/private/var/lib/apt/",
      "/usr/sbin/sshd", "/bin/bash", "/etc/apt", "/Library/MobileSubstrate/MobileSubstrate.dylib",
    ]
    for path in paths where FileManager.default.fileExists(atPath: path) { return true }
    // A sandboxed app cannot write outside its container; success means the sandbox is broken.
    let probe = "/private/jb_probe_\(UUID().uuidString)"
    if (try? "jb".write(toFile: probe, atomically: true, encoding: .utf8)) != nil {
      try? FileManager.default.removeItem(atPath: probe)
      return true
    }
    if let url = URL(string: "cydia://package/com.example"), UIApplication.shared.canOpenURL(url) { return true }
    return false
  }
}
