import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'catalog_providers.dart';

/// Read-only product detail. Availability is a boolean from the server; stock counts are never sent.
class ProductScreen extends ConsumerWidget {
  const ProductScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final product = ref.watch(productProvider(slug));
    return Scaffold(
      appBar: AppBar(),
      body: product.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(productProvider(slug))),
        data: (p) => ListView(padding: const EdgeInsetsDirectional.all(16), children: [
          Text(p.titleAr, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text(p.store.name, style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 16),
          for (final v in p.variants)
            ListTile(
              contentPadding: EdgeInsetsDirectional.zero,
              title: Text(v.label),
              subtitle: Text(v.available ? t.inStock : t.outOfStock),
              trailing: EgpText(v.pricePiastres, style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          if (p.description != null) ...[const Divider(), Text(p.description!)],
        ]),
      ),
    );
  }
}
