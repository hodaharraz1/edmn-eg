import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';
import 'catalog_providers.dart';

class CatalogHomeScreen extends ConsumerWidget {
  const CatalogHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final results = ref.watch(productSearchProvider);
    final signedIn = ref.watch(signedInProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(t.appNameCustomer),
        actions: [
          IconButton(
            tooltip: t.language,
            icon: const Icon(Icons.translate),
            onPressed: () {
              final current = ref.read(localeProvider);
              ref.read(localeProvider.notifier).set(current.languageCode == 'ar' ? EdmnLocales.english : EdmnLocales.arabic);
            },
          ),
          IconButton(
            tooltip: signedIn ? t.devices : t.signIn,
            icon: Icon(signedIn ? Icons.devices : Icons.login),
            onPressed: () => context.push(signedIn ? '/account/devices' : '/sign-in'),
          ),
        ],
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsetsDirectional.all(12),
          child: TextField(
            key: const Key('search'),
            decoration: InputDecoration(hintText: t.searchHint, prefixIcon: const Icon(Icons.search)),
            textInputAction: TextInputAction.search,
            onSubmitted: (v) => ref.read(searchQueryProvider.notifier).set(v),
          ),
        ),
        Expanded(
          child: results.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(productSearchProvider)),
            data: (page) => page.items.isEmpty
                ? Center(child: Text(t.noResults))
                : ListView.separated(
                    itemCount: page.items.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final p = page.items[i];
                      return ListTile(
                        key: Key('product-${p.slug}'),
                        title: Text(p.titleAr),
                        subtitle: Text(p.store.name),
                        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                          EgpText(p.minPricePiastres, style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text(p.inStock ? t.inStock : t.outOfStock, style: Theme.of(context).textTheme.bodySmall),
                        ]),
                        onTap: () => context.push('/products/${Uri.encodeComponent(p.slug)}'),
                      );
                    },
                  ),
          ),
        ),
      ]),
    );
  }
}
