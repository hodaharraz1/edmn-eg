/// Semantic version comparison for the server-driven minimum supported version.
bool isVersionSupported(String current, String minimum) {
  List<int> parse(String v) => v.split('+').first.split('.').map((p) => int.tryParse(p) ?? 0).toList()..addAll([0, 0, 0]);
  final a = parse(current), b = parse(minimum);
  for (var i = 0; i < 3; i++) {
    if (a[i] != b[i]) return a[i] > b[i];
  }
  return true;
}
