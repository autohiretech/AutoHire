/**
 * English UI strings — the source of truth.
 *
 * This object's shape defines the contract: every other locale is typed as
 * `Record<keyof typeof en, string>`, so a missing or misspelled key is a
 * compile error rather than a blank label discovered by a user.
 *
 * Only *UI chrome* lives here — labels, headings, buttons, the fixed words
 * the app itself says. Anything a person wrote (a host's car description, a
 * message, a review) is never in here; that is translated on demand at
 * runtime instead, because it can't be known ahead of time.
 *
 * Keys are `area.thing`, and the English text is the documentation — read a
 * key and you should be able to guess the string. Keep them sorted by area
 * so two people adding strings to different screens don't collide.
 */
export const en = {
  // --- Global nav / shell -------------------------------------------------
  'nav.explore': 'Explore',
  'nav.trips': 'Trips',
  'nav.ai': 'AI',
  'nav.messages': 'Messages',
  'nav.account': 'Account',
  'nav.signIn': 'Sign in',
  'nav.dashboard': 'Dashboard',
  'nav.earnings': 'Earnings',
  'nav.becomeHost': 'Become a host',
  'nav.myTrips': 'My trips',
  'nav.listYourCar': 'List your car',
  'nav.browseCars': 'Browse cars',
  'nav.researchWithAi': 'Research with AI',
  'nav.verification': 'Verification',

  // --- Language / preferences --------------------------------------------
  'lang.label': 'Language',
  'lang.english': 'English',
  'lang.kinyarwanda': 'Kinyarwanda',

  // --- Home ---------------------------------------------------------------
  'home.heroTitle': 'Find your next ride in {country}',
  'home.tabCars': 'Cars',
  'home.tabHosts': 'Hosts',
  'home.tabCities': 'Cities',
  'home.recommended': 'Recommended for you',
  'home.electricTitle': 'Electric cars in {country}',
  'home.electricSubtitle': 'Zero-emission rides, ready to book',
  'home.popularIn': 'Popular in {city}',
  'home.topRatedNearYou': 'Top-rated cars near you',
  'home.featured': 'Featured this week',
  'home.loadError': "Couldn't load cars",
  'home.retry': 'Retry',
  'home.noResults': 'No cars match these filters',
  'home.ecoBannerLead': '90% Electric, Hybrid & Ecological.',
  'home.ecoBannerRest': 'On the road to 100% environmentally friendly by 2030.',
  'home.allHostsVerified': 'All hosts verified',

  // --- Search bar ---------------------------------------------------------
  'search.modeSearch': 'Search',
  'search.modeAskAi': 'Ask AI',
  'search.where': 'Where',
  'search.wherePlaceholder': 'City or airport',
  'search.from': 'From',
  'search.until': 'Until',
  'search.addDates': 'Add dates',
  'search.dates': 'Dates',
  'search.addTime': 'Add time',
  'search.submit': 'Search',
  'search.currentLocation': 'Current location',
  'search.findingYou': 'Finding you…',
  'search.anywhere': 'Anywhere',
  'search.anywhereSub': 'Browse all cars',
  'search.searching': 'Searching…',
  'search.poweredByOsm': 'Powered by OpenStreetMap',
  'search.useMyLocation': 'Use my current location',
  'search.aiPlaceholder': 'Describe the car you need…',

  // --- Car detail / booking ----------------------------------------------
  'car.perDay': 'per day',
  'car.perHour': 'per hour',
  'car.reserve': 'Reserve',
  'car.requestToBook': 'Request to book',
  'car.instantBook': 'Instant book',
  'car.unavailable': 'Not available',
  'car.seats': '{count} seats',
  'car.total': 'total',
  'car.dueNow': 'due now',
  'car.nights': '{count} nights',
  'car.night': '1 night',
  'car.hostedBy': 'Hosted by {name}',
  'car.viewDetails': 'View details',
  'car.newListing': 'New listing',

  // --- Account ------------------------------------------------------------
  'account.title': 'Account',
  'account.subtitle': 'Manage your AutoHire account.',
  'account.profile': 'Profile',
  'account.fullName': 'Full name',
  'account.email': 'Email',
  'account.phone': 'Phone',
  'account.country': 'Country',
  'account.save': 'Save',
  'account.signOut': 'Sign out',
  'account.yourLocation': 'Your location',
  'account.notSet': 'Not set',
  'account.locationHint': 'Used to show cars closest to you first. Saved on this device only.',
  'account.useCurrentLocation': 'Use my current location',
  'account.removeLocation': 'Remove saved location',
  'account.addressPlaceholder': 'Type an address or city',
  'account.verificationDocs': 'Verification & documents',
  'account.carsWatching': "Cars you're watching",
  'account.payoutMethod': 'Payout method',

  // --- Common actions -----------------------------------------------------
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.clear': 'Clear',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.gotIt': 'Got it',
  'common.notNow': 'Not now',
  'common.loading': 'Loading…',
  'common.somethingWentWrong': 'Something went wrong',
  'common.tryAgain': 'Try again',

  // --- Install prompt -----------------------------------------------------
  'install.title': 'Get the AutoHire app',
  'install.body': 'Install AutoHire for one-tap access, faster loading, and no browser bar in the way.',
  'install.iosBody':
    'Add AutoHire to your Home Screen for one-tap access, faster loading, and no browser bar in the way.',
  'install.iosStep1': "Tap the Share button in Safari's toolbar",
  'install.iosStep2': 'Then choose "Add to Home Screen"',
  'install.install': 'Install',

  // --- Translation of user content ---------------------------------------
  'translate.show': 'Translate',
  'translate.showOriginal': 'Show original',
  'translate.translating': 'Translating…',
  'translate.failed': "Couldn't translate this",
  'translate.byGoogle': 'Translated by Google',
} as const;

export type TranslationKey = keyof typeof en;
