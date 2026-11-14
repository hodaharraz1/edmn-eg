import 'package:edmn_core/edmn_core.dart';
import 'package:flutter/widgets.dart';

import 'l10n/edmn_localizations.dart';

/// The ONLY mapping from API error codes to user-facing text (Arabic default, English secondary). The server's
/// `detail` is never shown for logic; an internal error shows its support reference.
String apiErrorMessage(BuildContext context, Object error) {
  final t = EdmnLocalizations.of(context);
  if (error is! ApiFailure) return t.errorUnknown;
  final base = switch (error.code) {
    ApiErrorCode.validationFailed => t.errorValidation,
    ApiErrorCode.unauthenticated => t.errorUnauthenticated,
    ApiErrorCode.forbidden => t.errorForbidden,
    ApiErrorCode.notFound => t.errorNotFound,
    ApiErrorCode.conflict => t.errorConflict,
    ApiErrorCode.invalidState => t.errorInvalidState,
    ApiErrorCode.insufficientStock => t.errorInsufficientStock,
    ApiErrorCode.insufficientBalance => t.errorInsufficientBalance,
    ApiErrorCode.rateLimited => t.errorRateLimited,
    ApiErrorCode.mfaRequired => t.errorMfaRequired,
    ApiErrorCode.stepUpRequired => t.errorStepUpRequired,
    ApiErrorCode.identityRequired => t.errorIdentityRequired,
    ApiErrorCode.sellerRequired => t.errorSellerRequired,
    ApiErrorCode.idempotencyKeyRequired || ApiErrorCode.idempotencyKeyReused || ApiErrorCode.idempotencyInProgress => t.errorIdempotency,
    ApiErrorCode.internalError => t.errorInternal,
    ApiErrorCode.network => t.errorNetwork,
    ApiErrorCode.unknown => t.errorUnknown,
  };
  return error.reference == null ? base : '$base\n${t.errorReference(error.reference!)}';
}
