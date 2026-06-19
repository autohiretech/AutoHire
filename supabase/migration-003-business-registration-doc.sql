-- AutoHire migration 003 — add the 'business_registration' verification document
-- type (uploaded by business / company hosts).
--
-- Apply to an existing DB after migrations 001 and 002. Safe to re-run.

alter type verification_doc_type add value if not exists 'business_registration';
