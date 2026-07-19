-- AutoHire migration 035 — turning auto-approve ON also clears the queue.
--
-- Previously auto-approve only affected NEW submissions. Now, when an admin
-- switches it on, every document currently awaiting review is verified too, so
-- the pending queue is cleared in one action. (Documents already rejected are
-- left as-is; only pending ones are approved.)
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create or replace function admin_set_kyc_auto_approve(p_on boolean) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update app_settings set kyc_auto_approve = p_on where id = 1;

  if p_on then
    -- Verify everything currently pending. is_admin() is true here, so the
    -- enforce_document_status trigger keeps the 'verified' status; the audit
    -- trigger logs each as an auto-approval and the sync trigger updates each
    -- owner's overall verification.
    update verification_documents
      set status = 'verified', reviewed_by = null, reviewed_at = now(), note = null
      where status = 'pending';
  end if;

  return p_on;
end $$;
