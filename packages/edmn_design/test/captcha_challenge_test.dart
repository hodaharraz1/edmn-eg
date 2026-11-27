import 'package:edmn_design/edmn_design.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the CAPTCHA page is on the API origin, at the one path the server hosts', () {
    expect(captchaPageUrl('https://edmneg.com').toString(), 'https://edmneg.com/captcha/mobile');
    expect(captchaPageUrl('https://staging.edmneg.com/').toString(), 'https://staging.edmneg.com/captcha/mobile');
    expect(captchaPageUrl('http://10.0.2.2:3000').toString(), 'http://10.0.2.2:3000/captcha/mobile');
  });

  test('the web view stays on its own origin; the provider frames inside the page are allowed', () {
    final page = captchaPageUrl('https://edmneg.com');
    expect(captchaNavigationAllowed(page, 'https://edmneg.com/captcha/mobile'), isTrue);
    expect(captchaNavigationAllowed(page, 'https://edmneg.com/captcha/mobile?x=1'), isTrue);
    expect(captchaNavigationAllowed(page, 'https://evil.example/captcha/mobile'), isFalse);
    expect(captchaNavigationAllowed(page, 'http://edmneg.com/captcha/mobile'), isFalse);
    expect(captchaNavigationAllowed(page, 'https://edmneg.com.evil.example/'), isFalse);
    expect(captchaNavigationAllowed(page, 'not a url ::'), isFalse);
    expect(captchaNavigationAllowed(page, 'https://challenges.cloudflare.com/x', isMainFrame: false), isTrue);
  });

  test('only a plausible token is accepted from the page', () {
    expect(captchaTokenFromMessage(' abc.def '), 'abc.def');
    expect(captchaTokenFromMessage(''), isNull);
    expect(captchaTokenFromMessage('   '), isNull);
    expect(captchaTokenFromMessage('a' * 4097), isNull);
    expect(captchaTokenFromMessage('a' * 4096), isNotNull);
  });
}
