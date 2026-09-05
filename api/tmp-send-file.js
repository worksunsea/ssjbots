// TEMPORARY one-off endpoint — sends the Mission 100 presentation PDF via
// WhatsApp to a specific number, per explicit owner request. Delete after use.
import { checkCrmSecret } from "./_lib/config.js";
import { sendWhatsAppMediaWbiz } from "./_lib/wa.js";
import { KITTY_WA_CLIENT_ID } from "./_lib/config.js";

export default async function handler(req, res) {
  const authFail = checkCrmSecret(req, res);
  if (authFail) return;
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
  const wa = await sendWhatsAppMediaWbiz({
    phone,
    mediaUrl: "https://ssjbot.gemtre.in/Mission100-Presentation.pdf",
    mediaType: "document",
    caption: "Mission 100 — Race to 100 Grams of Gold. Full rules, rewards & FAQs.",
    whatsappClient: KITTY_WA_CLIENT_ID,
  });
  return res.status(200).json(wa);
}
