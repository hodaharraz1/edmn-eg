import 'dart:async';
import 'dart:typed_data';

import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/file_pick.dart';
import '../../common/ui.dart';
import '../../providers.dart';

/// Buyer ↔ store and deal-party conversations (C01–C08). Every conversation belongs to one paid order or one deal; the
/// app can open it only from there. Messages are evidence: «استلمت» or a new price in a message changes nothing — only
/// the formal actions on the order / deal do. `store: true` is the store side (Seller Center, `orders.communicate`).
typedef InboxArgs = ({bool store, String filter});

final inboxProvider = FutureProvider.autoDispose.family<ListConversationsResponse, InboxArgs>(
    (ref, a) => ref.watch(mobileApiProvider).conversations(store: a.store, filter: a.filter == 'all' ? null : a.filter));
final conversationProvider = FutureProvider.autoDispose.family<GetConversationResponse, ({String id, bool store})>(
    (ref, a) => ref.watch(mobileApiProvider).conversation(a.id, store: a.store));
final fileBytesProvider = FutureProvider.autoDispose.family<Uint8List, String>((ref, id) => ref.watch(mobileApiProvider).file(id));

/// Opens (or creates) the conversation from its order / deal, then shows it. Errors (e.g. not paid yet) are the
/// server's, localized by code.
Future<void> openConversation(BuildContext context, WidgetRef ref, Future<String> Function(MobileApi api) open, {bool store = false}) async {
  try {
    final id = await open(ref.read(mobileApiProvider));
    if (context.mounted) context.push(store ? '/seller/messages/$id' : '/messages/$id');
  } catch (e) {
    if (context.mounted) showEdmnMessage(context, apiErrorMessage(context, e), error: true);
  }
}

/* ───────────────────────── C01 inbox ───────────────────────── */

class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key, this.store = false});
  final bool store;
  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  String _filter = 'all';

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final args = (store: widget.store, filter: _filter);
    final list = ref.watch(inboxProvider(args));
    return EdmnAppScaffold(
      title: widget.store ? t.storeMessages : t.messages,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(inboxProvider(args).future),
        child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnFilterPills<String>(
            options: [('all', t.filterAll), ('unread', t.filterUnread), ('orders', t.filterOrders), if (!widget.store) ('deals', t.filterDeals)],
            selected: _filter,
            onSelected: (v) => setState(() => _filter = v),
          ),
          const SizedBox(height: EdmnSpacing.sm),
          EdmnNotice(message: t.messagesEvidenceNote, icon: Icons.shield_outlined),
          const SizedBox(height: EdmnSpacing.sm),
          list.when(
            loading: () => const EdmnSkeletonList(),
            error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(inboxProvider(args))),
            data: (r) => r.items.isEmpty
                ? EdmnEmptyState(icon: Icons.chat_bubble_outline_rounded, title: t.noConversations, message: t.noConversationsBody)
                : Column(children: [for (final c in r.items) _InboxTile(c: c, store: widget.store)]),
          ),
        ]),
      ),
    );
  }
}

class _InboxTile extends StatelessWidget {
  const _InboxTile({required this.c, required this.store});
  final ListConversationsResponseItemsItem c;
  final bool store;

  @override
  Widget build(BuildContext context) {
    final unread = c.unread > 0;
    return Padding(
      padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
      child: EdmnCard(
        key: Key('conv-${c.id}'),
        onTap: () => context.push(store ? '/seller/messages/${c.id}' : '/messages/${c.id}'),
        child: Row(children: [
          CircleAvatar(
            backgroundColor: EdmnColors.primaryLight,
            child: Icon(c.context == 'DEAL' ? Icons.verified_user_outlined : Icons.storefront_outlined, color: EdmnColors.primary),
          ),
          const SizedBox(width: EdmnSpacing.sm),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(c.otherParty, maxLines: 1, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary, fontWeight: unread ? FontWeight.w800 : FontWeight.w600))),
                Text(formatDateTime(context, c.lastMessageAt), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
              ]),
              Text('${c.ref} · ${c.title}', maxLines: 1, overflow: TextOverflow.ellipsis, style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
              const SizedBox(height: EdmnSpacing.xxs),
              Row(children: [
                Expanded(child: Text(c.preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: EdmnType.secondary.copyWith(color: unread ? EdmnColors.textPrimary : EdmnColors.textSecondary))),
                if (unread)
                  Container(
                    key: Key('unread-${c.id}'),
                    padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.xs, vertical: 2),
                    decoration: BoxDecoration(color: EdmnColors.accent, borderRadius: BorderRadius.circular(EdmnRadii.chip)),
                    child: Text('${c.unread}', style: EdmnType.caption.copyWith(color: EdmnColors.onAccent, fontWeight: FontWeight.w800)),
                  ),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

/* ───────────────────────── C02–C06 conversation ───────────────────────── */

class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({super.key, required this.id, this.store = false});
  final String id;
  final bool store;
  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> with WidgetsBindingObserver {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  final _viewport = GlobalKey();
  final _messageKeys = <String, GlobalKey>{};
  GetConversationResponse? _rendered;
  String? _pendingBody;
  List<PickedFile>? _pendingFiles;
  /// One key per message the user is trying to send; a retry after a failure reuses it (no duplicate on the server).
  final _intent = IntentKey();
  final _files = <PickedFile>[];
  Timer? _poll;
  bool _sending = false;
  String? _seenUpTo;

  ({String id, bool store}) get _args => (id: widget.id, store: widget.store);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _scroll.addListener(_scheduleSeen);
    // Light polling while the conversation is on screen (no server push channel for the app yet).
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      if (_visible) ref.invalidate(conversationProvider(_args));
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  bool get _visible {
    final s = WidgetsBinding.instance.lifecycleState;
    return mounted && (s == null || s == AppLifecycleState.resumed) && (ModalRoute.of(context)?.isCurrent ?? false);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) ref.invalidate(conversationProvider(_args));
  }

  void _scheduleSeen() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final c = _rendered;
      if (mounted && c != null) _markSeen(c);
    });
  }

  /// Only a bubble intersecting the actual viewport on the current route can advance the read position.
  void _markSeen(GetConversationResponse c) {
    if (!_visible) return;
    final viewport = _viewport.currentContext?.findRenderObject();
    if (viewport is! RenderBox || !viewport.hasSize) return;
    final bounds = viewport.localToGlobal(Offset.zero) & viewport.size;
    String? last;
    for (final m in c.messages) {
      if (m.side == c.side) continue;
      final box = _messageKeys[m.id]?.currentContext?.findRenderObject();
      if (box is RenderBox && box.attached && box.hasSize && bounds.overlaps(box.localToGlobal(Offset.zero) & box.size)) last = m.id;
    }
    if (last == null || _seenUpTo == last) return;
    _seenUpTo = last;
    ref.read(mobileApiProvider).markConversationSeen(widget.id, upToMessageId: last, store: widget.store).then((_) {
      if (mounted) ref.invalidate(inboxProvider);
    }, onError: (_) { if (mounted) _seenUpTo = null; });
  }

  Future<void> _send() async {
    final t = EdmnLocalizations.of(context);
    final body = _pendingBody ?? _text.text.trim();
    if (body.isEmpty && _files.isEmpty) return;
    _pendingBody = body;
    _pendingFiles ??= List.of(_files);
    setState(() => _sending = true);
    try {
      await ref.read(mobileApiProvider).sendMessage(widget.id, body, _intent.value, attachments: [for (final f in _pendingFiles!) (f.bytes, f.name)], store: widget.store);
      if (!mounted) return;
      _intent.reset();
      _pendingBody = null;
      _pendingFiles = null;
      _text.clear();
      _files.clear();
      ref.invalidate(conversationProvider(_args));
    } catch (e) {
      if (!isRetryableError(e)) {
        _pendingBody = null;
        _pendingFiles = null;
        _intent.reset();
      }
      // Retryable failures keep the text and the key: sending again cannot create a duplicate on the server.
      if (mounted) showEdmnMessage(context, isRetryableError(e) ? t.messageNotSentRetry : apiErrorMessage(context, e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final conv = ref.watch(conversationProvider(_args));
    ref.listen(conversationProvider(_args), (_, next) {
      final c = next.value;
      if (c != null) {
        _rendered = c;
        _scheduleSeen();
      }
    });
    final c = conv.value;
    return EdmnAppScaffold(
      title: c?.otherParty ?? t.messages,
      body: AsyncView(
        value: conv,
        onRetry: () => ref.invalidate(conversationProvider(_args)),
        data: (c) => Column(children: [
          // Context: which order / deal this conversation is about.
          Material(
            color: EdmnColors.subtle,
            child: ListTile(
              key: const Key('conv-context'),
              dense: true,
              leading: Icon(c.context == 'DEAL' ? Icons.verified_user_outlined : Icons.receipt_long_outlined, color: EdmnColors.primary),
              title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong),
              subtitle: Text(c.ref, style: EdmnType.caption),
              trailing: const Icon(Icons.chevron_left_rounded),
              onTap: () => context.push(switch (c.link.kind) { 'DEAL' => '/deals/${c.link.id}', 'SELLER_ORDER' => '/seller/orders/${c.link.id}', _ => '/orders/${c.link.id}' }),
            ),
          ),
          Expanded(
            child: c.messages.isEmpty
                ? EdmnEmptyState(icon: Icons.forum_outlined, title: t.startConversation, message: t.messagesEvidenceNote)
                : ListView.builder(
                    key: _viewport,
                    controller: _scroll,
                    reverse: true,
                    padding: const EdgeInsetsDirectional.all(EdmnSpacing.md),
                    itemCount: c.messages.length,
                    itemBuilder: (_, i) {
                      final m = c.messages[c.messages.length - 1 - i];
                      return KeyedSubtree(key: _messageKeys.putIfAbsent(m.id, () => GlobalKey()), child: _Bubble(m: m, store: widget.store));
                    },
                  ),
          ),
          if (!c.canWrite)
            Padding(padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm), child: EdmnNotice(key: const Key('read-only'), message: c.readOnlyReason ?? t.conversationReadOnly, tone: EdmnTone.warning))
          else
            _Composer(
              text: _text,
              files: _files,
              sending: _sending,
              locked: _pendingBody != null,
              onPick: () async {
                if (_files.length >= 3) return showEdmnMessage(context, t.maxAttachments(3), error: true);
                final f = await ref.read(filePickerProvider).pick();
                if (f != null) setState(() => _files.add(f));
              },
              onRemove: (f) => setState(() => _files.remove(f)),
              onSend: _send,
            ),
        ]),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({required this.text, required this.files, required this.sending, required this.locked, required this.onPick, required this.onRemove, required this.onSend});
  final TextEditingController text;
  final List<PickedFile> files;
  final bool sending;
  final bool locked;
  final VoidCallback onPick;
  final void Function(PickedFile) onRemove;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Material(
      color: EdmnColors.surface,
      elevation: 6,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsetsDirectional.all(EdmnSpacing.xs),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (files.isNotEmpty)
              Wrap(spacing: EdmnSpacing.xs, children: [
                for (final f in files) InputChip(label: Text(f.name, overflow: TextOverflow.ellipsis), onDeleted: locked ? null : () => onRemove(f)),
              ]),
            Row(children: [
              IconButton(key: const Key('attach'), tooltip: t.attachFile, icon: Icon(Icons.attach_file_rounded, semanticLabel: t.attachFile), color: EdmnColors.primary, onPressed: sending || locked ? null : onPick),
              Expanded(child: EdmnTextField(key: const Key('message-input'), enabled: !locked, controller: text, hint: t.typeMessage, minLines: 1, maxLines: 4, maxLength: 2000)),
              const SizedBox(width: EdmnSpacing.xs),
              IconButton.filled(
                key: const Key('send'),
                tooltip: t.send,
                style: IconButton.styleFrom(backgroundColor: EdmnColors.primary),
                icon: sending ? Semantics(label: t.send, child: const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: EdmnColors.onPrimary))) : Icon(Icons.send_rounded, semanticLabel: t.send),
                onPressed: sending ? null : onSend,
              ),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _Bubble extends ConsumerWidget {
  const _Bubble({required this.m, required this.store});
  final GetConversationResponseMessagesItem m;
  final bool store;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final mine = m.mine;
    final bubble = Container(
      key: Key('msg-${m.id}'),
      constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
      margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
      padding: const EdgeInsetsDirectional.symmetric(horizontal: EdmnSpacing.sm, vertical: EdmnSpacing.xs),
      decoration: BoxDecoration(
        color: m.hidden ? EdmnColors.subtle : (mine ? EdmnColors.primary : EdmnColors.surface),
        border: mine ? null : Border.all(color: EdmnColors.border),
        borderRadius: BorderRadius.circular(EdmnRadii.card),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (m.hidden)
          Text(t.messageHidden, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary, fontStyle: FontStyle.italic))
        else ...[
          if (m.body.isNotEmpty) Text(m.body, style: EdmnType.body.copyWith(color: mine ? EdmnColors.onPrimary : EdmnColors.textPrimary)),
          for (final a in m.attachments) _Attachment(fileId: a.fileId, mimeType: a.mimeType, onDark: mine),
        ],
        const SizedBox(height: 2),
        Row(mainAxisSize: MainAxisSize.min, children: [
          Text(formatDateTime(context, m.createdAt), style: EdmnType.caption.copyWith(color: mine ? EdmnColors.onPrimary.withValues(alpha: 0.8) : EdmnColors.textSecondary)),
          if (mine) ...[
            const SizedBox(width: 4),
            Icon(m.readByOther ? Icons.done_all_rounded : Icons.done_rounded, size: 14, color: EdmnColors.onPrimary, semanticLabel: m.readByOther ? t.seenByOther : t.sent),
          ],
        ]),
      ]),
    );
    return Align(
      alignment: mine ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
      child: mine || m.hidden
          ? bubble
          : GestureDetector(key: Key('report-${m.id}'), onLongPress: () => showEdmnBottomSheet(context, title: t.reportMessage, child: _ReportForm(messageId: m.id, store: store)), child: bubble),
    );
  }
}

class _Attachment extends ConsumerWidget {
  const _Attachment({required this.fileId, required this.mimeType, required this.onDark});
  final String fileId;
  final String mimeType;
  final bool onDark;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    if (!mimeType.startsWith('image/')) {
      return TextButton.icon(
        key: Key('download-$fileId'),
        icon: Icon(Icons.download_outlined, color: onDark ? EdmnColors.onPrimary : EdmnColors.primary),
        label: Text(t.downloadPdf, style: EdmnType.secondary.copyWith(color: onDark ? EdmnColors.onPrimary : EdmnColors.primary)),
        onPressed: () => runAction(context, () async {
          final data = await ref.read(mobileApiProvider).file(fileId);
          await ref.read(fileSaverProvider).save('$fileId.pdf', data);
        }),
      );
    }
    final bytes = ref.watch(fileBytesProvider(fileId));
    return Padding(
      padding: const EdgeInsetsDirectional.only(top: EdmnSpacing.xxs),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(EdmnRadii.small),
        child: bytes.when(
          loading: () => const SizedBox(width: 160, height: 120, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
          error: (_, _) => SizedBox(width: 160, height: 60, child: Center(child: Icon(Icons.broken_image_outlined, color: onDark ? EdmnColors.onPrimary : EdmnColors.textSecondary))),
          data: (b) => GestureDetector(
            onTap: () => showDialog<void>(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.memory(b)))),
            child: Image.memory(b, width: 180, fit: BoxFit.cover, semanticLabel: t.imageAttachment),
          ),
        ),
      ),
    );
  }
}

class _ReportForm extends ConsumerStatefulWidget {
  const _ReportForm({required this.messageId, required this.store});
  final String messageId;
  final bool store;
  @override
  ConsumerState<_ReportForm> createState() => _ReportFormState();
}

class _ReportFormState extends ConsumerState<_ReportForm> {
  String _reason = 'INAPPROPRIATE';
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(t.reportMessageBody, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnRadioCard<String>(
        value: _reason,
        onChanged: (v) => setState(() => _reason = v),
        options: [
          EdmnRadioOption(value: 'INAPPROPRIATE', label: t.reportInappropriate, icon: Icons.block_rounded),
          EdmnRadioOption(value: 'FRAUD_ATTEMPT', label: t.reportFraud, icon: Icons.gpp_bad_outlined),
          EdmnRadioOption(value: 'UNNEEDED_DATA_REQUEST', label: t.reportDataRequest, icon: Icons.privacy_tip_outlined),
          EdmnRadioOption(value: 'OTHER', label: t.reportOther, icon: Icons.more_horiz_rounded),
        ],
      ),
      const SizedBox(height: EdmnSpacing.sm),
      EdmnTextField(controller: _note, hint: t.reportNoteHint, maxLines: 3, maxLength: 500),
      const SizedBox(height: EdmnSpacing.md),
      EdmnPrimaryButton(
        key: const Key('report-submit'),
        label: t.sendReport,
        loading: _busy,
        onPressed: () async {
          setState(() => _busy = true);
          final ok = await runAction(context, () => ref.read(mobileApiProvider).reportMessage(widget.messageId, _reason, note: _note.text.trim(), store: widget.store), success: t.reportSent);
          if (mounted) setState(() => _busy = false);
          if (ok && context.mounted) Navigator.pop(context);
        },
      ),
    ]);
  }
}
