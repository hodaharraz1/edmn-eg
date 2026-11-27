import 'package:edmn_api/admin.dart';
import 'package:edmn_core/edmn_core.dart';
import 'package:edmn_design/edmn_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers.dart';
import 'monitoring_screens.dart';

/// Detail views. Every figure, status and name comes from the server, already minimised there (masked names, no
/// identifiers, contacts or documents). The only actions are the dispute assignment and the internal note.

String fmtTime(String? iso) {
  if (iso == null) return '';
  final d = DateTime.tryParse(iso)?.toLocal();
  if (d == null) return '';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
}

/// A status-history entry from any detail payload (each response has its own generated class of the same shape).
class HistoryEntry {
  const HistoryEntry({required this.to, this.from, this.actor, this.note, required this.at});
  final String to;
  final String? from;
  final String? actor;
  final String? note;
  final String at;
}

/// Loads [load] once, with loading, error (retry) and pull-to-refresh; a server refusal or expired session surfaces
/// through ErrorView (the API client signs out on an ended session).
class DetailScaffold<T> extends ConsumerStatefulWidget {
  const DetailScaffold({super.key, required this.title, required this.load, required this.build, this.actions});
  final String title;
  final Future<T> Function(AdminApi api) load;
  final List<Widget> Function(BuildContext context, T data, Future<void> Function() reload) build;
  final List<Widget> Function(BuildContext context, T data, Future<void> Function() reload)? actions;
  @override
  ConsumerState<DetailScaffold<T>> createState() => _DetailScaffoldState<T>();
}

class _DetailScaffoldState<T> extends ConsumerState<DetailScaffold<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = _data == null;
      _error = null;
    });
    try {
      final d = await widget.load(ref.read(adminApiProvider));
      if (mounted) setState(() => (_data = d, _loading = false));
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _data = null; // never keep showing a record the server just refused
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title), actions: data == null || widget.actions == null ? null : widget.actions!(context, data, _reload)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : data == null
              ? ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm), children: [ErrorView(error: _error ?? 'unknown', onRetry: _reload)])
              : RefreshIndicator(
                  onRefresh: _reload,
                  child: ListView(padding: const EdgeInsetsDirectional.all(EdmnSpacing.sm), children: widget.build(context, data, _reload)),
                ),
    );
  }
}

class Section extends StatelessWidget {
  const Section({super.key, required this.title, required this.children});
  final String title;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
        child: EdmnCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Semantics(header: true, child: Text(title, style: EdmnType.section)),
            const SizedBox(height: EdmnSpacing.xs),
            ...children,
          ]),
        ),
      );
}

/// Label / value row; the pair is read as one sentence by screen readers.
class Field extends StatelessWidget {
  const Field(this.label, this.value, {super.key, this.valueWidget});
  final String label;
  final String? value;
  final Widget? valueWidget;
  @override
  Widget build(BuildContext context) {
    if (valueWidget == null && (value == null || value!.isEmpty)) return const SizedBox.shrink();
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsetsDirectional.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 130, child: Text(label, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary))),
          Expanded(child: valueWidget ?? Text(value!, style: EdmnType.body)),
        ]),
      ),
    );
  }
}

Widget statusChip(BuildContext context, String status) {
  final (label, tone) = adminStatus(EdmnLocalizations.of(context), status);
  return Align(alignment: AlignmentDirectional.centerStart, child: EdmnStatusChip(label: label, tone: tone));
}

Widget timeline(BuildContext context, List<HistoryEntry> entries) {
  final t = EdmnLocalizations.of(context);
  if (entries.isEmpty) return Text(t.adminNoTimeline, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary));
  return EdmnTrackingTimeline(steps: [
    for (var i = 0; i < entries.length; i++)
      EdmnTimelineStep(
        title: adminStatus(t, entries[i].to).$1,
        state: i == entries.length - 1 ? EdmnStepState.current : EdmnStepState.done,
        time: fmtTime(entries[i].at),
        detail: [entries[i].actor, entries[i].note].whereType<String>().where((s) => s.isNotEmpty).join(' · '),
      ),
  ]);
}

/* ───────────────────────────── Seller application ───────────────────────────── */

class SellerDetailScreen extends StatelessWidget {
  const SellerDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return DetailScaffold<AdminGetSellerResponse>(
      title: t.adminSellerApplications,
      load: (api) => api.seller(id),
      build: (context, s, _) => [
        Section(title: s.storeName ?? s.applicant ?? '—', children: [
          statusChip(context, s.status),
          Field(t.adminFieldType, s.type),
          Field(t.adminFieldRisk, s.riskLevel),
          Field(t.adminFieldGovernorate, s.governorate),
          Field(t.adminFieldSubmitted, fmtTime(s.submittedAt)),
        ]),
        Section(title: t.adminSectionChecklist, children: [
          for (final c in s.checklist)
            Semantics(
              label: '${c.label}: ${c.ok ? t.adminYes : t.adminNo}',
              excludeSemantics: true,
              child: Row(children: [
                Icon(c.ok ? Icons.check_circle : Icons.cancel_outlined, color: c.ok ? EdmnColors.success : EdmnColors.error, size: 20),
                const SizedBox(width: EdmnSpacing.xs),
                Expanded(child: Text(c.label)),
              ]),
            ),
        ]),
        Section(title: t.adminSectionDocuments, children: [
          if (s.documents == null)
            Text(t.adminDocsNoPermission, key: const Key('docs-hidden'), style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary))
          else
            for (final d in s.documents!) Field(d.kind, '${adminStatus(t, d.status).$1} · ${fmtTime(d.uploadedAt)}'),
        ]),
        Section(title: t.adminSectionTimeline, children: [
          timeline(context, [for (final h in s.history) HistoryEntry(to: h.to, from: h.from, actor: h.actor, note: h.note, at: h.at)]),
        ]),
        EdmnNotice(message: t.adminDecisionsOnWeb),
      ],
    );
  }
}

/* ───────────────────────────── KYC case ───────────────────────────── */

class IdentityDetailScreen extends StatelessWidget {
  const IdentityDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return DetailScaffold<AdminGetIdentityReviewResponse>(
      title: t.adminIdentityReviews,
      load: (api) => api.identityReview(id),
      build: (context, v, _) => [
        Section(title: v.name ?? '—', children: [
          statusChip(context, v.status),
          Field(t.adminSectionDocuments, v.documentsComplete ? t.adminDocsComplete : t.adminDocsMissing),
          Field(t.adminFieldSubmitted, fmtTime(v.submittedAt)),
          Field(t.adminFieldReviewed, fmtTime(v.reviewedAt)),
          Field(t.adminFieldReviewer, v.reviewedBy),
          Field(t.adminFieldReason, v.rejectionReason),
        ]),
        Section(title: t.adminSectionReviewTrail, children: [
          timeline(context, [for (final e in v.events) HistoryEntry(to: e.to ?? e.action, from: e.from, actor: e.by, note: e.reason, at: e.at)]),
        ]),
        EdmnNotice(message: t.adminDecisionsOnWeb),
      ],
    );
  }
}

/* ───────────────────────────── Order ───────────────────────────── */

class OrderDetailScreen extends StatelessWidget {
  const OrderDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return DetailScaffold<AdminGetOrderResponse>(
      title: t.adminOrders,
      load: (api) => api.order(id),
      build: (context, o, _) => [
        Section(title: '#${o.number}', children: [
          statusChip(context, o.status),
          Field(t.adminFieldCustomer, o.customer),
          Field(t.adminFieldPlaced, fmtTime(o.placedAt)),
          Field(t.adminFieldPaid, fmtTime(o.paidAt)),
          Field(t.adminFieldMerchandise, null, valueWidget: EgpText(o.totals.merchandise)),
          Field(t.adminFieldShipping, null, valueWidget: EgpText(o.totals.shipping)),
          Field(t.adminFieldGrand, null, valueWidget: EgpText(o.totals.grand, style: EdmnType.bodyStrong)),
          if (o.payment != null) Field(t.adminFieldPayment, '${o.payment!.method} · ${adminStatus(t, o.payment!.status).$1}'),
        ]),
        for (final so in o.sellerOrders)
          Section(title: '#${so.number} · ${so.store ?? ''}', children: [
            statusChip(context, so.status),
            for (final i in so.items) Field('${i.quantity} ×', null, valueWidget: Row(children: [Expanded(child: Text(i.title)), EgpText(i.lineTotal)])),
            if (so.shipment != null) ...[
              const Divider(),
              Text(t.adminSectionShipment, style: EdmnType.bodyStrong),
              Field(t.adminFieldStatus, adminStatus(t, so.shipment!.status).$1),
              Field(t.adminFieldCarrier, so.shipment!.carrier),
              Field(t.adminFieldTracking, so.shipment!.trackingNumber),
              Field(t.adminFieldExpected, fmtTime(so.shipment!.expectedAt)),
              if (so.shipment!.events.isNotEmpty)
                EdmnTrackingTimeline(steps: [
                  for (var i = 0; i < so.shipment!.events.length; i++)
                    EdmnTimelineStep(
                      title: adminStatus(t, so.shipment!.events[i].status).$1,
                      state: i == so.shipment!.events.length - 1 ? EdmnStepState.current : EdmnStepState.done,
                      time: fmtTime(so.shipment!.events[i].at),
                      detail: so.shipment!.events[i].description,
                    ),
                ]),
            ],
          ]),
        Section(title: t.adminSectionTimeline, children: [
          timeline(context, [for (final h in o.history) HistoryEntry(to: h.to, from: h.from, actor: h.actor, note: h.note, at: h.at)]),
        ]),
        EdmnNotice(message: t.adminDecisionsOnWeb),
      ],
    );
  }
}

/* ───────────────────────────── Protected deal ───────────────────────────── */

class DealDetailScreen extends StatelessWidget {
  const DealDetailScreen({super.key, required this.id});
  final String id;
  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return DetailScaffold<AdminGetDealResponse>(
      title: t.adminDeals,
      load: (api) => api.deal(id),
      build: (context, d, _) => [
        Section(title: '${d.ref} · ${d.title}', children: [
          statusChip(context, d.status),
          Field(t.adminFieldBuyer, d.buyer),
          Field(t.adminFieldSeller, d.sellerConfirmed ? d.seller : '${d.seller ?? '—'} (${t.adminSellerUnconfirmed})'),
          Field(t.adminFieldDealTotal, null, valueWidget: EgpText(d.money.total)),
          Field(t.adminFieldBuyerPays, null, valueWidget: EgpText(d.money.buyerPays)),
          Field(t.adminFieldSellerGets, null, valueWidget: EgpText(d.money.sellerReceives)),
          if (d.payment != null) Field(t.adminFieldPayment, '${d.payment!.method} · ${adminStatus(t, d.payment!.status).$1}'),
          Field(t.adminFieldHold, d.financialHold ? t.adminYes : t.adminNo),
          Field(t.adminFieldEvidence, '${d.evidenceCount}'),
        ]),
        if (d.disputes.isNotEmpty)
          Section(title: t.adminSectionDisputes, children: [
            for (final x in d.disputes) Field('#${x.number}', adminStatus(t, x.status).$1),
          ]),
        Section(title: t.adminSectionTimeline, children: [
          timeline(context, [for (final h in d.history) HistoryEntry(to: h.to, from: h.from, actor: h.actor, note: h.note, at: h.at)]),
        ]),
        EdmnNotice(message: t.adminDecisionsOnWeb),
      ],
    );
  }
}

/* ───────────────────────────── Dispute (with the two safe actions) ───────────────────────────── */

class DisputeDetailScreen extends ConsumerWidget {
  const DisputeDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    return DetailScaffold<AdminGetDisputeResponse>(
      title: t.adminDisputes,
      load: (api) => api.dispute(id),
      build: (context, d, reload) {
        final open = const {'OPEN', 'UNDER_REVIEW', 'AWAITING_INFORMATION'}.contains(d.status);
        return [
          Section(title: '#${d.number}', children: [
            statusChip(context, d.status),
            Field(t.adminFieldSubject, '${switch (d.subject.kind) { 'DEAL' => t.adminKindDeal, 'RETURN' => t.adminKindReturn, _ => t.adminKindOrder }} ${d.subject.number == null ? '' : '#${d.subject.number}'}'),
            Field(t.adminFieldReasonCode, d.reasonCode),
            Field(t.adminFieldClaimant, d.claimant),
            Field(t.adminFieldRespondent, d.respondent),
            if (d.claimedAmount != null) Field(t.adminFieldClaimed, null, valueWidget: EgpText(d.claimedAmount)),
            Field(t.adminFieldAssignee, d.assignee == null ? t.adminUnassigned : '${d.assignee!.name ?? '—'}${d.assignee!.isMe ? ' (${t.adminMe})' : ''}'),
            const SizedBox(height: EdmnSpacing.xs),
            Text(d.description, style: EdmnType.body),
          ]),
          if (open)
            Padding(
              padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
              child: Wrap(spacing: EdmnSpacing.xs, runSpacing: EdmnSpacing.xs, children: [
                FilledButton.icon(key: const Key('assign'), onPressed: () => _assign(context, ref, d, reload), icon: const Icon(Icons.person_add_alt_1), label: Text(t.adminAssign)),
                OutlinedButton.icon(key: const Key('add-note'), onPressed: () => _note(context, ref, d, reload), icon: const Icon(Icons.sticky_note_2_outlined), label: Text(t.adminAddNote)),
              ]),
            ),
          Section(title: t.adminSectionMessages, children: [
            if (d.messages.isEmpty) Text(t.adminNoTimeline, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            for (final m in d.messages)
              Container(
                key: Key('msg-${m.id}'),
                margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                padding: const EdgeInsetsDirectional.all(EdmnSpacing.xs),
                decoration: BoxDecoration(color: m.internal ? EdmnColors.warningLight : EdmnColors.subtle, borderRadius: BorderRadius.circular(EdmnRadii.small)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${m.author ?? m.authorRole} · ${fmtTime(m.at)}${m.internal ? ' · ${t.adminInternalNote}' : ''}', style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                  Text(m.body),
                ]),
              ),
          ]),
          Section(title: t.adminSectionEvidence, children: [
            if (d.evidence.isEmpty) Text(t.adminNoTimeline, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
            for (final e in d.evidence) Field(fmtTime(e.at), [e.uploadedBy, e.note].whereType<String>().join(' · ')),
          ]),
          Section(title: t.adminSectionTimeline, children: [
            timeline(context, [for (final h in d.history) HistoryEntry(to: h.to, from: h.from, actor: h.actor, note: h.note, at: h.at)]),
          ]),
          EdmnNotice(message: t.adminDecisionsOnWeb),
        ];
      },
    );
  }

  Future<void> _assign(BuildContext context, WidgetRef ref, AdminGetDisputeResponse d, Future<void> Function() reload) async {
    final t = EdmnLocalizations.of(context);
    final api = ref.read(adminApiProvider);
    final messenger = ScaffoldMessenger.of(context);
    // Requested once per sheet (a future created inside the builder would refetch on every rebuild).
    final assignees = api.disputeAssignees();
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => FutureBuilder<AdminListDisputeAssigneesResponse>(
        future: assignees,
        builder: (context, snap) {
          if (snap.hasError) return Padding(padding: const EdgeInsets.all(16), child: ErrorView(error: snap.error!));
          if (!snap.hasData) return const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()));
          return ListView(shrinkWrap: true, children: [
            ListTile(title: Text(t.adminAssignTo, style: EdmnType.section)),
            for (final a in snap.data!.items)
              ListTile(
                key: Key('assignee-${a.id}'),
                leading: Icon(a.id == d.assignee?.id ? Icons.radio_button_checked : Icons.radio_button_off),
                title: Text('${a.name ?? '—'}${a.isMe ? ' (${t.adminMe})' : ''}'),
                onTap: () => Navigator.of(context).pop(a.id),
              ),
          ]);
        },
      ),
    );
    if (picked == null || picked == d.assignee?.id) return;
    if (!context.mounted) return;
    await _run(context, messenger, () => api.assignDispute(d.id, picked, idempotencyKey: newIdempotencyKey()), t.adminAssigned, reload);
  }

  Future<void> _note(BuildContext context, WidgetRef ref, AdminGetDisputeResponse d, Future<void> Function() reload) async {
    final t = EdmnLocalizations.of(context);
    final api = ref.read(adminApiProvider);
    final messenger = ScaffoldMessenger.of(context);
    // One key per note intent: a retry after a dropped response replays instead of storing the note twice.
    final key = newIdempotencyKey();
    final text = await showDialog<String>(context: context, builder: (context) => const _NoteDialog());
    if (text == null || text.length < 2) return;
    if (!context.mounted) return;
    await _run(context, messenger, () => api.addDisputeNote(d.id, text, idempotencyKey: key), t.adminNoteAdded, reload);
  }

  Future<void> _run(BuildContext context, ScaffoldMessengerState messenger, Future<void> Function() action, String done, Future<void> Function() reload) async {
    try {
      await action();
      messenger.showSnackBar(SnackBar(content: Text(done)));
      await reload();
    } on ApiFailure catch (e) {
      // The server's refusal (not eligible, closed, no permission, session ended) in the user's language.
      if (context.mounted) messenger.showSnackBar(SnackBar(key: const Key('action-error'), content: Text(apiErrorMessage(context, e))));
    }
  }
}

/// Owns its text controller, so the controller outlives the dialog's closing animation.
class _NoteDialog extends StatefulWidget {
  const _NoteDialog();
  @override
  State<_NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<_NoteDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return AlertDialog(
      title: Text(t.adminAddNote),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(t.adminNoteHint, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          const SizedBox(height: EdmnSpacing.xs),
          TextField(key: const Key('note-text'), controller: _controller, maxLines: 4, maxLength: 4000, autofocus: true),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(t.adminCancel)),
        FilledButton(key: const Key('note-save'), onPressed: () => Navigator.of(context).pop(_controller.text.trim()), child: Text(t.adminSave)),
      ],
    );
  }
}

/* ───────────────────────────── Return (monitoring only) ───────────────────────────── */

/// A return seen by staff: where it stands and what happens next. No decision here: the seller decides in its app and
/// refunds are approved and paid on the web console (two people).
class ReturnDetailScreen extends StatelessWidget {
  const ReturnDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return DetailScaffold<AdminReturnDetailResponse>(
      title: t.adminReturns,
      load: (api) => api.returnDetail(id),
      build: (context, r, _) => [
        Section(title: '#${r.number}', children: [
          statusChip(context, r.status),
          Field(t.adminFieldNextStep, adminReturnNextStep(t, r.status)),
          Field(t.adminFieldReason, r.reason),
          Field(t.adminFieldStatutory, r.isStatutory ? t.adminYes : t.adminNo),
          Field(t.adminFieldDecision, r.decisionReason),
          Field(t.adminFieldCarrier, r.returnCarrier),
          Field(t.adminFieldTracking, r.returnTracking, valueWidget: r.returnTracking == null ? null : Text(r.returnTracking!, textDirection: TextDirection.ltr)),
          Field(t.adminFieldInspection, r.inspectionNote),
          if (r.refundAmount != null) Field(t.adminFieldRefund, null, valueWidget: EgpText(r.refundAmount)),
          Field(t.adminFieldEvidenceCount, '${r.evidenceCount}'),
          Field(t.adminFieldSubmitted, fmtTime(r.createdAt)),
          const SizedBox(height: EdmnSpacing.xs),
          Text(r.description, style: EdmnType.body),
        ]),
        Section(title: t.adminSectionItems, children: [
          for (final i in r.items) Field('× ${i.quantity}', null, valueWidget: EgpText(i.unitPrice)),
        ]),
        EdmnNotice(key: const Key('returns-on-web'), message: t.adminReturnsOnWeb),
      ],
    );
  }
}

/* ───────────────────────────── Customer 360 (read only) ───────────────────────────── */

class CustomerDetailScreen extends StatelessWidget {
  const CustomerDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    String verified(bool v) => v ? t.adminVerified : t.adminNotVerified;
    return DetailScaffold<AdminCustomerDetailResponse>(
      title: t.adminCustomers,
      load: (api) => api.customer(id),
      build: (context, c, _) => [
        Section(title: c.name, children: [
          statusChip(context, c.status),
          // Contact data arrives masked from the server; it is shown left-to-right as received.
          if (c.email != null) Field(t.adminFieldEmail, null, valueWidget: Text('${c.email} (${verified(c.emailVerified)})', textDirection: TextDirection.ltr, textAlign: TextAlign.start)),
          if (c.phone != null) Field(t.adminFieldPhone, null, valueWidget: Text('${c.phone} (${verified(c.phoneVerified)})', textDirection: TextDirection.ltr, textAlign: TextAlign.start)),
          Field(t.adminFieldLastLogin, fmtTime(c.lastLoginAt)),
          Field(t.adminFieldJoined, fmtTime(c.createdAt)),
        ]),
        Section(title: t.adminSectionActivity, children: [
          Field(t.adminCountOrders, '${c.counts.orders}'),
          Field(t.adminCountReturns, '${c.counts.returns}'),
          Field(t.adminCountDisputes, '${c.counts.disputes}'),
          Field(t.adminCountTickets, '${c.counts.supportTickets}'),
          Field(t.adminCountDeals, '${c.counts.deals}'),
          Field(t.adminCountReviews, '${c.counts.reviews}'),
        ]),
        if (c.addresses.isNotEmpty) Section(title: t.adminSectionAddresses, children: [for (final a in c.addresses) Text(a, style: EdmnType.body)]),
        Section(title: t.adminSectionRecentOrders, children: [
          if (c.recentOrders.isEmpty) Text(t.adminNoTimeline, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          for (final o in c.recentOrders)
            ListTile(
              key: Key('cust-order-${o.id}'),
              contentPadding: EdgeInsets.zero,
              title: Text('#${o.number}', textDirection: TextDirection.ltr, textAlign: TextAlign.start),
              subtitle: Text(fmtTime(o.placedAt)),
              trailing: EgpText(o.grandTotal),
              onTap: () => context.push('/monitor/orders/${o.id}'),
            ),
        ]),
        EdmnNotice(message: t.adminCustomerManageOnWeb),
      ],
    );
  }
}

/* ───────────────────────────── Support ticket (+ the one approved reply) ───────────────────────────── */

class SupportTicketDetailScreen extends ConsumerWidget {
  const SupportTicketDetailScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = EdmnLocalizations.of(context);
    return DetailScaffold<AdminSupportTicketDetailResponse>(
      title: t.adminSupportInbox,
      load: (api) => api.supportTicket(id),
      build: (context, d, reload) {
        final open = !const {'RESOLVED', 'CLOSED'}.contains(d.status);
        return [
          Section(title: '#${d.number} · ${d.subject}', children: [
            statusChip(context, d.status),
            Field(t.adminFieldType, d.type),
            Field(t.adminFieldPriority, d.priority),
            if (d.fromSeller) Field(t.adminFieldCustomer, t.adminFromSeller),
            if (d.assignedToMe) Field(t.adminFieldAssignee, t.adminMe),
          ]),
          if (open)
            Padding(
              padding: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.sm),
              child: FilledButton.icon(key: const Key('reply'), onPressed: () => _reply(context, ref, d, reload), icon: const Icon(Icons.reply_rounded), label: Text(t.adminReply)),
            ),
          Section(title: t.adminSectionMessages, children: [
            for (final m in d.messages)
              Container(
                key: Key('tmsg-${m.id}'),
                margin: const EdgeInsetsDirectional.only(bottom: EdmnSpacing.xs),
                padding: const EdgeInsetsDirectional.all(EdmnSpacing.xs),
                decoration: BoxDecoration(color: m.isInternal ? EdmnColors.warningLight : (m.isStaff ? EdmnColors.primaryLight : EdmnColors.subtle), borderRadius: BorderRadius.circular(EdmnRadii.small)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${m.author ?? '—'} · ${fmtTime(m.createdAt)}${m.isInternal ? ' · ${t.adminInternalNote}' : ''}${m.hasAttachment ? ' · ${t.adminAttachment}' : ''}',
                      style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
                  Text(m.body),
                ]),
              ),
          ]),
          EdmnNotice(message: t.adminSupportOnWeb),
        ];
      },
    );
  }

  Future<void> _reply(BuildContext context, WidgetRef ref, AdminSupportTicketDetailResponse d, Future<void> Function() reload) async {
    final t = EdmnLocalizations.of(context);
    final api = ref.read(adminApiProvider);
    final messenger = ScaffoldMessenger.of(context);
    // One key per reply intent: a retry after a dropped response replays instead of posting the reply twice.
    final key = newIdempotencyKey();
    final text = await showDialog<String>(context: context, builder: (context) => const _ReplyDialog());
    if (text == null || text.length < 2) return;
    try {
      await api.replySupportTicket(d.id, text, idempotencyKey: key);
      messenger.showSnackBar(SnackBar(key: const Key('reply-sent'), content: Text(t.adminReplySent)));
      await reload();
    } on ApiFailure catch (e) {
      if (context.mounted) messenger.showSnackBar(SnackBar(key: const Key('action-error'), content: Text(apiErrorMessage(context, e))));
    }
  }
}

class _ReplyDialog extends StatefulWidget {
  const _ReplyDialog();
  @override
  State<_ReplyDialog> createState() => _ReplyDialogState();
}

class _ReplyDialogState extends State<_ReplyDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = EdmnLocalizations.of(context);
    return AlertDialog(
      title: Text(t.adminReply),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(t.adminReplyHint, style: EdmnType.secondary.copyWith(color: EdmnColors.textSecondary)),
          const SizedBox(height: EdmnSpacing.xs),
          // 4000 = the server's limit for a mobile reply.
          TextField(key: const Key('reply-text'), controller: _controller, maxLines: 5, maxLength: 4000, autofocus: true),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(t.adminCancel)),
        FilledButton(key: const Key('reply-send'), onPressed: () => Navigator.of(context).pop(_controller.text.trim()), child: Text(t.adminReplySend)),
      ],
    );
  }
}
