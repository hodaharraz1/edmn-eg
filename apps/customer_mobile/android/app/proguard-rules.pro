# MOBILE-REL-01: R8 rules for the release build. Flutter and the engine ship their own consumer rules; keep
# only what reflection needs here. If a future plugin breaks in release, add its rule here — never disable minify.
-keep class io.flutter.** { *; }
-keep class io.flutter.embedding.** { *; }
-keepattributes *Annotation*,EnclosingMethod,Signature
-dontwarn io.flutter.**
