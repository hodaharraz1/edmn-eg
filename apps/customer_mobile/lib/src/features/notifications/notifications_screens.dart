import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/ui.dart';
import '../../providers.dart';

/// Notification center (C27) and notification preferences (C28). Only the signed-in user's own notifications; message
/// alerts stay on the Messages inbox badge. Where a notification opens is a typed target from the server — the app
/// never follows a raw link. Reading a notification changes nothing in an order, a deal or money.
final unreadNotificationsProvider = FutureProvider.autoDispose<int>((ref) => ref.watch(mobileApiProvider).unreadNotifications());
final notificationPrefsProvider = FutureProvider.autoDispose<NotificationPreferences>((ref) => ref.watch(mobileApiProvider).notificationPreferences());

/// The app route of a server target; null when there is nothing to open.
String? notificationRoute(ListNotificationsResponseItemsItemTarget? t) {
  if (t == null) return null;
  final id = t.id;
  return switch (t.kind) {
    'ORDER' when id != null => '/orders/$id',
    'PAYMENT' when id != null => '/payments/$id',
    'DEAL' when id != null => '/deals/$id',
    'RETURN' when id != null => '/returns/$id',
    'STORE_RETURN' when id != null => '/seller/returns/$id',
    'DISPUTE' when id != null => '/disputes/$id',
    'TICKET' when id != null => '/support/$id',
    'CONVERSATION' when id != null => '/messages/$id',
    'STORE_CONVERSATION' when id != null => '/seller/messages/$id',
    'STORE_ORDER' when id != null => '/seller/orders/$id',
    'STORE_PRODUCT' when id != null => '/seller/products/$id/edit',
    'WALLET' => '/wallet',
    'IDENTITY' => '/account/identity',
    'RECEIVING_ACCOUNTS' => '/wallet/accounts',
    'ORDERS' => '/orders',
    'DEALS' => '/deals',
    'STORE' => '/seller',
    _ => null,
  };
}

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final _items = <ListNotificationsResponseItemsItem>[];
  bool _unreadOnly = false;
  bool _loading = true;
  bool _more = false;
  Object? _error;
  String? _next;
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  Future<void> _load({bool reset = false}) async {
    setState(() {
      if (reset) {
        _loading = true;
      } else {
        _more = true;
      }
      _error = null;
    });
    try {
      final r = await ref.read(mobileApiProvider).notifications(unreadOnly: _unreadOnly, before: reset ? null : _next);
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(r.items);
        _next = r.nextBefore;
        _unread = r.unread;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
          _more = false;
        });
      }
    }
  }

  Future<void> _open(ListNotificationsResponseItemsItem n) async {
    if (!n.read) {
      try {
        final unread = await ref.read(mobileApiProvider).markNotificationsRead(ids: [n.id]);
        if (mounted) {
          setState(() {
            final i = _items.indexWhere((x) => x.id == n.id);
            if (i >= 0) _items[i] = ListNotificationsResponseItemsItem(id: n.id, event: n.event, title: n.title, body: n.body, read: true, createdAt: n.createdAt, target: n.target);
            _unread = unread;
          });
          ref.invalidate(unreadNotificationsProvider);
        }
      } catch (_) {
        // Still open it: the read mark is retried the next time the notification is tapped.
      }
    }
    final route = notificationRoute(n.target);
    if (route != null && mounted) context.push(route);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnAppScaffold(
      title: t.notifications,
      actions: [IconButton(key: const Key('notif-settings'), tooltip: t.notificationSettings, icon: const Icon(Icons.tune_rounded), color: EdmnColors.onPrimary, onPressed: () => context.push('/notifications/settings'))],
      body: RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          Row(children: [
            Expanded(
              child: EdmnFilterPills<bool>(
                options: [(false, t.filterAll), (true, t.unreadCount(_unread))],
                selected: _unreadOnly,
                onSelected: (v) {
                  _unreadOnly = v;
                  _load(reset: true);
                },
              ),
            ),
            if (_unread > 0)
              TextButton(
                key: const Key('notif-read-all'),
                onPressed: () async {
                  final ok = await runAction(context, () async {
                    await ref.read(mobileApiProvider).markNotificationsRead();
                  });
                  if (ok) {
                    ref.invalidate(unreadNotificationsProvider);
                    await _load(reset: true);
                  }
                },
                child: Text(t.markAllRead),
              ),
          ]),
          const SizedBox(height: EdmnSpacing.sm),
          if (_loading)
            const EdmnSkeletonList()
          else if (_error != null)
            EdmnErrorState(error: _error!, onRetry: () => _load(reset: true))
          else if (_items.isEmpty)
            EdmnEmptyState(key: const Key('notif-empty'), icon: Icons.notifications_none_rounded, title: _unreadOnly ? t.noUnreadNotifications : t.noNotifications)
          else ...[
            EdmnCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (final n in _items)
                  EdmnNotificationItem(
                    key: Key('notif-${n.id}'),
                    title: n.title,
                    body: n.body,
                    time: formatDateTime(context, n.createdAt),
                    unread: !n.read,
                    onTap: () => _open(n),
                  ),
              ]),
            ),
            if (_next != null) ...[
              const SizedBox(height: EdmnSpacing.sm),
              EdmnSecondaryButton(key: const Key('notif-more'), label: t.loadMore, loading: _more, onPressed: () => _load()),
            ],
          ],
        ]),
      ),
    );
  }
}

class NotificationSettingsScreen extends ConsumerStatefulWidget {
  const NotificationSettingsScreen({super.key});
  @override
  ConsumerState<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends ConsumerState<NotificationSettingsScreen> {
  NotificationPreferences? _local;
  String? _saving;

  Future<void> _set(String field, bool value) async {
    setState(() => _saving = field);
    final ok = await runAction(context, () async {
      final p = await ref.read(mobileApiProvider).saveNotificationPreferences({field: value});
      if (mounted) setState(() => _local = p);
    });
    if (!ok) ref.invalidate(notificationPrefsProvider);
    if (mounted) setState(() => _saving = null);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final prefs = ref.watch(notificationPrefsProvider);
    return EdmnAppScaffold(
      title: t.notificationSettings,
      body: AsyncView(
        value: prefs,
        onRetry: () => ref.invalidate(notificationPrefsProvider),
        data: (server) {
          final p = _local ?? server;
          Widget sw(String field, String title, String? subtitle, bool value) => SwitchListTile(
                key: Key('pref-$field'),
                contentPadding: EdgeInsets.zero,
                title: Text(title, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                subtitle: subtitle == null ? null : Text(subtitle, style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                value: value,
                onChanged: _saving == null ? (v) => _set(field, v) : null,
              );
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            EdmnCard(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text(t.messageNotifications, style: EdmnType.cardTitle.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                sw('messagesInApp', t.prefInApp, null, p.messagesInApp),
                sw('messagesSound', t.prefSound, null, p.messagesSound),
                sw('messagesEmail', t.prefEmail, t.prefEmailHint, p.messagesEmail),
                sw('messagesPush', t.prefPush, t.prefPushHint, p.messagesPush),
                sw('pushPreview', t.prefPushPreview, t.prefPushPreviewHint, p.pushPreview),
              ]),
            ),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnNotice(key: const Key('push-note'), message: t.devicePushNote, icon: Icons.info_outline_rounded),
            const SizedBox(height: EdmnSpacing.sm),
            EdmnNotice(message: t.securityNotificationsNote, icon: Icons.shield_outlined),
          ]);
        },
      ),
    );
  }
}
