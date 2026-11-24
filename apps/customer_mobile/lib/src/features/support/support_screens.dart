import 'package:edmn_api/mobile.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../common/file_pick.dart';
import '../../common/ui.dart';
import '../../providers.dart';
import '../messages/messages_screens.dart' show fileBytesProvider;

/// Help & support (C09–C16): my tickets, a new ticket (optionally about one of my orders / deals / payments), the
/// ticket thread with replies, reopen and rating — each offered only when the server lists it. Staff appear as
/// «فريق أضمن»; internal notes never reach the app.
final contentPageProvider = FutureProvider.autoDispose.family<GetContentPageResponse, String>((ref, slug) => ref.watch(mobileApiProvider).contentPage(slug));
final ticketsProvider = FutureProvider.autoDispose<ListSupportTicketsResponse>((ref) => ref.watch(mobileApiProvider).supportTickets());
final ticketProvider = FutureProvider.autoDispose.family<GetSupportTicketResponse, String>((ref, id) => ref.watch(mobileApiProvider).supportTicket(id));

(String, EdmnTone) ticketStatus(EdmnLocalizations t, String s) => switch (s) {
      'OPEN' => (t.ticketOpen, EdmnTone.info),
      'IN_PROGRESS' => (t.ticketInProgress, EdmnTone.info),
      'WAITING_CUSTOMER' => (t.ticketWaitingYou, EdmnTone.warning),
      'WAITING_SELLER' => (t.ticketWaitingSeller, EdmnTone.warning),
      'ESCALATED' => (t.ticketEscalated, EdmnTone.warning),
      'RESOLVED' => (t.ticketResolved, EdmnTone.success),
      'CLOSED' => (t.ticketClosed, EdmnTone.neutral),
      _ => (s, EdmnTone.neutral),
    };

/// Ticket types offered in the app, in the customer's words (the server validates the full list).
List<(String, String)> ticketTypes(EdmnLocalizations t) => [
      ('ORDER', t.ticketTypeOrder),
      ('PAYMENT', t.ticketTypePayment),
      ('SHIPPING', t.ticketTypeShipping),
      ('RETURN', t.ticketTypeReturn),
      ('PRODUCT', t.ticketTypeProduct),
      ('EXTERNAL_DEAL', t.protectedDeal),
      ('REFUND', t.ticketTypeRefund),
      ('ACCOUNT', t.ticketTypeAccount),
      ('IDENTITY', t.identityTitle),
      ('SELLER_FINANCE', t.ticketTypeSellerFinance),
      ('TECHNICAL', t.ticketTypeTechnical),
    ];

/* ───────────────────────── C09 support home ───────────────────────── */

class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    final list = ref.watch(ticketsProvider);
    return EdmnAppScaffold(
      title: t.helpSupport,
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(ticketsProvider.future),
        child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          EdmnCard(
            child: Row(children: [
              const Icon(Icons.support_agent_rounded, color: EdmnColors.primary, size: 40),
              const SizedBox(width: EdmnSpacing.sm),
              Expanded(child: Text(t.supportIntro, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary))),
            ]),
          ),
          const SizedBox(height: EdmnSpacing.md),
          EdmnPrimaryButton(key: const Key('new-ticket'), label: t.newTicket, icon: Icons.add_rounded, onPressed: () => context.push('/support/new')),
          const SizedBox(height: EdmnSpacing.xs),
          EdmnMenuGroup(children: [
            EdmnMenuItem(key: const Key('faq'), icon: Icons.quiz_outlined, title: t.faq, onTap: () => context.push('/pages/faq')),
            EdmnMenuItem(icon: Icons.assignment_return_outlined, title: t.returnsPolicy, onTap: () => context.push('/legal/returns')),
            EdmnMenuItem(icon: Icons.verified_user_outlined, title: t.protectedDealTerms, onTap: () => context.push('/legal/protected-deal-terms')),
          ]),
          const SizedBox(height: EdmnSpacing.md),
          EdmnSecondaryButton(key: const Key('open-messages'), label: t.messages, icon: Icons.chat_bubble_outline_rounded, onPressed: () => context.push('/messages')),
          const SizedBox(height: EdmnSpacing.lg),
          EdmnSectionHeader(title: t.myTickets),
          list.when(
            loading: () => const EdmnSkeletonList(),
            error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(ticketsProvider)),
            data: (r) => r.items.isEmpty
                ? EdmnEmptyState(icon: Icons.inbox_outlined, title: t.noTickets)
                : Column(children: [
                    for (final x in r.items)
                      Padding(
                        padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                        child: EdmnCard(
                          key: Key('ticket-${x.id}'),
                          onTap: () => context.push('/support/${x.id}'),
                          child: Row(children: [
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(x.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: EdmnType.bodyStrong.copyWith(color: EdmnColors.textPrimary)),
                                Text('#${x.number} · ${formatDateTime(context, x.updatedAt)}', style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                              ]),
                            ),
                            () {
                              final (l, tone) = ticketStatus(t, x.status);
                              return EdmnStatusChip(label: l, tone: tone);
                            }(),
                          ]),
                        ),
                      ),
                  ]),
          ),
        ]),
      ),
    );
  }
}

/* ───────────────────────── C10 new ticket ───────────────────────── */

class NewTicketScreen extends ConsumerStatefulWidget {
  const NewTicketScreen({super.key, this.type, this.relatedType, this.relatedId});
  final String? type;
  final String? relatedType;
  final String? relatedId;
  @override
  ConsumerState<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends ConsumerState<NewTicketScreen> {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  final _intent = IntentKey();
  late String _type = widget.type ?? 'ORDER';
  PickedFile? _file;
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return EdmnAppScaffold(
      title: t.newTicket,
      bottomBar: EdmnPrimaryButton(
        key: const Key('ticket-submit'),
        label: t.sendTicket,
        loading: _busy,
        onPressed: () async {
          if (_subject.text.trim().length < 5) return showEdmnMessage(context, t.ticketSubjectShort, error: true);
          if (_body.text.trim().length < 10) return showEdmnMessage(context, t.ticketBodyShort, error: true);
          setState(() => _busy = true);
          GetSupportTicketResponse? created;
          final ok = await runAction(context, () async {
            created = await ref.read(mobileApiProvider).openSupportTicket({
              'type': _type,
              'subject': _subject.text.trim(),
              'body': _body.text.trim(),
              if (widget.relatedId != null) 'relatedType': widget.relatedType ?? _type,
              'relatedId': ?widget.relatedId,
            }, attachment: _file == null ? null : (_file!.bytes, _file!.name), idempotencyKey: _intent.value);
          }, success: t.ticketSent);
          if (mounted) setState(() => _busy = false);
          if (ok && created != null && context.mounted) {
            ref.invalidate(ticketsProvider);
            context.pushReplacement('/support/${created!.id}');
          }
        },
      ),
      body: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
        if (widget.relatedId != null) ...[EdmnNotice(key: const Key('ticket-related'), message: t.ticketAboutThis), const SizedBox(height: EdmnSpacing.sm)],
        DropdownButtonFormField<String>(
          key: const Key('ticket-type'),
          initialValue: _type,
          isExpanded: true,
          decoration: InputDecoration(labelText: t.ticketType),
          items: [for (final (v, l) in ticketTypes(t)) DropdownMenuItem(value: v, child: Text(l))],
          onChanged: (v) => setState(() => _type = v ?? _type),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnTextField(key: const Key('ticket-subject'), controller: _subject, hint: t.ticketSubject, maxLength: 150),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnTextField(key: const Key('ticket-body'), controller: _body, hint: t.ticketBody, maxLines: 6, maxLength: 5000),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnUploadField(
          label: t.attachFile,
          hint: t.attachmentHint,
          fileName: _file?.name,
          onPick: () async {
            final f = await ref.read(filePickerProvider).pick();
            if (f != null) setState(() => _file = f);
          },
          onClear: () => setState(() => _file = null),
        ),
        const SizedBox(height: EdmnSpacing.sm),
        EdmnNotice(message: t.ticketPrivacyNote, icon: Icons.lock_outline_rounded),
      ]),
    );
  }
}

/* ───────────────────────── C11–C16 ticket thread ───────────────────────── */

class TicketScreen extends ConsumerStatefulWidget {
  const TicketScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends ConsumerState<TicketScreen> {
  final _reply = TextEditingController();
  final _intent = IntentKey();
  PickedFile? _file;
  bool _busy = false;

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _run(Future<Object?> Function(String key) action, {String? success}) async {
    setState(() => _busy = true);
    final ok = await runAction(context, () async => action(_intent.value), success: success);
    if (ok) _intent.reset();
    ref.invalidate(ticketProvider(widget.id));
    ref.invalidate(ticketsProvider);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    final ticket = ref.watch(ticketProvider(widget.id));
    final api = ref.read(mobileApiProvider);
    return EdmnAppScaffold(
      title: t.ticketTitle,
      body: AsyncView(
        value: ticket,
        onRetry: () => ref.invalidate(ticketProvider(widget.id)),
        data: (x) {
          final (label, tone) = ticketStatus(t, x.status);
          final a = x.allowedActions.toSet();
          return ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(x.subject, style: EdmnType.section.copyWith(color: EdmnColors.textPrimary, fontWeight: FontWeight.w800)),
                  Text('#${x.number}', textDirection: TextDirection.ltr, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                ]),
              ),
              EdmnStatusChip(label: label, tone: tone),
            ]),
            const SizedBox(height: EdmnSpacing.md),
            for (final m in x.messages)
              Align(
                alignment: m.mine ? AlignmentDirectional.centerStart : AlignmentDirectional.centerEnd,
                child: Container(
                  key: Key('tmsg-${m.id}'),
                  constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
                  margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                  padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm),
                  decoration: BoxDecoration(
                    color: m.fromStaff ? EdmnColors.primaryLight : EdmnColors.surface,
                    border: Border.all(color: EdmnColors.border),
                    borderRadius: BorderRadius.circular(EdmnRadii.card),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(m.fromStaff ? t.edmnTeam : t.you, style: EdmnType.caption.copyWith(color: EdmnColors.primaryDark, fontWeight: FontWeight.w800)),
                    Text(m.body, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary)),
                    if (m.attachmentFileId != null) _TicketAttachment(fileId: m.attachmentFileId!),
                    Text(formatDateTime(context, m.createdAt), style: EdmnType.caption.copyWith(color: EdmnColors.textSecondary)),
                  ]),
                ),
              ),
            const SizedBox(height: EdmnSpacing.md),
            if (a.contains('RATE'))
              EdmnPrimaryButton(key: const Key('rate-ticket'), label: t.rateService, icon: Icons.star_outline_rounded, onPressed: () async {
                final r = await showEdmnBottomSheet<(int, String)>(context, title: t.rateService, child: const _RateForm());
                if (r != null) await _run((k) => api.rateSupportTicket(x.id, r.$1, comment: r.$2, idempotencyKey: k), success: t.thanksForRating);
              }),
            if (a.contains('REOPEN')) ...[
              const SizedBox(height: EdmnSpacing.xs),
              EdmnSecondaryButton(key: const Key('reopen-ticket'), label: t.reopenTicket, onPressed: () async {
                final c = TextEditingController();
                final reason = await showEdmnBottomSheet<String>(
                  context,
                  title: t.reopenTicket,
                  child: EdmnTextField(key: const Key('reopen-reason'), controller: c, hint: t.reopenReasonHint, maxLines: 3),
                  action: Builder(builder: (s) => EdmnPrimaryButton(key: const Key('reopen-ok'), label: t.confirm, onPressed: () => c.text.trim().length >= 5 ? Navigator.pop(s, c.text.trim()) : null)),
                );
                if (reason != null) await _run((k) => api.reopenSupportTicket(x.id, reason, idempotencyKey: k));
              }),
            ],
            if (a.contains('REPLY')) ...[
              const SizedBox(height: EdmnSpacing.md),
              if (x.status == 'RESOLVED' || x.status == 'CLOSED') ...[EdmnNotice(message: t.replyReopensTicket), const SizedBox(height: EdmnSpacing.xs)],
              EdmnTextField(key: const Key('ticket-reply'), controller: _reply, hint: t.writeReply, maxLines: 4, maxLength: 5000),
              const SizedBox(height: EdmnSpacing.xs),
              EdmnUploadField(label: t.attachFile, hint: t.attachmentHint, fileName: _file?.name, onPick: () async {
                final f = await ref.read(filePickerProvider).pick();
                if (f != null) setState(() => _file = f);
              }, onClear: () => setState(() => _file = null)),
              const SizedBox(height: EdmnSpacing.xs),
              EdmnPrimaryButton(key: const Key('ticket-reply-send'), label: t.send, loading: _busy, onPressed: () async {
                if (_reply.text.trim().length < 2) return;
                await _run((k) => api.replySupportTicket(x.id, _reply.text.trim(), attachment: _file == null ? null : (_file!.bytes, _file!.name), idempotencyKey: k));
                _reply.clear();
                setState(() => _file = null);
              }),
            ],
          ]);
        },
      ),
    );
  }
}

class _TicketAttachment extends ConsumerWidget {
  const _TicketAttachment({required this.fileId});
  final String fileId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    return ref.watch(fileBytesProvider(fileId)).when(
          loading: () => const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator()),
          error: (e, _) => EdmnErrorState(error: e, onRetry: () => ref.invalidate(fileBytesProvider(fileId))),
          data: (b) => b.length >= 4 && b[0] == 37 && b[1] == 80 && b[2] == 68 && b[3] == 70
              ? TextButton.icon(
                  icon: const Icon(Icons.download_outlined), label: Text(t.downloadPdf),
                  onPressed: () => runAction(context, () => ref.read(fileSaverProvider).save('$fileId.pdf', b)),
                )
              : Padding(
            padding: const EdgeInsetsDirectional.symmetric(vertical: EdmnSpacing.xxs),
            child: Image.memory(b, width: 180, errorBuilder: (_, _, _) => Row(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.picture_as_pdf_outlined, color: EdmnColors.error), Text(t.pdfAttachment)])),
          ),
        );
  }
}

class _RateForm extends StatefulWidget {
  const _RateForm();
  @override
  State<_RateForm> createState() => _RateFormState();
}

class _RateFormState extends State<_RateForm> {
  int _stars = 5;
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 1; i <= 5; i++)
          IconButton(
            key: Key('star-$i'),
            tooltip: '$i',
            icon: Icon(i <= _stars ? Icons.star_rounded : Icons.star_outline_rounded, color: EdmnColors.warning, size: 36, semanticLabel: '$i'),
            onPressed: () => setState(() => _stars = i),
          ),
      ]),
      EdmnTextField(controller: _c, hint: t.ratingCommentHint, maxLines: 3, maxLength: 1000),
      const SizedBox(height: EdmnSpacing.md),
      EdmnPrimaryButton(key: const Key('rate-submit'), label: t.send, onPressed: () => Navigator.pop(context, (_stars, _c.text.trim()))),
    ]);
  }
}

/// C10: a help page from the admin CMS. When EDMN has not published it, the server says so (not found) and the app
/// shows that — never invented questions and answers.
class ContentPageScreen extends ConsumerWidget {
  const ContentPageScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final page = ref.watch(contentPageProvider(slug));
    return EdmnAppScaffold(
      title: page.value?.title ?? EdmnLocalizations.of(context).faq,
      body: AsyncView(
        value: page,
        onRetry: () => ref.invalidate(contentPageProvider(slug)),
        data: (p) => ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.screen), children: [
          Text(p.body, style: EdmnType.body.copyWith(color: EdmnColors.textPrimary, height: 1.8)),
        ]),
      ),
    );
  }
}
