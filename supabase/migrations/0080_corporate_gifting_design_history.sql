-- Design generation batches were being overwritten each time (the `images`
-- column held only the most recent batch), so once staff approved extra
-- batches for a customer there was no way to compare an older generation
-- against a newer one. image_batches keeps every batch ever generated;
-- selected_batch_number pairs with the existing selected_index so a
-- confirmed selection can point at any batch, not just the latest.

alter table corporate_gifting_designs
  add column if not exists image_batches jsonb not null default '[]',
  add column if not exists selected_batch_number int;
