-- AutoHire migration 099 — two cars that were never real, given real models.
--
-- The listing form is gaining a rule: a CAR's model must be one that exists.
-- Machinery stays free text, because no public dataset covers excavators,
-- cranes or forklifts — but a car has no excuse, and two rows in production
-- prove the rule was needed:
--
--   car-1781873034892  make "Ferrari 2000", model "Y", category suv, 2 seats
--   car-1782242238363  make "Lamborghini",  model "Model4", category suv, 5 seats
--
-- Neither model exists. The Ferrari row was mangled twice over: the year had
-- leaked into the make, and it claimed to be an SUV while carrying two seats,
-- which no Ferrari SUV has ever had. A scan of all 858 listings found these two
-- and nothing else — `Polestar 2` and `BMW i4` look short but are real names,
-- and every other make+model checked out.
--
-- What each becomes, and why it is not a guess:
--
--   Lamborghini Model4 -> Urus. Lamborghini has built exactly one SUV, and the
--   row matches it on every attribute it does carry: 2020, SUV, five seats,
--   petrol, automatic. The data determines the answer; nothing is invented.
--
--   Ferrari 2000 / Y -> Ferrari Roma, category luxury. This one the data could
--   NOT determine — a two-seat Ferrari SUV describes no car — so it was put to
--   the owner and this is their decision, recorded here rather than inferred.
--   The category moves to `luxury` so it stops contradicting the seat count,
--   and the make loses the stray year.
--
-- Deliberately narrow: addressed by id, and each update re-asserts the wrong
-- value in its WHERE clause, so re-running does nothing and a row someone has
-- already corrected by hand is left alone rather than overwritten.
--
-- Note both rows are petrol cars, so `enforce_electric_quota_trigger` runs on
-- these updates. The fleet is at 86.7% qualifying against an 80% threshold and
-- neither update changes a fuel, so both pass — but if the threshold is ever
-- raised above the fleet's standing, this migration will refuse rather than
-- corrupt, which is the correct direction to fail in.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

update listings
   set make = 'Ferrari',
       model = 'Roma',
       category = 'luxury'
 where id = 'car-1781873034892'
   and make = 'Ferrari 2000'
   and model = 'Y';

update listings
   set model = 'Urus'
 where id = 'car-1782242238363'
   and make = 'Lamborghini'
   and model = 'Model4';
