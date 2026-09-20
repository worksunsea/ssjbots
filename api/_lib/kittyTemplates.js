// Editable Kitty WhatsApp message templates. Registry below is the
// built-in default for each message "context type" (what triggers it,
// when). Staff can override any of them from Kitty Admin > Messages >
// Templates (stored in kitty_message_templates, one row per context_type);
// an override falls back to this default the moment it's reset/deleted, so
// the registry always has to stay a complete, working set on its own.
//
// Templates use {{placeholder}} tokens — see `placeholders` per entry.
// Only a few send sites are wired to this registry so far (the ones this
// session touched): rate_notify, rate_cut_payment_reminder, due_reminder,
// due_today_reminder. Other Kitty messages (redemption, Mission 100,
// unclaimed, batch rollover, Swarn freeze) still send their hardcoded text
// directly — add them here + swap their call site to getKittyMessage() the
// same way when staff want those editable too.
export const KITTY_MESSAGE_TYPES = [
  {
    type: "due_reminder",
    label: "Upcoming installment reminder",
    description: `Sent up to ${3} days before an installment's due date (once per installment).`,
    placeholders: ["scheme_name", "month_number", "amount", "due_date"],
    default: `🪙 Reminder: your {{scheme_name}} installment #{{month_number}} of ₹{{amount}} is due on {{due_date}}.\n- Sun Sea Jewellers, Karol Bagh`,
  },
  {
    type: "due_today_reminder",
    label: "Due-today urgent nudge",
    description: "Sent once, same-day (10am), to anyone whose installment is due today and still unpaid.",
    placeholders: ["scheme_name", "month_number", "amount"],
    default: `🪙 {{scheme_name}} — your installment #{{month_number}} of ₹{{amount}} is due today. Payment status still shows pending — please pay today to lock in today's gold rate.\n\nAlready paid and still got this message? Please call your RM to get it updated.\nThanks!\n- Sun Sea Jewellers, Karol Bagh`,
  },
  {
    type: "rate_notify",
    label: "Rate booked (to paid members)",
    description: "Sent to everyone whose payment just got this month's rate applied, when staff book the monthly rate.",
    placeholders: ["scheme_name", "month_label", "amount", "grams", "rate"],
    default: `🪙 {{scheme_name}} — {{month_label}} rate booked: ₹{{rate}}/g\nYour ₹{{amount}} this month = {{grams}}g added.\n- Sun Sea Jewellers, Karol Bagh`,
  },
  {
    type: "rate_cut_payment_reminder",
    label: "Rate booked, unpaid nudge",
    description: "Sent to anyone who hasn't paid yet for the month, when staff book that month's rate for everyone else.",
    placeholders: ["scheme_name", "month_label", "rate"],
    default: `🪙 {{scheme_name}} — {{month_label}} rate has just been booked at ₹{{rate}}/g for members who've already paid this month.\n\nAlready paid but it's not showing? Please message or call us right away, we'll sort it out immediately.\n\nHaven't paid yet? Please complete your {{month_label}} Kitty payment today to lock in this rate — once today closes, this rate won't apply anymore, and whichever rate is live when you do pay will be used instead.\n- Sun Sea Jewellers, Karol Bagh`,
  },
];

const TYPE_MAP = new Map(KITTY_MESSAGE_TYPES.map((t) => [t.type, t]));

export function renderKittyTemplate(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ""));
}

// Returns the rendered message text for a context type — staff's saved
// override if one exists and is active, else the built-in default.
export async function getKittyMessage(sb, tenantId, contextType, vars = {}) {
  const entry = TYPE_MAP.get(contextType);
  const fallback = entry?.default || "";
  try {
    const { data } = await sb.from("kitty_message_templates").select("template, active")
      .eq("tenant_id", tenantId).eq("context_type", contextType).maybeSingle();
    const template = data?.active !== false && data?.template ? data.template : fallback;
    return renderKittyTemplate(template, vars);
  } catch {
    return renderKittyTemplate(fallback, vars);
  }
}
