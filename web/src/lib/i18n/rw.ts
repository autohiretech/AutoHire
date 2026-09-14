import { en } from './en';

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
 *
 * Convention for a string too risky to guess at (mainly: money disclosures on
 * a payment screen, where a confidently wrong translation is worse than none):
 * write `en['the.key']` as the value instead of a Kinyarwanda draft. That is
 * deliberate and different from a forgotten translation — it renders in
 * English via the fallback (`t()` already falls back to `en` for a missing
 * key, so this just makes "still pending" explicit and greppable) and cannot
 * silently drift if the English wording changes later. `grep -c "en\['" rw.ts`
 * finds the whole worklist for whoever does the native review of money copy.
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
  'nav.becomeHost': 'Kodesha imodoka yawe',
  'nav.myTrips': 'Ingendo zanjye',
  'nav.listYourCar': 'Andika imodoka yawe',
  'nav.browseCars': 'Reba imodoka',
  'nav.researchWithAi': 'Shakisha ukoresheje AI',
  'nav.verification': 'Kugenzurwa',
  'nav.signUp': 'Iyandikishe',
  'nav.signOut': 'Sohoka',
  'nav.adminPanel': 'Admin panel', // TODO translate
  'nav.watching': 'Izo ukurikirana',
  'nav.watchingAria': 'Imodoka ukurikirana',
  'nav.feed': 'Amakuru',
  'nav.circles': 'Circles', // TODO translate
  'nav.circlesAria': 'Circles zawe', // TODO translate

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
  'home.ecoBadge': "90% z'amashanyarazi n'izitanduza",
  // "otomatike" is the everyday loanword for an automatic gearbox; "SUV" and
  // "150k" are read as-is.
  'home.searchAiPlaceholder': 'Ikindi? SUV, munsi ya 150k, otomatike…',
  'home.chipAll': 'Byose',
  'home.groupCars': 'Imodoka',
  'home.groupMachines': 'Imashini',
  'home.filterPlaceholder': 'Shakisha imodoka ku izina, ubwoko cyangwa umujyi',
  'home.matching': 'Imodoka zihuye na “{query}”',
  // TODO translate — "top ranked" has no settled Kinyarwanda phrasing I am
  // sure of ("iza mbere"? "nziza kurusha izindi"?); left in English rather
  // than guessed, per the convention at the top of this file.
  'home.topRankedTitle': en['home.topRankedTitle'],
  'home.chipElectric': 'Amashanyarazi',
  'home.chipTopRanked': en['home.chipTopRanked'], // TODO translate (see above)
  'home.loadingCars': 'Imodoka zirapakira',
  'home.showingCount': 'Imodoka {shown} muri {total}',
  'home.loadErrorBody': 'Ntitwabashije kubona imodoka ubu. Ongera ugerageze.',
  'home.noResultsBody': 'Nta modoka ihuye n’ibyo washatse.',
  'home.clearFilters': 'Siba ibyo wahisemo',
  'home.featuredBadge': 'Byatoranyijwe',
  'home.previousCar': 'Imodoka ibanziriza',
  'home.nextCar': 'Imodoka ikurikira',
  'home.showCar': 'Erekana {title}',
  'home.goToSlide': en['home.goToSlide'], // TODO translate — no natural word for "slide"

  // --- Location strip (under the header, every browse page) --------------
  'location.nearYou': 'Reba imodoka ziri hafi yawe',
  'location.useMyLocation': 'Koresha aho ndi',
  'location.detecting': 'Turagushakisha…',
  // Names a currency — money-adjacent, so English pending native review
  // rather than a guess (same rule as the payhold.* disclosures below).
  'location.showingNear': en['location.showingNear'], // TODO translate
  'location.notOperating': 'Ntiturakorera muri {place} — hitamo igihugu kugira ngo urebe imodoka.',
  'location.yourArea': 'aho uri',
  'location.detectFailed': 'Ntitwabashije kumenya aho uri — hitamo igihugu cyawe.',
  'location.denied': 'Nta kibazo — hitamo igihugu cyawe hejuru iburyo igihe cyose.',

  // --- Catalogue enums ----------------------------------------------------
  // TODO translate — vehicle body types are known in Rwanda by their English
  // (or French) trade names, and the Kinyarwanda coinages I could offer
  // ("pikipiki" is a motorcycle, not a pickup) would mislead a renter about
  // which car they are booking. Every one of these is deliberately English
  // until a native speaker decides, per term, whether a loanword or a
  // translation is what the market actually says.
  'category.sedan': en['category.sedan'],
  'category.suv': en['category.suv'],
  'category.4x4': en['category.4x4'],
  'category.hatchback': en['category.hatchback'],
  'category.pickup': en['category.pickup'],
  'category.van': en['category.van'],
  'category.minibus': en['category.minibus'],
  'category.luxury': en['category.luxury'],
  'category.tractor': en['category.tractor'],
  'category.harvester': en['category.harvester'],
  'category.tiller': en['category.tiller'],
  'category.excavator': en['category.excavator'],
  'category.bulldozer': en['category.bulldozer'],
  'category.loader': en['category.loader'],
  'category.crane': en['category.crane'],
  'category.forklift': en['category.forklift'],
  'fuel.petrol': 'Esanse',
  'fuel.diesel': 'Mazutu',
  'fuel.hybrid': 'Hybrid', // TODO translate — loanword in everyday use; no Kinyarwanda term
  'fuel.electric': 'Amashanyarazi',
  'transmission.automatic': 'Otomatike',
  'transmission.manual': en['transmission.manual'], // TODO translate ("manuel"? "iy'intoki"?) — unsure

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
  'search.nearMe': 'Imodoka ziri hafi yawe mbere',
  'search.recent': 'Ibyo washakishije',
  'search.pickupTime': 'Kuyifata',
  'search.returnTime': 'Kuyigarura',
  'search.dismiss': 'Funga',
  'search.approxLocation': 'Aho uri hagereranyijwe hakurikijwe interineti yawe. Hitamo ahantu kugira ngo ubone ibisubizo nyabyo.',
  'search.locationDenied': 'Uru rubuga ntirwemerewe kumenya aho uri. Byemere ukoresheje ikimenyetso kiri aho wandika aderesi, cyangwa wandike umujyi.',
  'search.locationUnavailable': "Ntitwabashije kumenya aho uri. Andika umujyi cyangwa ikibuga cy'indege.",

  // --- Car detail / booking ----------------------------------------------
  'car.perDay': 'ku munsi',
  'car.perHour': 'ku isaha',
  'car.unitDay': 'umunsi',
  'car.unitHour': 'isaha',
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
  'car.listingNotFound': 'Iyi modoka ntiyabonetse',
  'car.backToBrowse': 'Subira ku rutonde',
  'car.topHost': "Umukoresha w'ikirenga",
  'car.share': 'Sangiza',
  'car.whatCarOffers': 'Ibi iyi modoka itanga',
  'car.whatMachineOffers': 'Ibi iyi mashini itanga',
  'car.pickupLocationTitle': 'Aho uzayikura',
  'car.meetYourHost': "Menya nyir'imodoka",
  'car.businessHost': 'Ikigo gikodesha',
  'car.businessShort': 'Ikigo',
  'car.individualHost': 'Umuntu ukodesha',
  'car.verified': 'Yagenzuwe',
  'car.reviewsStat': 'Ibitekerezo',
  'car.ratingStat': 'Amanota',
  'car.listingsStat': 'Amatangazo',
  'car.viewProfileAllCars': "Reba umwirondoro n'imodoka zose",
  'car.hostingWith': 'Ukodesha kuri {name}',
  'car.topRatedHostName': "{name} ni umukoresha w'ikirenga",
  'car.topRatedHostBody': "Agira amanota meza cyane ku bakodesha b'ubu vuba, gutanga no kwakira byoroshye.",
  'car.newHost': 'Umukoresha mushya',
  'car.monthsHosting': 'Amezi {count} akodesha',
  'car.monthHosting': 'Ukwezi kumwe akodesha',
  'car.yearsHosting': 'Imyaka {count} akodesha',
  'car.yearHosting': 'Umwaka umwe akodesha',
  'car.identityVerified': 'Umwirondoro wagenzuwe',
  'car.identityOnFile': 'Umwirondoro urahari',
  'car.carsOnAutoHire': 'Imodoka {count} kuri AutoHire',
  'car.carOnAutoHire': 'Imodoka imwe kuri AutoHire',
  'car.messageHost': "Ohereza ubutumwa nyir'imodoka",
  'car.opening': 'Birafungura…',
  'car.payThroughPlatform':
    "Kugira ngo turinde ubwishyu bwawe, ohereza ubutumwa kandi wishyure hakoreshejwe AutoHire gusa — ntukore ibi hanze y'urubuga.",
  'car.noReviewsYet': 'Nta bitekerezo birahaba.',
  'car.reviewsCount': 'Ibitekerezo {count}',
  'car.reviewCount': 'Igitekerezo kimwe',
  'car.tripsCount': 'Ingendo {count}',
  'car.tripCount': 'Urugendo rumwe',
  'car.hoursInLocation': 'Amasaha {hours} i {location}',
  'car.hourInLocation': 'Isaha imwe i {location}',
  'car.nightsInLocation': 'Amajoro {count} i {location}',
  'car.nightInLocation': 'Ijoro rimwe i {location}',
  'car.dateAtTime': 'Ku {date} saa {time}',
  'car.choosePickup': 'Hitamo aho uzafata imodoka',
  'car.pickADayHint':
    "Hitamo umunsi, isaha n'igihe ukeneye — igiciro cyose kizahita kigaragara uko ubigenda uhitamo.",
  'car.inMaintenance': 'Iyi modoka iri mu bisanwa — izaboneka guhera ku {date}.',
  'car.inMaintenanceBadge': 'Iri mu bisanwa',
  'car.backOn': '· izagaruka ku {date}',
  'car.pickupTimeLabel': 'Isaha yo gufata imodoka',
  'car.hoursLabel': 'Amasaha',
  'car.fullPriceEstimated': "Igiciro cyose (cyagenwe)",
  'car.payNowHint':
    "Ubu wishyura {amount} (50% by'incamake + amafaranga y'ubuyobozi). Ibisigaye bizishyurwa hashingiwe ku gihe nyacyo wafashe kugeza wagarutse, igihe urugendo ruzaba rurangiye.",
  'car.chooseDates': 'Hitamo amatariki yawe',
  'car.addDatesHint': "Ongeraho amatariki y'urugendo kugira ngo urebe igiteranyo maze ufate gahunda.",
  'car.clearDates': 'Siba amatariki',
  'car.companyViewOnly':
    "Konti z'ibigo zikodesha gusa — urashobora kureba iyi modoka ariko ntushobora kuyifata.",
  'car.hostViewOnlyBefore': "Uri kureba nk'umukoresha — gufata gahunda birafunze. Hindukira mu ",
  'car.hostViewOnlyAfter': ' kugira ngo ubashe gufata gahunda.',
  'car.pickupField': 'Aho uzayifata',
  'car.addPickupDetails': "Ongeraho amakuru y'aho uzayifata",
  'car.pickUpField': 'Aho uyifata',
  'car.addDate': 'Ongeraho itariki',
  'car.returnField': 'Aho uyisubiza',
  'car.wontBeChargedYet': 'Ntabwo warishyuzwa ubu',
  'car.depositLabel': 'Incamake (50%)',
  'car.dueNowLabel': 'Ugomba kwishyura ubu',
  'car.serviceFeeLabel': "Amafaranga y'ubuyobozi",
  'car.totalLabel': 'Igiteranyo',
  'car.freeCancellation':
    'Ushobora guhagarika ubuntu igihe cyose mbere yo gufata imodoka — amafaranga yose azasubizwa byikoresha.',
  'car.paymentHeldSecurely':
    "Amafaranga yawe abikwa mu mutekano kandi ntabwo ahabwa nyir'imodoka keretse urugendo rwemejwe ko rwarangiye.",
  'car.notTheOne': 'Si iyo? Komeza ushakishe.',
  'car.continueBrowsing': 'Komeza kureba izindi modoka',
  'car.dueNowEstimated': 'ugomba kwishyura ubu · amasaha {hours} yagenwe ku {amount}',
  'car.totalNights': 'igiteranyo · amajoro {count}',
  'car.totalNight': 'igiteranyo · ijoro rimwe',
  'car.linkCopied': 'Ihuza ryakoporowe',
  'car.linkCopyFailed': 'Ntibyashobotse gukoporora ihuza',
  'car.viewAllPhotos': 'Reba amafoto yose {count}',
  'car.requestApproved': 'Icyifuzo cyemewe — ukodesha yamenyeshejwe.',
  'car.requestDeclined': 'Icyifuzo cyanze.',
  'car.requestUpdateFailed': 'Ntibyashobotse guhindura icyifuzo. Ongera ugerageze.',
  'car.requestsForThisCar': 'Ibyifuzo kuri iyi modoka',
  'car.noPendingRequests': 'Nta cyifuzo gitegereje ubu.',
  'car.reviewRequestsHint': 'Reba abasaba maze ugenzure umwirondoro wabo mbere yo kwemera.',
  'car.reviewAndDecide': 'Suzuma maze ufate umwanzuro',
  'car.renterFallback': 'Ukodesha',
  'car.previousPhoto': 'Ibanziriza',
  'car.nextPhoto': 'Ikurikira',

  // --- Payment methods (footer / checkout) --------------------------------
  'payment.weAccept': 'Twemera',
  'payment.bankTransfer': 'Kohereza amafaranga muri banki',
  'payment.cashOnPickup': 'Kwishyura ufata imodoka',
  'payment.cardsAccepted': 'Amakarita twemera',

  // --- Booking / "Confirm and pay" checkout page --------------------------
  'booking.companyCantRent': "Konti z'ibigo ntizishobora gukodesha",
  'booking.hostCantRent': "Konti z'abakoresha ntizishobora gukodesha",
  'booking.companyHostOnly':
    "Ibigo bikodesha gusa — urashobora kureba imodoka zose, ariko gufata gahunda birafunze kuri iyi konti.",
  'booking.hostAccountBefore': "Uri kuri konti y'umukoresha. Kugira ngo ukodeshe imodoka, garuka gukodesha uhereye ku ",
  'booking.hostAccountAfter': '.',
  'booking.backToCar': 'Garuka kuri iyi modoka',
  'booking.confirmAndPay': 'Emeza kandi wishyure',
  'booking.confirmAndPaySubtitle':
    'Reba imodoka n’amatariki, hanyuma wishyure. Nta kintu kigera kuri nyir\'imodoka kugeza urugendo rurangiye.',
  'booking.whenPickingUp': 'Ni ryari uzayifata?',
  'booking.lateReturnHourly':
    'Nusubiza itinze urenze igihe wagenaga, buri saha yiyongereye ni {amount}, ikakwakwa mu buryo bwikora. Nusubiza kare, itandukaniro rirasubizwa.',
  'booking.lateReturnDaily': en['booking.lateReturnDaily'],
  'booking.howManyHours': 'Amasaha angahe?',
  'booking.lockedForCheckout': 'Byafunzwe kuri iyi gahunda — amafaranga wagenewe yaturutse kuri ibi.',
  'booking.payEstimatedNow': en['booking.payEstimatedNow'],
  'booking.howToPay': 'Washaka kwishyura ute?',
  'booking.choosePayOnNextStep': "Hitamo uburyo ku ntambwe ikurikira — ugumye kuri AutoHire.",
  'booking.payOnline': 'Kwishyura kuri interineti',
  'booking.chooseOnlineOrCash': 'Hitamo kwishyura kuri interineti cyangwa amafaranga igihe uzabikura.',
  'booking.cashOnlyIntro': 'Uyu mukoresha yakira amafaranga igihe uzabikura — nta cyishyurwa kuri interineti.',
  'booking.datesNotAvailable': "Aya matariki ntaboneka.",
  'booking.chooseDifferentDates': 'Hitamo andi matariki',
  'booking.yourPaymentProtected': 'Ubwishyu bwawe burinzwe',
  'booking.encryptedTitle': 'Birinzwe, kandi ntibibikwa hano',
  'booking.encryptedBody':
    "Amakuru y'ikarita yawe agenda mu muyoboro urinzwe agana ku muntu utanga serivisi z'ubwishyu. AutoHire ntibika nimero y'ikarita yawe.",
  'booking.heldTitle': 'Bibikwa, ntibitangwa ako kanya',
  'booking.heldBody':
    "Dubika amafaranga yose kuva igihe ufatiye gahunda. Nyir'imodoka ahabwa amafaranga gusa nyuma yo kwemeza ko imodoka yagarutse.",
  'booking.freeCancellationTitle': 'Guhagarika ubuntu',
  'booking.freeCancellationBody': en['booking.freeCancellationBody'],
  'booking.verifiedPeopleTitle': "Abantu nyakuri, basuzumwa",
  'booking.verifiedPeopleBody':
    "Ba nyir'imodoka n'abakodesha bagira amanota n'ibitekerezo bigaragara nyuma ya buri rugendo, kandi inyandiko z'umwirondoro zishobora kugenzurwa impande zombi.",
  'booking.topRatedHostBadge': "Umukoresha w'ikirenga",
  'booking.yourTrip': 'Urugendo rwawe',
  'booking.change': 'Hindura',
  'booking.hourlyBilledOnUse': '~amasaha {hours} · bizishyurwa hashingiwe ku gihe nyacyo cyakoreshejwe',
  'booking.hourlyBilledOnUseOne': '~isaha rimwe · bizishyurwa hashingiwe ku gihe nyacyo cyakoreshejwe',
  'booking.daysFreeCancellation': 'iminsi {count} · guhagarika ubuntu kugeza ku {date}',
  'booking.dayFreeCancellation': 'umunsi umwe · guhagarika ubuntu kugeza ku {date}',
  'booking.priceDetails': "Ibisobanuro by'igiciro",
  'booking.settledAfterTrip': 'Ibisigaye bizishyurwa nyuma y’urugendo, hashingiwe ku gihe nyacyo cyakoreshejwe.',
  'booking.paymentHeldSecurelyTitle': 'Ubwishyu burinzwe mu mutekano.',
  'booking.paymentHeldSecurelyBody':
    "Ubwishyu bwawe bubikwa kuva igihe ufatiye gahunda kandi ntibuhabwa nyir'imodoka keretse mwembi mwemeje ko imodoka yagarutse — bityo amafaranga yawe arinzwe mu rugendo rwose, ntabwo ari kugeza igihe wafashe imodoka gusa.",

  // --- PayholdPayment (the Pay button + currency picker) ------------------
  'payhold.tellUsCountry': 'Tubwire aho uri wishyuriye',
  'payhold.countryDiffersBody': "Uburyo bwo kwishyura butandukanye hakurikijwe igihugu — mobile money ntiboneka ahantu hose.",
  'payhold.setYourCountry': 'Shyiraho igihugu cyawe',
  'payhold.loadingCurrencies': "Turategereza amafaranga yo kwishyuza",
  'payhold.payIn': 'Wishyura muri',
  // Money-critical currency disclosure — pending native review (see the note
  // at the top of this file). Kept in English via the dictionary reference
  // rather than guessed, since a wrong currency claim on a payment screen is
  // worse than none.
  'payhold.chargedSameCurrency': en['payhold.chargedSameCurrency'],
  'payhold.chargedConverted': en['payhold.chargedConverted'],
  'payhold.checkingOptions': 'Turasuzuma uburyo bwo kwishyura…',
  'payhold.setCountryToPay': 'Shyiraho igihugu cyawe kugira ngo wishyure',
  'payhold.pay': 'Wishyure {amount}',
  'payhold.couldNotStart': 'Ntibyashobotse gutangira ubwishyu.',
  // Money-critical: these name two prices and ask the renter to accept one of
  // them. Same reasoning as the currency disclosures above — kept in English
  // pending native review rather than guessed, since misreading which figure
  // is the new one is exactly the mistake that costs someone money.
  'payhold.priceChangedTitle': en['payhold.priceChangedTitle'],
  'payhold.priceChangedBody': en['payhold.priceChangedBody'],
  'payhold.priceChangedContinue': en['payhold.priceChangedContinue'],
  'payhold.priceChangedCancel': en['payhold.priceChangedCancel'],
  'payhold.moneyHeldUntilDone':
    "Amafaranga yawe abikwa kugeza urugendo rurangiye — nyir'imodoka ahabwa amafaranga nyuma yo kwemeza ko imodoka yagarutse.",

  // --- CheckoutModal --------------------------------------------------------
  'checkout.copyLabel': 'Koporora {label}',
  'checkout.avsStreetAddress': "Aderesi y'umuhanda",
  'checkout.avsCity': 'Umujyi',
  'checkout.avsStateProvince': 'Intara cyangwa leta',
  'checkout.avsPostalCode': 'Kode ya poste',
  'checkout.avsCountry': 'Igihugu',
  'checkout.cardFormSlow': 'Ifishi y’ikarita irimo gutwara igihe kirekire kugira ngo ipakire.',
  'checkout.paymentNotCompleted': 'Ubwo bwishyu ntibwarangiye.',
  'checkout.cardFormLoadErrorSuffix': 'Ushobora gufunga hano maze uhitemo ubundi buryo bwo kwishyura.',
  'checkout.cardFormLoadError': "Ifishi y'ikarita ntiyashoboye gupakira. Porogaramu ihagarika kwamamaza cyangwa ikibazo cy'umuyoboro birashobora kubibuza.",
  'checkout.confirming': 'Turemeza…',
  'checkout.loadingCardForm': "Ifishi y'ikarita irapakira…",
  'checkout.pay': 'Wishyure {amount}',
  'checkout.cardEnteredDirectly': "Ikarita yawe yandikwa ako kanya ku muntu utanga serivisi z'ubwishyu.",
  'checkout.paypalFailed': 'PayPal ntiyashoboye kurangiza ubwo bwishyu.',
  'checkout.oneMoreStep': 'Intambwe imwe isigaye',
  'checkout.paypalCouldNotOpen': "Ntitwashoboye gufungura PayPal hano. Iri huza remeza uru bwishyu nyine.",
  'checkout.continueWithPaypal': 'Komeza na PayPal',
  'checkout.approvePaypalBody':
    "PayPal izafungura mu idirishya rishya kugira ngo wemeze iyi gahunda. Iyi tabo izakomeza gufunguye — tuzakomeza hano nyuma yo kurangiza.",
  'checkout.loadingPaypal': 'PayPal irapakira…',
  'checkout.bankNeedsOwnPage': "Banki yawe ikeneye urupapuro rwayo kugira ngo irangize ubu bwishyu mu mutekano.",
  'checkout.continueAmount': 'Komeza · {amount}',
  'checkout.paymentFrameTitle': 'Ubwishyu',
  'checkout.waitingForPayment': 'Turategereza ko ubwishyu bwawe bwemezwa…',
  'checkout.takingAWhile': 'Birimo gufata igihe kirekire?',
  'checkout.continueOnTheirPage': "Komeza ku rupapuro rwabo",
  'checkout.couldNotStartNothingCharged': 'Ntitwashoboye gutangira ubu bwishyu. Nta kintu cyishyuwe.',
  'checkout.couldNotVerify': 'Ibyo ntibyashoboye kwemezwa.',
  'checkout.codeNotAccepted': 'Ako kode ntikemewe.',
  'checkout.paymentReceived': 'Ubwishyu bwakiriwe',
  'checkout.completeYourPayment': 'Rangiza ubwishyu bwawe',
  'checkout.howDoYouWantToPay': 'Washaka kwishyura ute?',
  'checkout.moneyHeldSafely': 'Amafaranga yawe abikwa mu mutekano',
  'checkout.settingUpTripRedirect': "Turategura urugendo rwawe — tugiye kuguhagurukira ako kanya biteguye.",
  'checkout.settingUpTripNoRedirect': "Turategura urugendo rwawe — ruzagaragara mu ngendo zanjye mu kanya gato.",
  'checkout.openingTripTakesAMinute': "Turafungura urugendo rwawe — birashobora gufata iminota mike.",
  'checkout.done': 'Byarangiye',
  'checkout.paymentDidntGoThrough': 'Ubwo bwishyu ntibwarangiye neza',
  'checkout.nothingChargedCarAvailable': 'Nta kintu cyishyuwe kandi imodoka iracyaboneka.',
  'checkout.tryAgain': 'Ongera ugerageze',
  'checkout.checkYourPhone': 'Reba kuri telefone yawe',
  'checkout.confirmingYourPayment': 'Turemeza ubwishyu bwawe',
  'checkout.updatesOnItsOwn': "Ibi bikorwa byonyine — ntufunge iyi dirishya.",
  'checkout.enterYourCode': 'Andika kode yawe',
  'checkout.verificationCode': 'Kode yo kwemeza',
  'checkout.checking': 'Turasuzuma…',
  'checkout.confirmPayment': 'Emeza ubwishyu',
  'checkout.transferFromBank': 'Ohereza uhereye kuri banki yawe',
  'checkout.transferInstructionBody': "Ohereza neza aya mafaranga kuri konti ikurikira. Abikwa kuri iyi gahunda gusa.",
  'checkout.transferBankLabel': 'Banki',
  'checkout.transferAccountLabel': 'Nimero ya konti',
  'checkout.transferAmountLabel': 'Amafaranga',
  'checkout.transferReferenceLabel': 'Inomero y’ubwishyu',
  'checkout.transferExpiresWarning': "Iyi konti irangira — rangiza kwohereza vuba, cyangwa utangire bundi bushya.",
  'checkout.confirmAsSoonAsLands': "Tuzabimenyesha ako kanya bigeze — ntufunge iyi dirishya.",
  'checkout.enterCardPin': "Andika PIN y'ikarita yawe",
  'checkout.pinLabel': 'PIN',
  'checkout.continue': 'Komeza',
  'checkout.confirmBillingAddress': 'Emeza aderesi yawe yo kwishyuza',
  'checkout.takesAFewSeconds': "Ibi bifata amasegonda make — ntufunge iyi dirishya.",
  'checkout.youllBeCharged': 'Uzishyuzwa',
  'checkout.cantChargeAgain': "{method} ntishobora kongera kwishyuzwa ako kanya, bityo ubu wishyura amafaranga yose aho kwishyura incamake.",
  'checkout.exactAmountNote': 'Amafaranga n’ifaranga nyakuri PayHold izakwishyuza.',
  'checkout.mobileMoneyNumber': 'Nimero ya mobile money',
  'checkout.mobileMoneyHint': "Uzahabwa ubutumwa kuri iyi nimero. Nta mafaranga azava muri wallet yawe utabyemeje.",
  'checkout.cardComesNext':
    "Amakuru y'ikarita yawe akurikiraho, akandikwa ako kanya ku muntu utanga serivisi z'ubwishyu — ntagera kuri AutoHire.",
  'checkout.cardNumber': "Nimero y'ikarita",
  'checkout.expiry': 'Igihe irangira',
  'checkout.cvv': 'CVV',
  'checkout.nameOnCard': 'Izina riri ku ikarita',
  'checkout.cardEncrypted': "Yoherezwa ako kanya ku muntu utanga serivisi z'ubwishyu, irinzwe. Ntitubika ayo makuru.",
  'checkout.approveOnProviderCheckout':
    "Uzemeza ibi ku rupapuro rw'ubwishyu rw'umuntu utanga serivisi — amakuru yawe ntagera kuri AutoHire.",
  'checkout.loadingPaymentOptions': 'Uburyo bwo kwishyura burapakira',
  'checkout.cantTakePaymentNow': 'Ntidushobora kwakira ubwishyu bw’uru rugendo ubu',
  'checkout.temporaryTryAgain': 'Nta kintu cyishyuwe kandi imodoka iracyaboneka. Ibi akenshi biba by’igihe gito — ongera ugerageze mu kanya.',
  'checkout.starting': 'Biratangira…',

  // --- Trips ("My trips" list) -------------------------------------------
  'trips.upcoming': 'Iziri imbere',
  'trips.ended': 'Izarangiye',
  'trips.searchByCar': 'Shakisha ukurikije imodoka',
  'trips.noTripsYet': 'Nta rugendo urakora',
  'trips.noTripsBody': 'Reba imodoka maze ufate urugendo rwawe rwa mbere.',
  'trips.exploreListings': 'Reba imodoka',
  'trips.group.upcoming': 'Iziri imbere',
  'trips.group.active': 'Izirimo gukorwa',
  'trips.group.past': 'Izarangiye n’izashize',
  'trips.noUpcomingMatch': 'Nta rugendo ruri imbere ruhuye na “{query}”.',
  'trips.noPastMatch': 'Nta rugendo rwashize ruhuye na “{query}”.',
  'trips.noUpcoming': 'Nta rugendo ruri imbere ufite.',
  'trips.noPast': 'Nta rugendo rwarangiye urafite.',

  // --- Messages -------------------------------------------------------------
  'messages.deleteAll': 'Siba byose',
  'messages.deleteAllConfirm': 'Siba ibiganiro BYOSE? Bizasibwa ku mpande zombi kandi ntibishobora gusubizwaho.',
  'messages.deleteOneConfirm': 'Siba iki kiganiro ku mpande zombi?',
  'messages.searchConversations': 'Shakisha mu biganiro',
  'messages.youPreview': 'Wowe: {body}',
  'messages.supportIntro': 'Ibibazo ku konti yawe, kugenzurwa cyangwa gahunda yo gukodesha',
  'messages.unread': 'Ntibirasomwa',
  'messages.noMatch': 'Nta kiganiro gihuye n’ibyo washatse.',
  'messages.noneYet': "Nta kiganiro na nyir'imodoka urafite.",
  'messages.selectPrompt': 'Hitamo ikiganiro kugira ngo utangire kuganira.',
  'messages.backToConversations': 'Subira ku biganiro',
  'messages.supportSubtitle': 'Tubaze ikibazo cyose ku konti yawe',
  'messages.noMessagesYet': 'Nta butumwa burahaba',
  'messages.supportEmptyBody':
    'Twandikire ku konti yawe, inyandiko zawe cyangwa gahunda yo gukodesha. Umuyobozi agusubiza hano.',
  'messages.you': 'Wowe',
  'messages.sendFailed': 'Ntibyashobotse kohereza.',
  'messages.supportPlaceholder': 'Andikira AutoHire…',
  'messages.send': 'Ohereza',
  'messages.deleteConversation': 'Siba ikiganiro',
  'messages.about': 'Ibyerekeye: {title}',
  'messages.replyingTo': 'Usubiza {name}',
  'messages.replyingToYourself': 'Usubiza ubutumwa bwawe',
  'messages.photo': '📷 Ifoto',
  'messages.attachment': '📎 Umugereka',
  'messages.cancelReply': 'Hagarika gusubiza',
  'messages.uploadFailed': 'Ntibyashobotse kohereza dosiye.',
  'messages.attachFile': 'Ongeraho dosiye',
  'messages.attachHint': 'Ongeraho ifoto cyangwa dosiye',
  'messages.uploading': 'Birimo koherezwa…',
  'messages.typeMessage': 'Andika ubutumwa…',
  'messages.messageLabel': 'Ubutumwa',
  'messages.imageAlt': 'ifoto',
  'messages.file': 'Dosiye',
  'messages.react': en['messages.react'], // TODO translate — emoji "reaction" has no settled Kinyarwanda word
  'messages.reply': 'Subiza',
  'messages.delete': 'Siba',
  'messages.userFallback': 'Umukoresha',

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
  'account.deleteFailed': 'Ntibyashobotse gusiba konti.',
  'account.payoutVerifyingTitle': 'Uburyo bwawe bwo kwishyurwa burimo kugenzurwa',
  'account.payoutMissingTitle': 'Tubwire aho twakohereza amafaranga winjije',
  'account.payoutVerifyingBody': 'Amafaranga winjije akomeza kwiyongera muri icyo gihe.',
  'account.payoutMissingBody':
    'Amafaranga winjije atangira kwiyongera kuva ku gahunda ya mbere — ongeraho uburyo bwo kwishyurwa igihe ushakiye, tuzayakohereza.',
  'account.setUpPayouts': 'Shyiraho uburyo bwo kwishyurwa',
  'account.verifyPhoneTitle': 'Emeza nimero ya telefone yawe',
  'account.verifyPhoneBody': 'Uzahabwa amakuru ku gahunda no gufata imodoka kuri SMS — reba igice cya Telefone hano hepfo.',
  'account.groupHosting': 'Gutanga imodoka',
  'account.groupSupport': 'Ubufasha',
  'account.deleteAccount': 'Siba konti',
  'account.deleteBodyPersonal':
    'Bisiba burundu uburyo winjira n’amakuru yawe yose — amatangazo, gahunda, ubutumwa, ibitekerezo, inyandiko n’imenyesha. Ibi ntibishobora gusubizwaho.',
  'account.deleteBodyCompany':
    'Bisiba burundu uburyo winjira n’amakuru yawe yose — amatangazo y’imodoka zawe zose, gahunda, ubutumwa, ibitekerezo, inyandiko n’imenyesha. Ibi ntibishobora gusubizwaho.',
  'account.deleteMyAccount': 'Siba konti yanjye',
  'account.deleteConfirmTitle': 'Gusiba konti?',
  'account.deleteTypeBefore': 'Ibi ni burundu. Andika ',
  'account.deleteTypeAfter': ' kugira ngo wemeze.',
  // "DELETE" is the token the field checks for, so it stays in English here.
  'account.typeDeleteToConfirm': 'Andika DELETE kugira ngo wemeze',
  'account.deleting': 'Birasibwa…',
  'account.permanentlyDelete': 'Siba burundu',
  'account.payoutActive': 'Birakora',
  'account.payoutVerifying': 'Birimo kugenzurwa',
  'account.nameSaveFailed': 'Ntibyashobotse kubika izina ryawe.',
  'account.pictureUploadFailed': 'Ntibyashobotse kohereza ifoto.',
  'account.switchFailed': 'Ntibyashobotse guhindura konti yawe.',
  'account.badgeCompany': 'Ikigo',
  'account.badgeCompanyHost': "Ikigo · nyir'imodoka",
  'account.badgePersonalHost': "Umuntu · nyir'imodoka",
  'account.badgePersonalRenter': 'Umuntu · ukodesha',
  'account.uploadingPhoto': 'Ifoto irimo koherezwa…',
  'account.companyName': "Izina ry'ikigo",
  'account.saving': 'Birabikwa…',
  'account.saved': 'Byabitswe',
  'account.hostingAccount': "Konti ya nyir'imodoka",
  'account.renterAccount': "Konti y'ukodesha",
  'account.hostingAccountBody':
    'Ucunga amatangazo yawe. Hindukira mu gukodesha kugira ngo ufate imodoka (amatangazo yawe abikwa).',
  'account.renterAccountBody': "Ukodesha imodoka. Ba nyir'imodoka kugira ngo utangaze imodoka yawe.",
  'account.switchToRenting': 'Hindukira mu gukodesha',
  'account.newHostDocsTitle': "Ubu uri nyir'imodoka — inyandiko ebyiri zindi zirakenewe",
  'account.newHostDocsBody':
    "Uruhushya rwo gutwara n'indangamuntu yawe biracyemewe. Gutanga imodoka bisaba n'impapuro z'imodoka, bityo kugenzurwa kwawe kugaragara nk'ukutuzuye kugeza izi zishyizwemo:",
  'account.newHostDocsNote':
    "Ushobora gutangaza imodoka mbere y'uko izi zisuzumwa — abakodesha babona gusa nyir'imodoka utaragenzurwa kugeza zisuzumwe.",
  'account.addThemNow': 'Zongereho ubu',
  'account.later': 'Nyuma',
  'account.countrySaveFailed': 'Ntibyashobotse kubika igihugu cyawe.',
  'account.searchCountries': 'Shakisha ibihugu…',
  'account.noCountriesMatch': 'Nta gihugu gihuye na “{query}”',
  'account.countryHintHost': 'Aho wishyurwa — kigena uburyo bwo kwishyurwa ushobora gukoresha.',
  'account.countryHintRenter': 'Aho wishyura uhereye — kigena uburyo bwo kwishyura ushobora gukoresha.',
  'account.currentLocationAt': 'Aho ndi ubu ({lat}, {lng})',
  'account.yourAddress': 'Aderesi yawe',
  'account.searching': 'Turashakisha…',
  'account.findingYou': 'Turagushakisha…',
  'account.phoneInvalid': 'Andika nimero ya telefone yuzuye ifite kode y’igihugu, urugero +250 788 123 456.',
  'account.codeSendFailed': 'Ntibyashobotse kohereza kode.',
  'account.codeInvalid': 'Kode si yo cyangwa yarangiye.',
  'account.phoneVerification': 'Kwemeza telefone',
  'account.verified': 'Yemejwe',
  'account.phoneVerifiedBefore': 'Nimero ya telefone yawe yemejwe. Ubutumwa bwa SMS buzajya kuri ',
  'account.phoneVerifiedAfter': '.',
  'account.verifyNumberBody': 'Emeza nimero yawe kugira ngo tubashe kukohereza amakuru ku gahunda no gufata imodoka kuri SMS.',
  'account.phoneNumber': 'Nimero ya telefone',
  'account.sending': 'Birimo koherezwa…',
  'account.sendCode': 'Ohereza kode',
  'account.enterCodeBefore': 'Andika kode y’imibare 6 twohereje kuri ',
  'account.enterCodeAfter': '.',
  'account.verificationCode': 'Kode yo kwemeza',
  'account.verifying': 'Turemeza…',
  'account.verify': 'Emeza',

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
