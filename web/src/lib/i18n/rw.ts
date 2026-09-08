import type { en } from './en';

/**
 * Kinyarwanda UI strings.
 *
 * ⚠️ UNREVIEWED DRAFT — written by Claude, not by a Kinyarwanda speaker, and
 * not yet checked by one. It is here so the language switcher has something
 * real to switch to and so the shape of the work is visible; it is NOT
 * finished copy. Anything user-facing should be read by a native speaker
 * before this ships as the default for anyone.
 *
 * Where I was least sure — flagged so a reviewer knows where to spend time
 * rather than re-reading all of it:
 *   - Rental domain terms. "Reserve", "Instant book", "host", "payout" have
 *     established English usage in Rwanda's market and a literal translation
 *     may read worse than the loanword. I leaned literal; a reviewer should
 *     decide per term.
 *   - "Host" — rendered as "nyir'imodoka" (car owner). That is what they are,
 *     but it may not be what the market calls them.
 *   - Button verbs. Kinyarwanda imperatives can read blunt; several of these
 *     ("Siba", "Funga") may want softening.
 *   - Placeholders like {city} and {count} must survive translation. Word
 *     order differs from English, so they may need to move within a sentence
 *     — that is expected and fine, as long as the braces stay exactly as-is.
 *
 * Typed against `en`, so this object cannot drift: add a key there and this
 * file stops compiling until it is translated too.
 */
export const rw: Record<keyof typeof en, string> = {
  // --- Global nav / shell -------------------------------------------------
  'nav.explore': 'Shakisha',
  'nav.trips': 'Ingendo',
  'nav.ai': 'AI',
  'nav.messages': 'Ubutumwa',
  'nav.account': 'Konti',
  'nav.signIn': 'Injira',
  'nav.dashboard': 'Imbonerahamwe',
  'nav.earnings': 'Amafaranga winjije',
  'nav.becomeHost': "Ba nyir'imodoka",
  'nav.myTrips': 'Ingendo zanjye',
  'nav.listYourCar': 'Andika imodoka yawe',
  'nav.browseCars': 'Reba imodoka',
  'nav.researchWithAi': 'Shakisha ukoresheje AI',
  'nav.verification': 'Kugenzurwa',

  // --- Language / preferences --------------------------------------------
  'lang.label': 'Ururimi',
  'lang.english': 'Icyongereza',
  'lang.kinyarwanda': 'Ikinyarwanda',

  // --- Home ---------------------------------------------------------------
  'home.heroTitle': 'Shaka imodoka mu {country}',
  'home.tabCars': 'Imodoka',
  'home.tabHosts': "Ba nyir'imodoka",
  'home.tabCities': 'Imijyi',
  'home.recommended': 'Ibyo tugusabira',
  'home.electricTitle': "Imodoka z'amashanyarazi mu {country}",
  'home.electricSubtitle': 'Imodoka zitanduza, ziteguye gukodeshwa',
  'home.popularIn': 'Bikunzwe i {city}',
  'home.topRatedNearYou': 'Imodoka nziza ziri hafi yawe',
  'home.featured': 'Ibyatoranyijwe iki cyumweru',
  'home.loadError': 'Ntitwabashije kubona imodoka',
  'home.retry': 'Ongera ugerageze',
  'home.noResults': 'Nta modoka ihuye n’ibyo washatse',
  'home.ecoBannerLead': "90% ni iz'amashanyarazi n'izitanduza.",
  'home.ecoBannerRest': 'Tugana kuri 100% bitangiza ibidukikije mu 2030.',
  'home.allHostsVerified': "Ba nyir'imodoka bose baragenzuwe",

  // --- Search bar ---------------------------------------------------------
  'search.modeSearch': 'Shakisha',
  'search.modeAskAi': 'Baza AI',
  'search.where': 'Ahantu',
  'search.wherePlaceholder': 'Umujyi cyangwa ikibuga',
  'search.from': 'Kuva',
  'search.until': 'Kugeza',
  'search.addDates': 'Hitamo itariki',
  'search.dates': 'Amatariki',
  'search.addTime': 'Hitamo isaha',
  'search.submit': 'Shakisha',
  'search.currentLocation': 'Aho ndi ubu',
  'search.findingYou': 'Turagushakisha…',
  'search.anywhere': 'Ahantu hose',
  'search.anywhereSub': 'Reba imodoka zose',
  'search.searching': 'Turashakisha…',
  'search.poweredByOsm': 'Bikorwa na OpenStreetMap',
  'search.useMyLocation': 'Koresha aho ndi ubu',
  'search.aiPlaceholder': 'Sobanura imodoka ukeneye…',

  // --- Car detail / booking ----------------------------------------------
  'car.perDay': 'ku munsi',
  'car.perHour': 'ku isaha',
  'car.reserve': 'Fata gahunda',
  'car.requestToBook': 'Saba gukodesha',
  'car.instantBook': 'Fata ako kanya',
  'car.unavailable': 'Ntiboneka',
  'car.seats': 'Intebe {count}',
  'car.total': 'Igiteranyo',
  'car.dueNow': 'ugomba kwishyura ubu',
  'car.nights': 'Amajoro {count}',
  'car.night': 'Ijoro rimwe',
  'car.hostedBy': 'Itangwa na {name}',
  'car.viewDetails': 'Reba birambuye',
  'car.newListing': 'Nshya',

  // --- Account ------------------------------------------------------------
  'account.title': 'Konti',
  'account.subtitle': 'Genzura konti yawe ya AutoHire.',
  'account.profile': 'Umwirondoro',
  'account.fullName': 'Amazina yombi',
  'account.email': 'Imeyili',
  'account.phone': 'Telefone',
  'account.country': 'Igihugu',
  'account.save': 'Bika',
  'account.signOut': 'Sohoka',
  'account.yourLocation': 'Aho uherereye',
  'account.notSet': 'Ntibyashyizweho',
  'account.locationHint':
    'Bikoreshwa mu kukwereka imodoka ziri hafi yawe mbere. Bibikwa kuri iyi telefone gusa.',
  'account.useCurrentLocation': 'Koresha aho ndi ubu',
  'account.removeLocation': 'Kura aho wari wabitse',
  'account.addressPlaceholder': 'Andika aderesi cyangwa umujyi',
  'account.verificationDocs': 'Kugenzurwa n’inyandiko',
  'account.carsWatching': 'Imodoka ukurikirana',
  'account.payoutMethod': 'Uburyo bwo kwishyurwa',

  // --- Common actions -----------------------------------------------------
  'common.cancel': 'Hagarika',
  'common.done': 'Byarangiye',
  'common.clear': 'Siba',
  'common.close': 'Funga',
  'common.back': 'Subira inyuma',
  'common.next': 'Komeza',
  'common.gotIt': 'Nabyumvise',
  'common.notNow': 'Ntabwo ari ubu',
  'common.loading': 'Tegereza…',
  'common.somethingWentWrong': 'Hari ikitagenze neza',
  'common.tryAgain': 'Ongera ugerageze',

  // --- Install prompt -----------------------------------------------------
  'install.title': 'Shyira AutoHire kuri telefone yawe',
  'install.body':
    'Shyiraho AutoHire kugira ngo ufungure vuba, itangire ubwangu, kandi udakoresha mushakisha.',
  'install.iosBody':
    'Shyira AutoHire ku rupapuro rwawe rw’ibanze kugira ngo ufungure vuba kandi udakoresha mushakisha.',
  'install.iosStep1': 'Kanda buto yo gusangiza muri Safari',
  'install.iosStep2': 'Hanyuma uhitemo "Add to Home Screen"',
  'install.install': 'Shyiraho',

  // --- Translation of user content ---------------------------------------
  'translate.show': 'Hindura',
  'translate.showOriginal': 'Erekana umwimerere',
  'translate.translating': 'Birahindurwa…',
  'translate.failed': 'Ntibyashobotse guhindura',
  'translate.byGoogle': 'Byahinduwe na Google',
};
