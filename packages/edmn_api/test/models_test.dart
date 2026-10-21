import 'package:edmn_api/mobile.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('product detail parses the contract shape (piastres ints, nullable brand, recursive categories)', () {
    final p = ProductDetail.fromJson({
      'id': 'p1', 'slug': 's', 'titleAr': 'سماعة', 'titleEn': null, 'description': null, 'keyFeatures': ['ميزة'], 'condition': 'NEW', 'usedGrade': null,
      'conditionNotes': null, 'defects': null, 'includedAccessories': null, 'warrantyInfo': null, 'processingDays': null, 'ratingAvg': 4.5, 'ratingCount': 2,
      'brand': null, 'category': null, 'breadcrumbs': [],
      'store': {'name': 'متجر', 'slug': 'm', 'verified': true, 'ratingAvg': 5, 'ratingCount': 1},
      'images': [], 'specs': [],
      'variants': [{'id': 'v1', 'label': 'أسود', 'options': {'color': 'black'}, 'pricePiastres': 12345, 'compareAtPricePiastres': null, 'available': true, 'specs': []}],
      'futureField': 'ignored',
    });
    expect(p.variants.single.pricePiastres, 12345);
    expect(p.variants.single.options['color'], 'black');
    expect(p.brand, isNull);
    expect(p.store.ratingAvg, 5.0);
    final c = ListCategoriesResponse.fromJson({'items': [{'id': 'a', 'slug': 'a', 'nameAr': 'أ', 'nameEn': 'A', 'icon': null, 'children': [{'id': 'b', 'slug': 'b', 'nameAr': 'ب', 'nameEn': 'B', 'icon': null, 'children': []}]}]});
    expect(c.items.single.children.single.nameEn, 'B');
  });

  test('paths come from the contract', () {
    expect(MobileApiPaths.getProduct.path, '/api/v1/catalog/products/{slug}');
    expect(MobileApiPaths.revokeMySession.method, 'DELETE');
  });
}
