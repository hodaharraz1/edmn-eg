// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'edmn_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class EdmnLocalizationsEn extends EdmnLocalizations {
  EdmnLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appNameCustomer => 'EDMN';

  @override
  String get appNameAdmin => 'EDMN Admin';

  @override
  String get retry => 'Try again';

  @override
  String get cancel => 'Cancel';

  @override
  String get confirm => 'Confirm';

  @override
  String get signIn => 'Sign in';

  @override
  String get signOut => 'Sign out';

  @override
  String get identifierLabel => 'Email or mobile number';

  @override
  String get passwordLabel => 'Password';

  @override
  String get fieldRequired => 'This field is required';

  @override
  String get home => 'Home';

  @override
  String get categories => 'Categories';

  @override
  String get searchHint => 'Search for a product';

  @override
  String get noResults => 'No results';

  @override
  String get inStock => 'In stock';

  @override
  String get outOfStock => 'Out of stock';

  @override
  String get account => 'My account';

  @override
  String get devices => 'Signed-in devices';

  @override
  String get thisDevice => 'This device';

  @override
  String get signOutDevice => 'Sign out this device';

  @override
  String get signOutOtherDevices => 'Sign out all other devices';

  @override
  String signedOutOthers(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Signed out of $count devices',
      one: 'Signed out of 1 device',
      zero: 'No other devices',
    );
    return '$_temp0';
  }

  @override
  String get testMoneyBanner =>
      'Test mode: payments are test-only and no real money moves';

  @override
  String get updateRequiredTitle => 'Update required';

  @override
  String get updateRequiredBody =>
      'This version of the app is no longer supported. Please update to continue.';

  @override
  String get mfaTitle => 'Two-step verification';

  @override
  String get mfaEnterCode =>
      'Enter the 6-digit code from your authenticator app';

  @override
  String get mfaEnrollHint =>
      'Add this account to your authenticator app with the key below, then enter the code';

  @override
  String get verify => 'Verify';

  @override
  String get permissions => 'Permissions';

  @override
  String get language => 'Language';

  @override
  String get errorValidation => 'Please check the information you entered';

  @override
  String get errorUnauthenticated =>
      'Your session ended or the sign-in details are incorrect. Please sign in again';

  @override
  String get errorForbidden => 'You are not allowed to do this';

  @override
  String get errorNotFound => 'We couldn\'t find what you\'re looking for';

  @override
  String get errorConflict =>
      'Something changed meanwhile. Refresh and try again';

  @override
  String get errorInvalidState => 'This action isn\'t available right now';

  @override
  String get errorInsufficientStock =>
      'The requested quantity isn\'t available';

  @override
  String get errorInsufficientBalance => 'Insufficient balance';

  @override
  String get errorRateLimited => 'Too many attempts. Please wait and try again';

  @override
  String get errorMfaRequired => 'Please complete two-step verification';

  @override
  String get errorStepUpRequired =>
      'Confirm it\'s you with a verification code first';

  @override
  String get errorIdentityRequired => 'Please verify your identity first';

  @override
  String get errorSellerRequired => 'This action is for sellers only';

  @override
  String get errorIdempotency =>
      'This request is already being processed or was completed';

  @override
  String get errorInternal => 'Something unexpected happened. Please try again';

  @override
  String errorReference(String reference) {
    return 'Reference: $reference';
  }

  @override
  String get errorNetwork =>
      'No internet connection. Check your network and try again';

  @override
  String get errorUnknown => 'Something went wrong. Please try again';

  @override
  String get loading => 'Loading…';

  @override
  String get loadMore => 'Load more';

  @override
  String get stateOfflineTitle => 'You are offline';

  @override
  String get stateSessionExpiredTitle => 'Your session has ended';

  @override
  String get stateNoPermissionTitle => 'You do not have access to this page';

  @override
  String get stateNotFoundTitle => 'Not found';

  @override
  String get stateErrorTitle => 'Something went wrong';

  @override
  String get marketLabel => 'Market';

  @override
  String get appTagline => 'Shop safely\nwith a real guarantee';

  @override
  String get onboardingShopTitle => 'Shop safely\nwith a real guarantee';

  @override
  String get onboardingProtectTitle => 'Your money is held\nuntil you receive';

  @override
  String get onboardingDealTitle => 'Protected Deal\nfor any purchase';

  @override
  String get startNow => 'Start now';

  @override
  String get skip => 'Skip';

  @override
  String get next => 'Next';

  @override
  String get haveAccount => 'Already have an account?';

  @override
  String get welcomeTitle => 'Welcome to EDMN Market';

  @override
  String get welcomeSubtitle =>
      'Sign in to keep shopping\nand manage your orders';

  @override
  String get phoneHint => 'Phone number or email';

  @override
  String get forgotPassword => 'Forgot your password?';

  @override
  String get or => 'or';

  @override
  String get noAccount => 'No account yet?';

  @override
  String get createAccount => 'Create a new account';

  @override
  String get registerTitle => 'Create account';

  @override
  String get fullNameHint => 'Full name';

  @override
  String get phoneOnlyHint => 'Mobile number (01xxxxxxxxx)';

  @override
  String get emailOptionalHint => 'Email';

  @override
  String get newPasswordHint => 'Password (at least 8 characters)';

  @override
  String get acceptTerms =>
      'By creating an account you accept the Terms and Privacy Policy';

  @override
  String get invalidPhone => 'Enter a valid Egyptian mobile number';

  @override
  String get passwordTooShort => 'Password must be at least 8 characters';

  @override
  String get nameTooShort => 'Enter your full name';

  @override
  String get forgotTitle => 'Reset your password';

  @override
  String get forgotBody =>
      'Enter your phone or email. If an account exists we will send a reset link.';

  @override
  String get sendResetLink => 'Send link';

  @override
  String get resetLinkSent =>
      'If the account exists, a reset link is on its way.';

  @override
  String get verifyTitle => 'Verify your account';

  @override
  String get verifyPhoneBody =>
      'We sent a 6-digit code to your phone. Enter it here.';

  @override
  String get verifyEmailBody =>
      'We sent a 6-digit code to your email. Enter it here.';

  @override
  String get codeHint => 'Code (6 digits)';

  @override
  String get resendCode => 'Resend code';

  @override
  String resendIn(int seconds) {
    return 'Resend in ${seconds}s';
  }

  @override
  String get codeSent => 'Code sent';

  @override
  String get verified => 'Verified';

  @override
  String get verifyPhone => 'Verify phone number';

  @override
  String get verifyEmail => 'Verify email';

  @override
  String get notVerified => 'Not verified';

  @override
  String get signOutConfirm => 'Sign out of this device?';

  @override
  String get continueAsGuest => 'Browse without signing in';

  @override
  String get homeTagline => 'Fast, safe delivery';

  @override
  String get shopSafeBadge => 'Shop safely,\nreal guarantee';

  @override
  String get searchProductsHint => 'Search products, stores or brands';

  @override
  String get searchCategoryHint => 'Search a category or product';

  @override
  String get featuredProducts => 'Featured products';

  @override
  String get latestProducts => 'Latest products';

  @override
  String get seeAll => 'See all';

  @override
  String get add => 'Add';

  @override
  String get addToCart => 'Add to cart';

  @override
  String get addedToCart => 'Added to cart';

  @override
  String get protectedDealBannerTitle => 'Protected Deal';

  @override
  String get protectedDealBannerBody => 'Shop safely with a real guarantee';

  @override
  String get shopNow => 'Shop now';

  @override
  String get selectGovernorate => 'Choose governorate';

  @override
  String get deliverTo => 'Deliver to';

  @override
  String get productTitle => 'Product';

  @override
  String brandLabel(Object name) {
    return 'Brand: $name';
  }

  @override
  String soldBy(Object name) {
    return 'Sold by: $name';
  }

  @override
  String get verifiedSeller => 'Verified seller';

  @override
  String get available => 'In stock';

  @override
  String get unavailable => 'Out of stock';

  @override
  String get productDescription => 'Description';

  @override
  String get specifications => 'Specifications';

  @override
  String get conditionNew => 'New';

  @override
  String get conditionUsed => 'Used';

  @override
  String get conditionNotes => 'Condition notes';

  @override
  String get defects => 'Defects';

  @override
  String get includedAccessories => 'Included accessories';

  @override
  String get warranty => 'Warranty';

  @override
  String get returnPolicy => 'Return policy';

  @override
  String processingDays(int days) {
    return 'Ships within $days days';
  }

  @override
  String get reviews => 'Reviews';

  @override
  String get noReviews => 'No reviews yet';

  @override
  String get chooseVariant => 'Choose an option';

  @override
  String get share => 'Share';

  @override
  String get sortBy => 'Sort';

  @override
  String get sortNewest => 'Newest';

  @override
  String get sortPriceAsc => 'Price: low to high';

  @override
  String get sortPriceDesc => 'Price: high to low';

  @override
  String get sortRating => 'Top rated';

  @override
  String get filterCondition => 'Condition';

  @override
  String get all => 'All';

  @override
  String get noProductsTitle => 'No products here';

  @override
  String get noProductsBody => 'Try another word or category.';

  @override
  String get recentSearches => 'Recent searches';

  @override
  String get clear => 'Clear';

  @override
  String get searchTitle => 'Search';

  @override
  String get subcategories => 'Subcategories';

  @override
  String get reorder => 'Reorder';

  @override
  String get myOrders => 'My orders';

  @override
  String get cartTitle => 'Cart';

  @override
  String cartCount(int count) {
    return '($count items)';
  }

  @override
  String get cartEmptyTitle => 'Your cart is empty';

  @override
  String get cartEmptyBody =>
      'Add products from the categories, then come back.';

  @override
  String get browseProducts => 'Browse products';

  @override
  String get subtotal => 'Subtotal';

  @override
  String get shippingFee => 'Delivery fee';

  @override
  String get buyerFee => 'Service fee';

  @override
  String get discount => 'Discount';

  @override
  String get total => 'Total';

  @override
  String get checkoutCta => 'Checkout';

  @override
  String get shippingNotPriced => 'Calculated after choosing the address';

  @override
  String get noShippingToArea => 'Seller does not deliver to this governorate';

  @override
  String get issueUnavailable => 'Currently unavailable';

  @override
  String get issueInsufficientStock => 'Requested quantity unavailable';

  @override
  String issuePriceChanged(Object old) {
    return 'Price changed from $old';
  }

  @override
  String get issueSellerUnavailable => 'Seller currently unavailable';

  @override
  String get acknowledgePrices => 'Accept new prices';

  @override
  String get remove => 'Remove';

  @override
  String get removeFromCartConfirm => 'Remove this item from the cart?';

  @override
  String get signInToCheckout => 'Sign in to checkout';

  @override
  String get checkoutTitle => 'Checkout';

  @override
  String get stepAddress => 'Address';

  @override
  String get stepDelivery => 'Delivery';

  @override
  String get stepPayment => 'Payment';

  @override
  String get stepConfirm => 'Confirm';

  @override
  String get deliveryAddress => 'Delivery address';

  @override
  String get addAddress => 'Add address';

  @override
  String get paymentMethod => 'Payment method';

  @override
  String get orderSummary => 'Order summary';

  @override
  String get itemsTotal => 'Items total';

  @override
  String get placeOrder => 'Place order';

  @override
  String get continueLabel => 'Continue';

  @override
  String paymentWindow(int hours) {
    return 'Transfer within $hours hours or the order is cancelled automatically.';
  }

  @override
  String get priceChangedReview =>
      'The total changed. Review the new price before confirming.';

  @override
  String get orderPlacedTitle => 'Your order was created';

  @override
  String get orderPlacedBody =>
      'Transfer the amount and upload the receipt for review.';

  @override
  String deliveryEta(int min, int max) {
    return 'Delivery in $min–$max days';
  }

  @override
  String get noAddressesTitle => 'No saved addresses';

  @override
  String get addressesTitle => 'Delivery addresses';

  @override
  String get addressLabelHint => 'Label (Home, Work…)';

  @override
  String get recipientHint => 'Recipient name';

  @override
  String get governorate => 'Governorate';

  @override
  String get cityHint => 'City / area';

  @override
  String get districtHint => 'District (optional)';

  @override
  String get streetHint => 'Street';

  @override
  String get buildingHint => 'Building';

  @override
  String get floorHint => 'Floor';

  @override
  String get apartmentHint => 'Apartment';

  @override
  String get landmarkHint => 'Landmark (optional)';

  @override
  String get defaultAddress => 'Default address';

  @override
  String get save => 'Save';

  @override
  String get saved => 'Saved';

  @override
  String get edit => 'Edit';

  @override
  String get delete => 'Delete';

  @override
  String get deleteAddressConfirm =>
      'Delete this address? Past orders are not affected.';

  @override
  String get ordersEmptyTitle => 'No orders yet';

  @override
  String get searchOrdersHint => 'Search your orders';

  @override
  String get filterInProgress => 'In progress';

  @override
  String get filterDelivered => 'Delivered';

  @override
  String get filterCancelled => 'Cancelled';

  @override
  String get orderDetails => 'Order details';

  @override
  String get trackOrder => 'Track order';

  @override
  String get orderStatus => 'Order status';

  @override
  String get cancelOrder => 'Cancel order';

  @override
  String get cancelOrderConfirm =>
      'Cancel this order? Nothing has been paid yet.';

  @override
  String get orderCancelled => 'Order cancelled';

  @override
  String get payNow => 'Pay & upload receipt';

  @override
  String get paymentTitle => 'Payment';

  @override
  String get transferTo => 'Transfer to';

  @override
  String get amountDue => 'Amount due';

  @override
  String payBefore(Object date) {
    return 'Pay before $date';
  }

  @override
  String get testPaymentNotice =>
      'TEST payment: real money is OFF. Do not transfer real money.';

  @override
  String get uploadReceipt => 'Transfer receipt';

  @override
  String get uploadReceiptHint => 'Choose a receipt image or PDF';

  @override
  String get claimedAmountHint => 'Amount transferred (EGP)';

  @override
  String get referenceHint => 'Transaction reference (optional)';

  @override
  String get payerNameHint => 'Payer name (optional)';

  @override
  String get submitReceipt => 'Submit receipt for review';

  @override
  String get receiptSubmitted =>
      'Receipt received and under review. Payment is confirmed only after EDMN reviews it.';

  @override
  String get receiptUnderReview => 'Receipt under review';

  @override
  String receiptRejected(Object reason) {
    return 'Receipt rejected: $reason';
  }

  @override
  String get paymentConfirmed => 'Payment confirmed';

  @override
  String get paymentExpired => 'Payment window expired';

  @override
  String get submissions => 'Submitted receipts';

  @override
  String get confirmReceipt => 'Confirm receipt';

  @override
  String get confirmReceiptConfirm =>
      'Confirm you received this shipment in good condition? This starts the seller entitlement.';

  @override
  String get receiptConfirmed => 'Receipt confirmed';

  @override
  String get requestCancellation => 'Request cancellation';

  @override
  String get cancellationReasonHint => 'Reason for cancellation';

  @override
  String get cancellationRequested => 'Cancellation request sent to the seller';

  @override
  String get reportProblem => 'Report a problem';

  @override
  String get problemNotReceived => 'Not received';

  @override
  String get problemProductIssue => 'Problem with the product';

  @override
  String get problemDescriptionHint =>
      'Describe the problem (at least 10 characters)';

  @override
  String get problemReported => 'Problem reported. EDMN will follow up.';

  @override
  String sellerOrderLabel(Object store) {
    return 'Shipment from $store';
  }

  @override
  String trackingNumber(Object number) {
    return 'Tracking: $number';
  }

  @override
  String get refundStatus => 'Refund status';

  @override
  String get refundUncertain => 'Transfer being verified';

  @override
  String get disputeOpen => 'Open dispute';

  @override
  String get shippingAddress => 'Shipping address';

  @override
  String get statusPendingPayment => 'Awaiting payment';

  @override
  String get statusPaymentUnderReview => 'Payment under review';

  @override
  String get statusPaid => 'Paid';

  @override
  String get statusProcessing => 'In progress';

  @override
  String get statusCompleted => 'Completed';

  @override
  String get statusPartiallyCompleted => 'Partially completed';

  @override
  String get statusClosedUnfulfilled => 'Closed unfulfilled';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get stepOrderPlaced => 'Order placed';

  @override
  String get stepPaymentConfirmed => 'Payment confirmed';

  @override
  String get stepOrderConfirmed => 'Order confirmed';

  @override
  String get stepPreparing => 'Preparing your order';

  @override
  String get stepShipped => 'Shipped';

  @override
  String get stepOnTheWay => 'On the way';

  @override
  String get stepDelivered => 'Delivered';

  @override
  String get stepReceiptConfirmed => 'Receipt confirmed';

  @override
  String get stepCompleted => 'Order completed';

  @override
  String get accountTitle => 'My account';

  @override
  String get personalInfo => 'Personal information';

  @override
  String get paymentMethods => 'Payment methods';

  @override
  String get wallet => 'Wallet';

  @override
  String get notifications => 'Notifications';

  @override
  String get helpSupport => 'Help & support';

  @override
  String get aboutEdmn => 'About EDMN Market';

  @override
  String get security => 'Security';

  @override
  String get changePassword => 'Change password';

  @override
  String get currentPasswordHint => 'Current password';

  @override
  String get passwordChanged =>
      'Password changed; other devices were signed out';

  @override
  String get sellerCenter => 'Seller Center';

  @override
  String get protectedDeal => 'Protected Deal';

  @override
  String get legal => 'Terms & policies';

  @override
  String get signInPromptTitle => 'Sign in';

  @override
  String get signInPromptBody => 'Sign in to follow your orders and addresses.';

  @override
  String get comingFromServer => 'This service is not available in the app yet';

  @override
  String get notAvailableYetBody =>
      'This service works on the EDMN website; its app screen is being prepared.';

  @override
  String get openOnWebsite => 'Open on website';

  @override
  String get emailHint => 'Email';

  @override
  String get deliveryFailed => 'Delivery failed';

  @override
  String get paymentRejected => 'Receipt rejected';

  @override
  String get refundCompleted => 'Refunded';

  @override
  String get refundNotPaid => 'Not refunded';

  @override
  String get refundInProgress => 'Refund in progress';

  @override
  String get sendCode => 'Send code';

  @override
  String get productsCount => 'products';

  @override
  String storeReturns(int days) {
    return 'This store accepts returns within $days days';
  }

  @override
  String get storeNoVoluntaryReturns =>
      'No voluntary returns; your legal rights still apply';

  @override
  String get superseded => 'Replaced';

  @override
  String get reorderEmptyTitle => 'No completed orders yet';

  @override
  String get reorderEmptyBody =>
      'When an order completes you can order it again from here.';

  @override
  String get reorderNotice =>
      'Ordering again adds the same items to your cart at today\'s price; review before paying.';

  @override
  String get orderAgain => 'Order again';

  @override
  String reorderAdded(int count) {
    return '$count items added to cart';
  }

  @override
  String reorderPartial(int added, int failed) {
    return '$added added, $failed unavailable now';
  }

  @override
  String get paymentMethodsNote =>
      'You choose the payment method per order. EDMN never stores card details.';

  @override
  String get destBankName => 'Bank';

  @override
  String get destAccountName => 'Account name';

  @override
  String get destAccountNumber => 'Account number';

  @override
  String get destInstapayAddress => 'InstaPay address';

  @override
  String get destWalletNumber => 'Wallet number';
}
