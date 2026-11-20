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

  @override
  String get sellerActive => 'Active';

  @override
  String get sellerRestricted => 'Restricted';

  @override
  String get sellerDraft => 'Application not submitted';

  @override
  String get sellerPendingReview => 'Application under review';

  @override
  String get sellerMoreInfo => 'More information required';

  @override
  String get sellerSuspended => 'Suspended';

  @override
  String get sellerRejected => 'Rejected';

  @override
  String get notSellerTitle => 'You are not a seller yet';

  @override
  String get notSellerBody =>
      'Seller registration and document review run on the EDMN website for now. Once approved you manage your store here.';

  @override
  String get sellerNotOperatingBody =>
      'You can receive orders once EDMN approves your store. Follow your application on the EDMN website.';

  @override
  String sellerRole(Object role) {
    return 'Your role: $role';
  }

  @override
  String get salesToday => 'Sales today';

  @override
  String get ordersLast30 => 'Orders (30 days)';

  @override
  String get ordersToHandle => 'Orders to handle';

  @override
  String get productsLive => 'Live products';

  @override
  String get ratingLabel => 'Rating';

  @override
  String get manageProducts => 'Manage products';

  @override
  String get sellerOrders => 'Orders';

  @override
  String get earningsBalance => 'Earnings & balance';

  @override
  String get viewMyStore => 'My public store page';

  @override
  String get sellerWebOnlyNote =>
      'Adding products, editing photos, prices, shipping rates and payout requests are on the website Seller Center for now.';

  @override
  String get soNew => 'New';

  @override
  String get soAccepted => 'Accepted';

  @override
  String get soReady => 'Ready to ship';

  @override
  String get noSellerOrders => 'No orders here';

  @override
  String get stepConfirmOrder => 'Accept order';

  @override
  String get stepStartProcessing => 'Start preparing';

  @override
  String get stepMarkReady => 'Ready to ship';

  @override
  String get stepMarkShipped => 'Mark as shipped';

  @override
  String get stepAcceptCancellation => 'Accept cancellation';

  @override
  String get sellerStepConfirm =>
      'This changes the order status; the buyer will see it.';

  @override
  String get acceptCancellationConfirm =>
      'The order will be cancelled and refunded per EDMN policy.';

  @override
  String get acceptCancellationNote =>
      'Seller accepted the cancellation in the app';

  @override
  String get commission => 'EDMN commission';

  @override
  String get sellerNet => 'Seller net';

  @override
  String get sellerNetNote =>
      'Net becomes available after delivery and protections end — not immediately.';

  @override
  String get waybillAttached => 'Waybill attached';

  @override
  String get addShipment => 'Add shipment';

  @override
  String get editShipment => 'Edit shipment';

  @override
  String get shipmentDetails => 'Shipment details';

  @override
  String get carrierHint => 'Carrier';

  @override
  String get trackingHint => 'Tracking number (optional)';

  @override
  String get waybill => 'Shipping proof (waybill)';

  @override
  String get waybillHint => 'Choose a waybill image or PDF';

  @override
  String stockLine(int onHand, int reserved, int available) {
    return 'Stock $onHand · reserved $reserved · available $available';
  }

  @override
  String get editStock => 'Edit stock';

  @override
  String get stockOnHand => 'Stock on hand';

  @override
  String reservedFloor(int reserved) {
    return 'Not below $reserved (reserved for open orders)';
  }

  @override
  String get productLive => 'Live';

  @override
  String get productDraft => 'Draft';

  @override
  String get productInReview => 'In review';

  @override
  String get productRejected => 'Rejected';

  @override
  String get productSuspended => 'Suspended';

  @override
  String get productArchived => 'Archived';

  @override
  String get withdrawable => 'Withdrawable';

  @override
  String get fundsPending => 'Pending (not yet released)';

  @override
  String get fundsAvailable => 'Available (ledger)';

  @override
  String get fundsHeld => 'Held for disputes/returns';

  @override
  String get fundsReserved => 'Reserved for an approved payout';

  @override
  String get fundsDebt => 'Booked debt';

  @override
  String get fundsUnsecured => 'Uncovered claims';

  @override
  String get fundsNote =>
      'Figures come from EDMN\'s ledger. Held amounts, debt and claims are never withdrawable.';

  @override
  String openPayouts(int count) {
    return 'You have $count payout request(s) in progress';
  }

  @override
  String get payoutOnWebNote =>
      'Payout requests are made on the website Seller Center and approved by EDMN with two-person review.';

  @override
  String get switchToSeller => 'Seller Center';

  @override
  String get roleOwner => 'Store owner';

  @override
  String get roleManager => 'Store manager';

  @override
  String get roleCatalog => 'Catalog manager';

  @override
  String get roleOrders => 'Order manager';

  @override
  String get roleFinance => 'Finance';

  @override
  String get roleSupport => 'Support';

  @override
  String get idApproved => 'Identity verified';

  @override
  String get idPending => 'Identity under review';

  @override
  String get idMoreInfo => 'More identity information needed';

  @override
  String get idRejected => 'Identity rejected';

  @override
  String get idIncomplete => 'Identity not verified yet';

  @override
  String get identityTitle => 'Identity verification';

  @override
  String get identityWhy =>
      'ID verification is required before selling and some financial operations. EDMN reviews the photos; the national ID is stored encrypted and never shown again.';

  @override
  String identityLast4(Object last4) {
    return 'Last 4 digits: $last4';
  }

  @override
  String get legalNameHint => 'Full legal name (as on the ID)';

  @override
  String get nationalIdHint => 'National ID (14 digits)';

  @override
  String get idFront => 'ID front photo';

  @override
  String get idBack => 'ID back photo';

  @override
  String get pickImage => 'Choose a photo';

  @override
  String get pickDocument => 'Choose an image or PDF';

  @override
  String get submitForReview => 'Submit for review';

  @override
  String get sentForReview => 'Sent for review';

  @override
  String get becomeSeller => 'Start selling on EDMN';

  @override
  String get becomeSellerBody =>
      'Open your store: choose seller type, verify your identity, add store details, documents and a payout account; EDMN then reviews the application.';

  @override
  String get checklist => 'Application steps';

  @override
  String get sellerTermsNote =>
      'By submitting you accept the seller agreement, commissions and EDMN policies in force.';

  @override
  String get ownerDetails => 'Owner details';

  @override
  String get businessDetails => 'Business details';

  @override
  String get storeDetails => 'Store details';

  @override
  String get payoutAccount => 'Payout account';

  @override
  String get documents => 'Documents';

  @override
  String get sellerIndividual => 'Individual';

  @override
  String get sellerBusiness => 'Company / business';

  @override
  String get startApplication => 'Start application';

  @override
  String get acceptSellerAgreement => 'I accept the seller agreement';

  @override
  String get readAgreement => 'Read the agreement';

  @override
  String get applicationIncomplete =>
      'Complete every step and verify your identity first';

  @override
  String get businessName => 'Business legal name';

  @override
  String get commercialRegistration => 'Commercial registration no.';

  @override
  String get taxRegistration => 'Tax registration no.';

  @override
  String get businessAddress => 'Business address';

  @override
  String get authorizedRepresentative => 'Authorized representative';

  @override
  String get storeName => 'Store name';

  @override
  String get storeDescription => 'Store description';

  @override
  String get returnAddress => 'Return address';

  @override
  String get supportPhone => 'Support phone (optional)';

  @override
  String get storeLogo => 'Store logo (optional)';

  @override
  String get upload => 'Upload';

  @override
  String get holderName => 'Account holder name';

  @override
  String get walletProvider => 'Wallet provider';

  @override
  String get mobileWallet => 'Mobile wallet';

  @override
  String get payoutAccountNote =>
      'EDMN verifies the account before any transfer.';

  @override
  String get addProduct => 'Add product';

  @override
  String get productNameHint => 'Product name';

  @override
  String get category => 'Category';

  @override
  String get editProduct => 'Edit product';

  @override
  String get moderationNote => 'Review note';

  @override
  String get revisionPending => 'An edit is under review';

  @override
  String get beforeSubmit => 'Before submitting';

  @override
  String get photos => 'Photos';

  @override
  String get tapToAdd => 'Tap to add';

  @override
  String get priceAndStock => 'Price & stock';

  @override
  String get setPrice => 'Set price & quantity';

  @override
  String get addVariant => 'Add variant (size / colour)';

  @override
  String productReturnCustom(int days) {
    return 'Custom: returns within $days days';
  }

  @override
  String get productReturnStoreDefault => 'Store default policy';

  @override
  String get returnPolicyNotSet => 'Return policy not set yet';

  @override
  String get hideProduct => 'Hide from store';

  @override
  String get showProduct => 'Show in store';

  @override
  String get viewAsBuyer => 'View as buyer';

  @override
  String get keyFeaturesHint => 'Key features (one per line)';

  @override
  String get variantLabelHint => 'Variant (e.g. black / 128GB)';

  @override
  String get priceEgp => 'Price (EGP)';

  @override
  String get compareAtEgp => 'Price before discount (optional)';

  @override
  String get customReturnPolicy => 'Product-specific return policy';

  @override
  String get acceptsReturns => 'Accepts voluntary returns';

  @override
  String get processingDaysHint => 'Processing days';

  @override
  String get returnDaysHint => 'Return window (days)';

  @override
  String get shippingRates => 'Shipping by governorate';

  @override
  String get checkRates => 'Check the numbers before saving';

  @override
  String get shippingRatesNote =>
      'Enable the governorates you ship to and set fee and ETA. Buyers see these in the cart.';

  @override
  String get feeEgp => 'Fee';

  @override
  String get etaMin => 'Min';

  @override
  String get etaMax => 'Max';

  @override
  String get storeSettings => 'Store settings';

  @override
  String get payoutRequests => 'Payout requests';

  @override
  String get requestPayout => 'Request payout';

  @override
  String get payoutHistory => 'History';

  @override
  String get noPayouts => 'No payout requests';

  @override
  String get payoutRequestNote =>
      'Each payout request is reviewed by two EDMN staff before any transfer. The app never moves money.';

  @override
  String get payoutUnderReview => 'Under review';

  @override
  String get payoutProcessing => 'Processing';

  @override
  String get payoutPaid => 'Paid';

  @override
  String get payoutUncertain => 'Transfer being verified';

  @override
  String get payoutRejected => 'Rejected';

  @override
  String get payoutNotTransferred => 'Not transferred';

  @override
  String get payoutUncertainNote =>
      'It is not yet confirmed whether the transfer arrived. EDMN is verifying; nothing is re-sent until confirmed.';

  @override
  String paidReference(Object ref) {
    return 'Transfer reference: $ref';
  }

  @override
  String get cancelRequest => 'Cancel request';

  @override
  String get cancelPayoutConfirm => 'Cancel this payout request?';

  @override
  String maxWithdrawable(Object amount) {
    return 'Maximum available: $amount';
  }

  @override
  String get amountEgp => 'Amount (EGP)';

  @override
  String get transferCost => 'Transfer cost';

  @override
  String get youReceive => 'You receive';

  @override
  String get reviewAmount => 'Review amount';

  @override
  String get sendRequest => 'Send request';

  @override
  String get payoutRequested => 'Payout request sent for review';

  @override
  String get payoutAlreadyRequested => 'This request is already recorded';

  @override
  String get continueApplication => 'Continue seller application';

  @override
  String get acceptChange => 'Accept change';

  @override
  String get acceptOffer => 'Accept offer';

  @override
  String get acceptOfferConfirm =>
      'Accepting makes the terms binding for both sides and moves to payment.';

  @override
  String get cancelDeal => 'Cancel deal';

  @override
  String get changeMessageHint => 'Describe the change you need';

  @override
  String get codeWarning =>
      'Only give the code when you actually receive and check the item.';

  @override
  String get copyLink => 'Copy link';

  @override
  String get dealAwaitingRelease => 'Awaiting release to seller';

  @override
  String get dealBuyerOnly =>
      'The buyer starts the deal, then invites the seller with a link.';

  @override
  String get dealBuyerPays => 'You pay';

  @override
  String get dealChangeRequested => 'Change requested';

  @override
  String get dealConfirmReceiptConfirm =>
      'Confirming means the item matches; the amount becomes due to the seller after EDMN review.';

  @override
  String get dealDeadlineHint => 'Delivery time (days)';

  @override
  String get dealDelivered => 'Shipped';

  @override
  String get dealDeliveryHint =>
      'Delivery method (courier, shipping company, in person)';

  @override
  String get dealDescriptionHint => 'Describe the item and its condition';

  @override
  String get dealDraft => 'Draft';

  @override
  String get dealFeesNote =>
      'EDMN calculates service fees and shipping; you see them before paying.';

  @override
  String get dealFundsHeld => 'Funds held by EDMN';

  @override
  String get dealHubBody =>
      'Pay anyone outside the store safely. EDMN holds the money until you receive.';

  @override
  String get dealInspection => 'Inspection period';

  @override
  String get dealInspectionHint => 'Inspection days after delivery';

  @override
  String get dealInvited => 'Seller invited';

  @override
  String get dealLinkHint => 'Listing link (optional)';

  @override
  String get dealLocationPrivacy =>
      'Your address is shown to the seller only after payment.';

  @override
  String get dealMoneyNote =>
      'Amounts are calculated by EDMN and change only with both parties’ approval.';

  @override
  String get dealNoReleaseNote =>
      'Release or refund is done by the EDMN team after review, not from the app.';

  @override
  String get dealOfferPending => 'Offer awaiting reply';

  @override
  String get dealOnHold => 'This deal is on hold for review.';

  @override
  String get dealRoleBuyer => 'You are the buyer';

  @override
  String get dealRoleSeller => 'You are the seller';

  @override
  String get dealSaved => 'Deal saved';

  @override
  String get dealSavedBody =>
      'Review the details, then send the invitation link to the seller.';

  @override
  String get dealSellerJoined => 'Seller joined';

  @override
  String get dealSellerNameHint => 'Seller name';

  @override
  String get dealSellerPhoneHint => 'Seller mobile number';

  @override
  String get dealSellerReceives => 'You receive';

  @override
  String get dealStepDeliver => 'Delivery';

  @override
  String get dealStepDelivery => 'Delivery';

  @override
  String get dealStepHold => 'Funds held';

  @override
  String get dealStepItem => 'Item';

  @override
  String get dealStepLocation => 'Address';

  @override
  String get dealStepPrice => 'Price';

  @override
  String get dealStepRelease => 'Release';

  @override
  String get dealTermsAccept => 'I agree to the Protected Deal terms.';

  @override
  String get dealTermsHint => 'Extra terms (optional)';

  @override
  String get dealTermsHistory => 'Terms history';

  @override
  String get dealTimeline => 'Deal timeline';

  @override
  String get dealTitleHint => 'Item name';

  @override
  String get dealTlAgreed => 'Both agreed';

  @override
  String get dealTlConfirmed => 'Receipt confirmed';

  @override
  String get dealTlCreated => 'Deal created';

  @override
  String get dealTlHandover => 'Handover verified';

  @override
  String get dealTlHeld => 'Funds held';

  @override
  String get dealTlInvited => 'Seller invited';

  @override
  String get dealTlPaid => 'Payment review';

  @override
  String get dealTlReleased => 'Funds released';

  @override
  String get dealTlShipped => 'Shipped';

  @override
  String get dealUnitPriceHint => 'Unit price (EGP)';

  @override
  String get dealsActive => 'Active';

  @override
  String get dealsClosed => 'Closed';

  @override
  String get declineDeal => 'Decline deal';

  @override
  String get deliveryCode => 'Delivery code';

  @override
  String get enterDeliveryCode => 'Enter delivery code';

  @override
  String get haveInvitation => 'I have an invitation';

  @override
  String get howDealWorks => 'How does it work?';

  @override
  String get howDealWorksBody =>
      '1. The buyer creates the deal and invites the seller.\n2. The seller sends an offer and the buyer accepts.\n3. The buyer pays; EDMN reviews the receipt and holds the funds.\n4. The seller ships; the buyer gives the delivery code.\n5. After inspection and confirmation, EDMN releases the funds.';

  @override
  String get inviteLinkHint => 'Paste the invitation link';

  @override
  String get inviteLinkReady =>
      'Invitation link ready — send it to the seller only';

  @override
  String get inviteSeller => 'Invite seller';

  @override
  String get joinDeal => 'Join deal';

  @override
  String get joinDealBody =>
      'If you are the seller, paste the link the buyer sent you.';

  @override
  String get makeOffer => 'Make an offer';

  @override
  String get markShippedDeal => 'Mark as shipped';

  @override
  String get newDeal => 'New deal';

  @override
  String get newDeliveryCode => 'Send a new code';

  @override
  String get newInviteLink => 'New invitation link';

  @override
  String get noActiveCode => 'No active delivery code right now.';

  @override
  String get noDeals => 'No deals';

  @override
  String get offerSent => 'Offer sent';

  @override
  String get quantityHint => 'Quantity';

  @override
  String get rejectChange => 'Reject change';

  @override
  String get rejectOffer => 'Reject offer';

  @override
  String get rejectOfferConfirm => 'Rejecting ends negotiation on this deal.';

  @override
  String get requestChange => 'Request a change';

  @override
  String get reviewDeal => 'Review deal';

  @override
  String get revokeInvite => 'Revoke invitation';

  @override
  String get sendOffer => 'Send offer';

  @override
  String get shipNoteHint => 'Shipping details (company, waybill)';

  @override
  String get showDeliveryCode => 'Show delivery code';

  @override
  String codeExpires(String time, int attempts) {
    return 'Valid until $time · $attempts attempts left';
  }

  @override
  String get dealMoneyOffer =>
      'The current offer’s amounts are calculated by EDMN and become final once both parties agree.';

  @override
  String get dealMoneyIndicative =>
      'Estimated until the seller makes an offer; final fees are calculated on agreement.';

  @override
  String get dealAwaitingBuyer => 'Awaiting buyer';

  @override
  String get dealAwaitingSeller => 'Awaiting seller';

  @override
  String get dealPartySeller => 'Seller';

  @override
  String get dealPartyBuyer => 'Buyer';

  @override
  String get termsProposed => 'Proposed';

  @override
  String get termsAccepted => 'Accepted';

  @override
  String get termsRejected => 'Rejected';

  @override
  String get termsSuperseded => 'Superseded';

  @override
  String get attachFile => 'Attach a file';

  @override
  String get attachmentHint => 'Image or PDF (optional)';

  @override
  String get conversationReadOnly => 'This conversation is read-only now.';

  @override
  String get dealConversation => 'Deal conversation';

  @override
  String get edmnTeam => 'EDMN team';

  @override
  String get filterAll => 'All';

  @override
  String get filterDeals => 'Deals';

  @override
  String get filterOrders => 'Orders';

  @override
  String get filterUnread => 'Unread';

  @override
  String get helpWithDeal => 'Get help with this deal';

  @override
  String get helpWithOrder => 'Get help with this order';

  @override
  String get imageAttachment => 'Attached image';

  @override
  String get messageBuyer => 'Message the buyer';

  @override
  String get messageHidden => 'This message was hidden by the EDMN team';

  @override
  String get messageNotSentRetry =>
      'Message not sent. Tap send again; it will not be duplicated.';

  @override
  String get messageSeller => 'Message the seller';

  @override
  String get messages => 'Messages';

  @override
  String get messagesEvidenceNote =>
      'Messages are for talking only: confirming receipt or changing a price is done with the order or deal buttons. Never send payment details or passwords.';

  @override
  String get myTickets => 'My tickets';

  @override
  String get newTicket => 'New ticket';

  @override
  String get noConversations => 'No conversations';

  @override
  String get noConversationsBody =>
      'A conversation opens from an order once payment is confirmed, or from a deal once the seller joins.';

  @override
  String get noTickets => 'No tickets yet';

  @override
  String get pdfAttachment => 'PDF attachment';

  @override
  String get rateService => 'Rate the service';

  @override
  String get ratingCommentHint => 'Comment (optional)';

  @override
  String get reopenReasonHint => 'Why do you want to reopen the ticket?';

  @override
  String get reopenTicket => 'Reopen ticket';

  @override
  String get replyReopensTicket => 'Your reply will reopen the ticket.';

  @override
  String get reportDataRequest => 'Asking for unneeded data';

  @override
  String get reportFraud => 'Fraud attempt';

  @override
  String get reportInappropriate => 'Inappropriate content';

  @override
  String get reportMessage => 'Report message';

  @override
  String get reportMessageBody =>
      'The report goes to the EDMN team for review. Nobody is penalised automatically.';

  @override
  String get reportNoteHint => 'More details (optional)';

  @override
  String get reportOther => 'Other';

  @override
  String get reportSent => 'Report sent';

  @override
  String get seenByOther => 'Seen';

  @override
  String get send => 'Send';

  @override
  String get sendReport => 'Send report';

  @override
  String get sendTicket => 'Send ticket';

  @override
  String get sent => 'Sent';

  @override
  String get startConversation => 'Start the conversation';

  @override
  String get storeMessages => 'Store messages';

  @override
  String get supportIntro =>
      'The EDMN team can help with orders, payments, deals and your account.';

  @override
  String get thanksForRating => 'Thanks for your rating';

  @override
  String get ticketAboutThis =>
      'The ticket will be linked to the order or deal you opened it from.';

  @override
  String get ticketBody => 'Describe the problem in detail';

  @override
  String get ticketBodyShort =>
      'Describe your request in at least 10 characters';

  @override
  String get ticketClosed => 'Closed';

  @override
  String get ticketEscalated => 'Escalated';

  @override
  String get ticketInProgress => 'In progress';

  @override
  String get ticketOpen => 'Open';

  @override
  String get ticketPrivacyNote =>
      'Never write your password or card number. EDMN will never ask for them.';

  @override
  String get ticketResolved => 'Resolved';

  @override
  String get ticketSent => 'Ticket sent';

  @override
  String get ticketSubject => 'Subject';

  @override
  String get ticketSubjectShort =>
      'Write a clear subject (at least 5 characters)';

  @override
  String get ticketTitle => 'Support ticket';

  @override
  String get ticketType => 'Topic';

  @override
  String get ticketTypeAccount => 'Account';

  @override
  String get ticketTypeOrder => 'Order';

  @override
  String get ticketTypePayment => 'Payment';

  @override
  String get ticketTypeProduct => 'Product';

  @override
  String get ticketTypeRefund => 'Refund';

  @override
  String get ticketTypeReturn => 'Return';

  @override
  String get ticketTypeSellerFinance => 'Store earnings';

  @override
  String get ticketTypeShipping => 'Shipping';

  @override
  String get ticketTypeTechnical => 'Technical issue';

  @override
  String get ticketWaitingSeller => 'Waiting for seller';

  @override
  String get ticketWaitingYou => 'Waiting for you';

  @override
  String get typeMessage => 'Type a message';

  @override
  String get writeReply => 'Write a reply';

  @override
  String get you => 'You';

  @override
  String maxAttachments(int count) {
    return 'You can attach up to $count files';
  }

  @override
  String get faq => 'FAQ';

  @override
  String get returnsPolicy => 'Returns policy';

  @override
  String get protectedDealTerms => 'Protected Deal terms';

  @override
  String get accountHolderMustMatch =>
      'The account holder must match your verified identity.';

  @override
  String get accountNeedsInfo => 'More info needed';

  @override
  String get accountNumberHint => 'Account number (optional with IBAN)';

  @override
  String get accountRejected => 'Rejected';

  @override
  String get accountSubmitted =>
      'Sent for review. It becomes usable once EDMN verifies it.';

  @override
  String get accountUnderReview => 'Under review';

  @override
  String get accountVerified => 'Verified';

  @override
  String get activityTestNotice =>
      'Test transaction: real money is off and nothing was transferred.';

  @override
  String get addReceivingAccount => 'Add receiving account';

  @override
  String get amountEgpHint => 'Amount in EGP';

  @override
  String get amountInvalid => 'Enter a valid amount (up to 2 decimals)';

  @override
  String get availableToWithdraw => 'Available to withdraw';

  @override
  String get balanceAvailable => 'Available';

  @override
  String get balanceAvailableHint => 'You can request it now';

  @override
  String get balanceAwaitingRelease => 'Due, awaiting release';

  @override
  String get balanceAwaitingReleaseHint =>
      'Buyer confirmed; EDMN is approving the release';

  @override
  String get balanceBreakdown => 'Balance details';

  @override
  String get balanceBySource => 'By source';

  @override
  String get balanceClaims => 'Open claims';

  @override
  String get balanceClaimsHint =>
      'Dispute/return claims not covered by funds — not money';

  @override
  String get balanceDebt => 'Debt';

  @override
  String get balanceDebtHint => 'Must be settled before any payout';

  @override
  String get balanceHeld => 'Held';

  @override
  String get balanceHeldHint => 'Due to a dispute or review — not withdrawable';

  @override
  String get balancePaidOut => 'Paid out to you';

  @override
  String get balancePending => 'Pending';

  @override
  String get balancePendingHint =>
      'Paid; still in delivery or buyer response window';

  @override
  String get balanceReserved => 'Reserved for a payout';

  @override
  String get balanceReservedHint => 'An approved payout being transferred';

  @override
  String get bankNameHint => 'Bank name';

  @override
  String get checkAmount => 'Check amount';

  @override
  String get dateLabel => 'Date';

  @override
  String get destDealsOnly => 'Protected Deal earnings only';

  @override
  String get destStoreAndDeals => 'Store account: store + deals';

  @override
  String get destinationLabel => 'Destination';

  @override
  String get edmnFees => 'EDMN fees';

  @override
  String get filterPayments => 'Payments';

  @override
  String get filterPayouts => 'Payouts';

  @override
  String get filterRefunds => 'Refunds';

  @override
  String get financialStatement => 'Statement';

  @override
  String get fundsByOrder => 'Funds by order or deal';

  @override
  String get holderNameFull => 'Account holder full name';

  @override
  String get ibanHint => 'IBAN (EG + 27 digits)';

  @override
  String get ledgerEntries => 'Entries';

  @override
  String get methodBank => 'Bank transfer';

  @override
  String get methodInstapay => 'InstaPay';

  @override
  String get methodLabel => 'Method';

  @override
  String get methodWallet => 'Mobile wallet';

  @override
  String get noActivity => 'No activity yet';

  @override
  String get noPayoutRequests => 'No payout requests';

  @override
  String get noPrepaidBalance =>
      'EDMN keeps no prepaid balance: you pay per order or deal, and refunds go back to the original payment method.';

  @override
  String get noReceivingAccounts => 'No receiving accounts';

  @override
  String get noteLabel => 'Note';

  @override
  String get openFromHistory => 'Open the transaction from the history';

  @override
  String get payoutBlockDebt =>
      'You have a debt that must be settled before any payout.';

  @override
  String get payoutBlockIdentity =>
      'Verify your identity before requesting a payout.';

  @override
  String get payoutBlockNoAccount =>
      'Add a receiving account and wait for verification first.';

  @override
  String get payoutBlockNothing =>
      'Nothing is available to withdraw right now.';

  @override
  String get payoutDestination => 'Pay out to';

  @override
  String get payoutDoesNotFit =>
      'The amount exceeds what is available for this destination.';

  @override
  String get payoutPreviewNote =>
      'Server estimate; the final split is set at approval.';

  @override
  String get payoutRequestAlreadySent => 'This request was already recorded';

  @override
  String get payoutRequestSent => 'Payout request received';

  @override
  String get payoutTestNotice =>
      'Test request: real money is off; nothing will be transferred.';

  @override
  String get receivingAccounts => 'Receiving accounts';

  @override
  String get receivingAccountsNote =>
      'Every new account is reviewed by EDMN before it can receive money.';

  @override
  String get recentActivity => 'Recent activity';

  @override
  String get referenceNumber => 'Reference';

  @override
  String get refundsTotal => 'Refunds';

  @override
  String get removeAccount => 'Remove account';

  @override
  String get removeAccountConfirm =>
      'You will not be able to use this account for new requests.';

  @override
  String get searchByReference => 'Search by order or reference number';

  @override
  String get sendPayoutRequest => 'Send payout request';

  @override
  String get sourceStore => 'Store sales';

  @override
  String get testTag => 'Test';

  @override
  String get totalSales => 'Total sales';

  @override
  String get transactionDetails => 'Transaction details';

  @override
  String get transactionHistory => 'Transaction history';

  @override
  String get transferReference => 'Transfer reference';

  @override
  String get viewAll => 'View all';

  @override
  String get walletNumberHint => 'Wallet number';

  @override
  String get walletProviderHint =>
      'Wallet provider (Vodafone Cash, Etisalat Cash…)';

  @override
  String get walletTestNotice =>
      'Test balances: real money is off; these are not real, transferable funds.';

  @override
  String activityPayment(String ref) {
    return 'Payment $ref';
  }

  @override
  String activityRefund(String ref) {
    return 'Refund $ref';
  }

  @override
  String activityPayout(String ref) {
    return 'Payout $ref';
  }

  @override
  String orderRef(String ref) {
    return 'Order $ref';
  }

  @override
  String payoutMinimum(String amount) {
    return 'Minimum $amount';
  }

  @override
  String payoutRequestResult(String number) {
    return 'Request #$number. EDMN will review and approve it; no money moves before approval.';
  }

  @override
  String payoutConfirmBody(String amount, String destination) {
    return 'You will request $amount to $destination. EDMN reviews and approves it.';
  }

  @override
  String get noEarningsYet =>
      'No earnings yet. When you sell in your store or as the seller in a Protected Deal, your earnings appear here.';

  @override
  String get acceptRefundNote =>
      'Accepting requests a refund for the returned units at the recorded price. EDMN approves and pays it.';

  @override
  String get acceptReturnRefund => 'Accept and request refund';

  @override
  String get addEvidenceFile => 'Attach evidence';

  @override
  String get againstYou => 'Opened against you';

  @override
  String get approveReturn => 'Approve return';

  @override
  String get buyerParty => 'Buyer';

  @override
  String get chooseItemToReturn => 'Choose at least one item and quantity';

  @override
  String get chooseReason => 'Choose a reason';

  @override
  String get claimedAmount => 'Amount claimed';

  @override
  String get contactSupportAboutDispute => 'Contact support about this dispute';

  @override
  String get decFullRefund => 'Full refund';

  @override
  String get decPartialRefund => 'Partial refund';

  @override
  String get decRejectClaim => 'Claim rejected';

  @override
  String get decReleaseToSeller => 'Released to the seller';

  @override
  String get decReplacement => 'Replacement';

  @override
  String get decReturnRequired => 'Return required';

  @override
  String get describeMore => 'Describe the reason in at least 10 characters';

  @override
  String get describeMore20 =>
      'Describe what happened in at least 20 characters';

  @override
  String get disputeConversation => 'Replies';

  @override
  String get disputeDescriptionHint => 'Describe what happened in detail';

  @override
  String get disputeFreezeNote =>
      'While the dispute is open, the seller’s funds for this order stay frozen until EDMN decides.';

  @override
  String get disputeFundsFrozen =>
      'The disputed amount is frozen until EDMN decides.';

  @override
  String get disputeLabel => 'Dispute';

  @override
  String get disputeOpened => 'Dispute opened';

  @override
  String get disputeReasonTitle => 'Problem';

  @override
  String get disputeTryFirst =>
      'Try messaging the seller or requesting a return first. If it is not solved, open a dispute.';

  @override
  String get drNotReceived => 'Not received';

  @override
  String get drSellerUnresponsive => 'Seller not responding';

  @override
  String get dspAwaitingInfo => 'Information needed';

  @override
  String get dspClosed => 'Closed';

  @override
  String get dspOpen => 'Open';

  @override
  String get dspResolved => 'Decided';

  @override
  String get dspUnderReview => 'Under review';

  @override
  String get edmnDecision => 'EDMN decision';

  @override
  String get escalateHint => 'Explain why EDMN should step in';

  @override
  String get escalateToEdmn => 'Escalate to EDMN (dispute)';

  @override
  String get evidenceTitle => 'Evidence';

  @override
  String get iShippedItBack => 'I shipped it back';

  @override
  String get includeShippingRefund => 'Also refund shipping';

  @override
  String get markReturnReceived => 'Item received';

  @override
  String get myDisputes => 'Disputes';

  @override
  String get myReturns => 'Returns';

  @override
  String get noDisputes => 'No disputes';

  @override
  String get noMessagesYet => 'No replies yet';

  @override
  String get noReturns => 'No returns';

  @override
  String get openDispute => 'Open a dispute';

  @override
  String get orderRefLabel => 'Order';

  @override
  String get photosRequired => 'Upload photos showing the problem';

  @override
  String get publishReview => 'Publish review';

  @override
  String get rateProducts => 'Rate the products';

  @override
  String get reasonWindowClosed => 'Return period over for this reason';

  @override
  String get refundByEdmnNote =>
      'Refunds are approved and paid by EDMN to the original payment method — not from the app.';

  @override
  String get refundRequested => 'Refund requested';

  @override
  String get rejectReasonHint => 'Reason (shown to the buyer)';

  @override
  String get rejectReturn => 'Reject return';

  @override
  String get requestReturn => 'Request a return';

  @override
  String get restockItems => 'Put units back in stock';

  @override
  String get retApproved => 'Approved';

  @override
  String get retDisputed => 'With EDMN';

  @override
  String get retInTransit => 'On its way back';

  @override
  String get retReceived => 'Received by seller';

  @override
  String get retRefundPending => 'Refund being approved';

  @override
  String get retRefunded => 'Refunded';

  @override
  String get retRejected => 'Rejected';

  @override
  String get retRequested => 'Requested';

  @override
  String get returnDescriptionHint => 'Explain the reason in detail';

  @override
  String get returnLabel => 'Return';

  @override
  String get returnNotDelivered =>
      'You can request a return after confirming delivery.';

  @override
  String get returnNothingLeft =>
      'All units are already returned or in a return.';

  @override
  String get returnReason => 'Reason';

  @override
  String get returnRefundNote =>
      'If accepted, EDMN approves the refund to your original payment method.';

  @override
  String get returnRequestSent => 'Return request sent';

  @override
  String get returnShipBuyerPays => 'Return shipping paid by the buyer';

  @override
  String get returnShipByReason =>
      'Return shipping by reason: the seller pays for faulty or wrong items';

  @override
  String get returnShipSellerPays => 'Return shipping paid by the seller';

  @override
  String get returnWindowClosed =>
      'The return period is over. If the item is faulty, you can open a dispute.';

  @override
  String get returnWindowTitle => 'Return period';

  @override
  String get returnedItems => 'Returned items';

  @override
  String get reviewAfterDelivery => 'Reviews open after delivery.';

  @override
  String get reviewBodyHint => 'Your review (optional)';

  @override
  String get reviewPublished => 'Review published';

  @override
  String get reviewTitleHint => 'Title (optional)';

  @override
  String get reviewVerifiedNote =>
      'Only verified buyers can review, once per item and per order.';

  @override
  String get reviewed => 'Reviewed';

  @override
  String get rrChangedMind => 'Changed my mind';

  @override
  String get rrCounterfeit => 'Suspected counterfeit';

  @override
  String get rrDamaged => 'Arrived damaged';

  @override
  String get rrDefective => 'Defective';

  @override
  String get rrMissingParts => 'Missing parts';

  @override
  String get rrNotAsDescribed => 'Not as described';

  @override
  String get rrOther => 'Other';

  @override
  String get rrWrongItem => 'Wrong item';

  @override
  String get sellerParty => 'Seller';

  @override
  String get sendReturnRequest => 'Send return request';

  @override
  String get shipBackTitle => 'Send the item to';

  @override
  String get startInspection => 'Start inspection';

  @override
  String get storeDecision => 'Store decision';

  @override
  String get storeDisputes => 'Store disputes';

  @override
  String get storeReturnRequests => 'Store returns';

  @override
  String get theClaim => 'The claim';

  @override
  String get viewDispute => 'View dispute';

  @override
  String get whichItems => 'What are you returning?';

  @override
  String get writeReview => 'Write a review';

  @override
  String get youOpenedIt => 'You opened it';

  @override
  String changeOfMindUntil(String date) {
    return 'Any-reason return until $date';
  }

  @override
  String protectedUntil(String date) {
    return 'Faulty or wrong items until $date';
  }

  @override
  String shippedBackWith(String carrier, String tracking) {
    return 'Shipped with $carrier — tracking $tracking';
  }

  @override
  String rateStore(String store) {
    return 'Rate the store $store';
  }

  @override
  String evidenceLabel(int max) {
    return 'Photos or documents (up to $max)';
  }

  @override
  String returnWindowBody(int days, int statutory) {
    return 'Return period: $days days from delivery (legal minimum $statutory days).';
  }

  @override
  String returnableOf(int n, int total) {
    return '$n of $total returnable';
  }

  @override
  String get disputeClaimHint => 'Amount you are claiming in EGP (optional)';

  @override
  String get previousPage => 'Previous page';

  @override
  String get downloadPdf => 'Download PDF';

  @override
  String get activityMoneyModeUnknown =>
      'The money mode for this legacy activity is unavailable. Contact support to confirm.';

  @override
  String get payoutNetAmount => 'Expected amount to receive';

  @override
  String get confirmPasswordHint => 'Confirm the new password';

  @override
  String get devicePushNote =>
      'Mobile push is not enabled in the app yet; these settings apply to in-app and email alerts, and to push once it is enabled.';

  @override
  String get haveResetLink => 'I have the reset link';

  @override
  String get markAllRead => 'Mark all as read';

  @override
  String get messageNotifications => 'Message alerts';

  @override
  String get noNotifications => 'No notifications yet';

  @override
  String get noUnreadNotifications => 'No unread notifications';

  @override
  String get notificationSettings => 'Notification settings';

  @override
  String get passwordChangedBody =>
      'You were signed out on every device. Sign in with the new password.';

  @override
  String get passwordRules =>
      'At least 8 characters, with letters and numbers.';

  @override
  String get passwordsDoNotMatch => 'The passwords do not match';

  @override
  String get pasteResetLink => 'Paste the reset link you received';

  @override
  String get prefEmail => 'Email when I am away';

  @override
  String get prefEmailHint => 'After a while if the message is still unread';

  @override
  String get prefInApp => 'In the app';

  @override
  String get prefPush => 'Push notifications';

  @override
  String get prefPushHint => 'On devices where you enabled them';

  @override
  String get prefPushPreview => 'Show message text in the notification';

  @override
  String get prefPushPreviewHint => 'Off by default for your privacy';

  @override
  String get prefSound => 'Alert sound';

  @override
  String get requestNewResetLink => 'Request a new link';

  @override
  String get resetLinkInvalid =>
      'This link is not valid. Paste the full link you received.';

  @override
  String get resetPasswordBody =>
      'Choose a new password. The link works once and expires.';

  @override
  String get resetPasswordTitle => 'Reset password';

  @override
  String get saveNewPassword => 'Save new password';

  @override
  String get securityNotificationsNote =>
      'Security, order and payment notices always reach you and cannot be turned off here.';

  @override
  String unreadCount(int n) {
    return 'Unread ($n)';
  }

  @override
  String get resetLinkExpired =>
      'This link has expired, was already used, or a newer link was requested. Request a new link.';

  @override
  String get wishlistTitle => 'Wishlist';

  @override
  String get wishlistEmpty => 'Your wishlist is empty';

  @override
  String get wishlistEmptyHint =>
      'Tap the heart on a product to save it here. Products that are not available right now are not shown.';

  @override
  String get wishlistAdd => 'Save to wishlist';

  @override
  String get wishlistRemove => 'Remove from wishlist';

  @override
  String get wishlistAdded => 'Saved to your wishlist';

  @override
  String get wishlistRemoved => 'Removed from your wishlist';

  @override
  String get pageNotFoundTitle => 'This page doesn\'t exist';

  @override
  String get pageNotFoundBody =>
      'The link is wrong or no longer available. Go back home and continue from there.';

  @override
  String get adminDashboard => 'Dashboard';

  @override
  String get adminRangeToday => 'Today';

  @override
  String get adminRange7d => '7 days';

  @override
  String get adminRange30d => '30 days';

  @override
  String get adminRange90d => '90 days';

  @override
  String get adminRange365d => 'Year';

  @override
  String get adminKpiGmv => 'Gross merchandise value (GMV)';

  @override
  String get adminKpiRevenue => 'EDMN revenue';

  @override
  String get adminKpiOrders => 'Orders (paid / all)';

  @override
  String get adminKpiDeals => 'Protected deals';

  @override
  String get adminKpiBuyers => 'Active buyers';

  @override
  String get adminKpiSellers => 'Active sellers';

  @override
  String get adminKpiReturnRate => 'Return rate';

  @override
  String get adminKpiDisputeRate => 'Dispute rate';

  @override
  String get adminQueues => 'Operational queues';

  @override
  String get adminQueueSellers => 'Seller applications to review';

  @override
  String get adminQueueProducts => 'Products to review';

  @override
  String get adminQueuePayments => 'Payments to verify';

  @override
  String get adminQueueWithdrawals => 'Withdrawals in progress';

  @override
  String get adminQueueRefunds => 'Refunds awaiting payout';

  @override
  String get adminQueueDisputes => 'Open disputes';

  @override
  String get adminQueueTickets => 'Open support tickets';

  @override
  String get adminQueueDeliveries => 'Shipments without receipt';

  @override
  String get adminTopCategories => 'Top categories';

  @override
  String get adminTopSellers => 'Top sellers';

  @override
  String get adminNoData => 'No data for this period';

  @override
  String get adminTestMoneyNotice =>
      'Every amount here comes from test payments, not real revenue.';

  @override
  String get adminReadOnlyNotice =>
      'View only: approvals and financial actions stay in the web admin console.';

  @override
  String get adminAccount => 'Account and security';

  @override
  String get adminMonitoring => 'Monitoring';

  @override
  String get adminSellerApplications => 'Seller applications';

  @override
  String get adminIdentityReviews => 'Identity checks (KYC)';

  @override
  String get adminOrders => 'Orders and shipping';

  @override
  String get adminDeals => 'Protected deals';

  @override
  String get adminDisputes => 'Disputes and complaints';

  @override
  String get adminAuditLog => 'Audit log';

  @override
  String get adminTabPending => 'Under review';

  @override
  String get adminTabNeedsInfo => 'Awaiting info';

  @override
  String get adminTabWaitingCustomer => 'Waiting on customer';

  @override
  String get adminTabApproved => 'Verified';

  @override
  String get adminTabRejected => 'Rejected';

  @override
  String get adminTabAllOrders => 'All orders';

  @override
  String get adminTabFollowUp => 'Shipped, no receipt';

  @override
  String get adminTabActive => 'In progress';

  @override
  String get adminTabDisputed => 'Disputed';

  @override
  String get adminTabDone => 'Finished';

  @override
  String get adminTabOpen => 'Open';

  @override
  String get adminTabMine => 'Assigned to me';

  @override
  String get adminTabClosed => 'Closed';

  @override
  String get adminEmptyList => 'Nothing here right now';

  @override
  String get adminLoadMore => 'Load more';

  @override
  String get adminDocsComplete => 'Documents complete';

  @override
  String get adminDocsMissing => 'Documents missing';

  @override
  String get adminSellerUnconfirmed => 'Seller has not joined yet';

  @override
  String get adminKindDeal => 'Protected deal';

  @override
  String get adminKindReturn => 'Return';

  @override
  String get adminKindOrder => 'Order';

  @override
  String get adminAssignedToMe => 'Assigned to you';

  @override
  String get adminSearchOrders => 'Order number or customer name';

  @override
  String get adminDecisionsOnWeb =>
      'View only. Decisions (approve/reject, resolve a dispute, release funds) are made in the web admin console; names are shortened to protect personal data.';

  @override
  String get adminStatusPendingReview => 'Under review';

  @override
  String get adminStatusMoreInfo => 'Info requested';

  @override
  String get adminStatusApproved => 'Approved';

  @override
  String get adminStatusRejected => 'Rejected';

  @override
  String get adminStatusReverify => 'Re-verify';

  @override
  String get adminStatusOpen => 'Open';

  @override
  String get adminStatusUnderReview => 'Under review';

  @override
  String get adminStatusAwaitingInfo => 'Awaiting info';

  @override
  String get adminStatusResolved => 'Resolved';

  @override
  String get adminStatusClosed => 'Closed';

  @override
  String get adminStatusActive => 'Active';

  @override
  String get adminStatusDisputed => 'Disputed';

  @override
  String get adminStatusRefunded => 'Refunded';

  @override
  String get adminStatusShipped => 'On the way';

  @override
  String get adminSectionSummary => 'Summary';

  @override
  String get adminSectionTimeline => 'Status history';

  @override
  String get adminSectionChecklist => 'Requirements';

  @override
  String get adminSectionDocuments => 'Documents (metadata only)';

  @override
  String get adminSectionReviewTrail => 'Review trail';

  @override
  String get adminSectionItems => 'Items';

  @override
  String get adminSectionShipment => 'Shipment';

  @override
  String get adminSectionTracking => 'Tracking';

  @override
  String get adminSectionMessages => 'Messages and notes';

  @override
  String get adminSectionEvidence => 'Evidence (metadata only)';

  @override
  String get adminSectionDisputes => 'Linked disputes';

  @override
  String get adminFieldStatus => 'Status';

  @override
  String get adminFieldType => 'Type';

  @override
  String get adminFieldRisk => 'Risk';

  @override
  String get adminFieldGovernorate => 'Governorate';

  @override
  String get adminFieldStore => 'Store';

  @override
  String get adminFieldSubmitted => 'Submitted';

  @override
  String get adminFieldReviewed => 'Reviewed';

  @override
  String get adminFieldReviewer => 'Reviewer';

  @override
  String get adminFieldReason => 'Reason';

  @override
  String get adminFieldCustomer => 'Customer';

  @override
  String get adminFieldPlaced => 'Placed';

  @override
  String get adminFieldPaid => 'Paid';

  @override
  String get adminFieldMerchandise => 'Items';

  @override
  String get adminFieldShipping => 'Shipping';

  @override
  String get adminFieldGrand => 'Total';

  @override
  String get adminFieldPayment => 'Payment';

  @override
  String get adminFieldCarrier => 'Carrier';

  @override
  String get adminFieldTracking => 'Tracking number';

  @override
  String get adminFieldExpected => 'Expected';

  @override
  String get adminFieldBuyer => 'Buyer';

  @override
  String get adminFieldSeller => 'Seller';

  @override
  String get adminFieldBuyerPays => 'Buyer pays';

  @override
  String get adminFieldSellerGets => 'Seller receives';

  @override
  String get adminFieldDealTotal => 'Deal value';

  @override
  String get adminFieldHold => 'Financial hold';

  @override
  String get adminFieldEvidence => 'Evidence photos';

  @override
  String get adminFieldClaimant => 'Claimant';

  @override
  String get adminFieldRespondent => 'Respondent';

  @override
  String get adminFieldAssignee => 'Assignee';

  @override
  String get adminFieldClaimed => 'Amount claimed';

  @override
  String get adminFieldSubject => 'About';

  @override
  String get adminFieldReasonCode => 'Reason';

  @override
  String get adminYes => 'Yes';

  @override
  String get adminNo => 'No';

  @override
  String get adminUnassigned => 'Unassigned';

  @override
  String get adminInternalNote => 'Internal note';

  @override
  String get adminAssign => 'Assign';

  @override
  String get adminAssignTo => 'Assign dispute to';

  @override
  String get adminAddNote => 'Add internal note';

  @override
  String get adminNoteHint =>
      'Visible to the EDMN team only; never sent to the parties';

  @override
  String get adminSave => 'Save';

  @override
  String get adminCancel => 'Cancel';

  @override
  String get adminAssigned => 'Dispute assigned';

  @override
  String get adminNoteAdded => 'Note added';

  @override
  String get adminMe => 'Me';

  @override
  String get adminDocsNoPermission =>
      'Viewing documents needs the documents permission';

  @override
  String get adminSearch => 'Search';

  @override
  String get adminActorAll => 'All';

  @override
  String get adminFilterAction => 'Action name (e.g. dispute)';

  @override
  String get adminNoTimeline => 'No events yet';
}
