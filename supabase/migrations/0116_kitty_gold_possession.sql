-- Tracks whether each settled installment's gold is still sitting with the
-- store (bought on the client's behalf, not yet handed over) or has already
-- been given to the client (coin/jewellery physically delivered that month).
-- Needed because "paid" only means the rupees/grams were logged — it says
-- nothing about possession, and gram-based (gullak) schemes accrue for
-- months before any physical handover.
alter table public.kitty_installments
  add column possession text not null default 'with_company';

alter table public.kitty_installments
  add constraint kitty_installments_possession_check
  check (possession in ('with_company', 'with_client'));
