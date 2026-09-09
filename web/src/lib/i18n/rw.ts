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
  'car.verifyToRent': 'Genzura kugira ngo ukodeshe',
  'car.wontBeChargedYet': 'Ntabwo warishyuzwa ubu',
  'car.depositPlusFee': "Incamake (50%) + amafaranga y'ubuyobozi",
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
  'booking.verificationInReview': 'Igenzura riracyakorwa',
  'booking.verifyToRentTitle': 'Genzura umwirondoro wawe kugira ngo ukodeshe',
  'booking.verificationInReviewBody':
    'Turi gusuzuma amakuru yawe. Uzashobora gufata gahunda umwirondoro wawe ukimara kwemerwa.',
  'booking.verificationRejectedBody':
    'Umwirondoro wawe wanzwe. Ongera wohereze inyandiko zawe kugira ngo ubashe gukodesha.',
  'booking.verificationNeededBody':
    "Kugira ngo bose babe mu mutekano, abakodesha bakora igenzura ry'umwirondoro rimwe mbere ya gahunda yabo ya mbere.",
  'booking.viewStatus': 'Reba aho bigeze',
  'booking.verifyNow': 'Genzura ubu',
  'booking.confirmAndPay': 'Emeza kandi wishyure',
  'booking.confirmAndPaySubtitle':
    'Reba imodoka n’amatariki, hanyuma wishyure. Nta kintu kigera kuri nyir\'imodoka kugeza urugendo rurangiye.',
  'booking.whenPickingUp': 'Ni ryari uzayifata?',
  'booking.lateReturnHourly': 'Gusubiza itinze urenze igihe wagenaga bizishyurwa hashingiwe ku gihe nyacyo wakoresheje.',
  'booking.lateReturnDaily': en['booking.lateReturnDaily'],
  'booking.howManyHours': 'Amasaha angahe?',
  'booking.lockedForCheckout': 'Byafunzwe kuri iyi gahunda — amafaranga wagenewe yaturutse kuri ibi.',
  'booking.payEstimatedNow': en['booking.payEstimatedNow'],
  'booking.howToPay': 'Washaka kwishyura ute?',
  'booking.choosePayOnNextStep': "Hitamo uburyo ku ntambwe ikurikira — ugumye kuri AutoHire.",
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
  'booking.verifiedPeopleTitle': 'Abantu bagenzuwe gusa',
  'booking.verifiedPeopleBody':
    "Abakodesha bose banyura mu igenzura ry'umwirondoro mbere yo gufata gahunda, kandi ba nyir'imodoka bagenzurwa nyuma ya buri rugendo.",
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
  'checkout.approvePaypalBody': "Emeza iyi gahunda kuri konti yawe ya PayPal. Uzaguma kuri uru rupapuro.",
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
  'car.verificationPending': "Umwirondoro wawe uracyasuzumwa — uzashobora gukodesha nyuma yo kwemerwa.",
  'car.verificationRejected': 'Umwirondoro wawe wanzwe. Ongera wohereze kugira ngo ubashe gukodesha.',
  'car.verificationNeeded': 'Genzura umwirondoro wawe kugira ngo ukodeshe — igenzura ryihuse rikorwa rimwe.',

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
