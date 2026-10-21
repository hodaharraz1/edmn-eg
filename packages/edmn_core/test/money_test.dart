import 'package:edmn_core/edmn_core.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('formatEgp (matches the web formatEGP)', () {
    test('Arabic: integer piastres, grouping, trailing zeros dropped, ج.م suffix', () {
      expect(formatEgp(125050), '1,250.5 ج.م');
      expect(formatEgp(12345), '123.45 ج.م');
      expect(formatEgp(100000000), '1,000,000 ج.م');
      expect(formatEgp(1), '0.01 ج.م');
      expect(formatEgp(0), '0 ج.م');
      expect(formatEgp(-2550), '-25.5 ج.م');
    });
    test('fixed two decimals and English', () {
      expect(formatEgp(125000, fixed: true), '1,250.00 ج.م');
      expect(formatEgp(125050, languageCode: 'en'), 'EGP 1,250.5');
    });
    test('null renders a dash', () => expect(formatEgp(null), '—'));
    test('no floating point: 10 + 20 piastres is exactly 0.3', () {
      expect(formatEgp((const Money(10) + const Money(20)).piastres), '0.3 ج.م');
    });
  });
}
