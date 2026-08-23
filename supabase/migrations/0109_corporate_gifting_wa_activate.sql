-- Activate the corporate_gifting funnel for WhatsApp inbound routing.
-- Was inserted inactive (0066) with no match_keywords — landing-page web leads
-- worked, but a WA chat mentioning bulk/corporate gifting or generic
-- business-growth phrasing had nowhere to go (pure-FAQ bot only).
-- Explicit instruction (2026-08-23) to wire this up; deterministic keyword
-- match lives in api/webhook.js (mirrors the existing JOB_KEYWORDS branch),
-- match_keywords here is kept in sync for the Funnels admin UI / reference.

update funnels
set active = true,
    match_keywords = 'corporate gift, corporate gifting, client gifting, employee gifting, bulk gift, gift for clients, gift for employees, customer gifting, diwali gifting, festival gifting, increase my sales, increase sales, boost sales, boost my sales, grow my business, grow my store, grow my shop, increase business, increase footfall, clothing store'
where id = 'corporate_gifting';
