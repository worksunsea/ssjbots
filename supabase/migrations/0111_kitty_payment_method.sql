alter table public.kitty_installments
  add column if not exists payment_method text,
    -- cash | upi | bank_transfer | card | cheque | other
  add column if not exists payment_remarks text;
