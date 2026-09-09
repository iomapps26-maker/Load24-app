-- POD (Proof of Delivery) as a third per-trip document type, captured on the
-- Trip Details screen below the E-Way Bill and Bilty rows once a bid is
-- approved — plus the delivery person's name and contact number entered just
-- under it.
--
-- Same one-row-per-(load_id, document_type) model as 044/050: the `pod` row
-- can carry just the delivery-person fields with no file attached yet
-- (storage_path has been nullable since 050), and either trip party can set,
-- replace, or clear any of it. The file lives in the same private
-- `trip-documents` Storage bucket; routes and RLS are unchanged
-- (routes/loadBids.js does the party check, the only table policy is the
-- staff read backstop).
--
-- Re-runnable, same as migrations 044 / 050.

-- 1. Allow document_type = 'pod'. The original check (044) was an inline,
--    auto-named constraint — Postgres names it `trip_documents_document_type_check`.
alter table public.trip_documents
  drop constraint if exists trip_documents_document_type_check;
alter table public.trip_documents
  add constraint trip_documents_document_type_check
  check (document_type in ('eway_bill', 'bilty', 'pod'));

-- 2. Delivery person captured alongside the POD (kept on the same row as the
--    file so it survives independently of whether one has been uploaded).
alter table public.trip_documents
  add column if not exists delivery_person_name text;
alter table public.trip_documents
  add column if not exists delivery_person_contact text;

-- Length guards only — the exact "10-digit Indian mobile" rule for the
-- contact lives in the route (routes/loadBids.js), same split as the E-Way
-- Bill number's 12-digit rule vs. the generic char_length check on
-- document_number (050).
alter table public.trip_documents
  drop constraint if exists trip_documents_delivery_person_len;
alter table public.trip_documents
  add constraint trip_documents_delivery_person_len
  check (
    (delivery_person_name is null or char_length(delivery_person_name) <= 80)
    and (delivery_person_contact is null or char_length(delivery_person_contact) <= 20)
  );
