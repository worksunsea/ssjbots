-- price_diff: a staff-editable adjustment so our formula-based price
-- (weight*rate + making_charge) x (1+tax%) + price_diff lands exactly on
-- MMTC/shaguncoins' own price today. Computed once from today's live
-- rates vs the reference_price snapshot; editable anytime after.
alter table corporate_gifting_products add column if not exists price_diff numeric not null default 0;
