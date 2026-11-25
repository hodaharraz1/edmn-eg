import 'package:edmn_customer/src/deep_links.dart';
import 'package:flutter_test/flutter_test.dart';

/// PKG-LINKS-01 — shared web links land on the matching app screen; everything else stays on the web.
void main() {
  Uri u(String s) => Uri.parse('https://www.edmneg.com$s');

  test('product page opens the app product screen', () {
    expect(appLocationForWebUri(u('/product/men hoodie-42')), '/products/men hoodie-42');
  });

  test('order page and its /pay sub-page open the app order screen', () {
    expect(appLocationForWebUri(u('/account/orders/123')), '/orders/123');
    expect(appLocationForWebUri(u('/account/orders/123/pay')), '/orders/123');
    expect(appLocationForWebUri(u('/account/orders/123?placed=1')), '/orders/123?placed=1');
  });

  test('protected-deal invitations open the join screen with the token in the query', () {
    expect(appLocationForWebUri(u('/deal/invite/AbC123_-x')), '/deals/join?token=AbC123_-x');
    expect(appLocationForWebUri(u('/deal-invite/AbC123_-x')), '/deals/join?token=AbC123_-x');
  });

  test('app-native paths and unrelated pages are left alone', () {
    for (final p in ['/products/x', '/orders/5', '/deals/9', '/deals/join?token=t', '/', '/stores/some-shop', '/legal/privacy']) {
      expect(appLocationForWebUri(u(p)), isNull, reason: p);
    }
  });
}
