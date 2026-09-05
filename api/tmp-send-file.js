// TEMPORARY one-off endpoint — sends the Mission 100 presentation PDF via
// WhatsApp to a specific number, per explicit owner request. Delete after use.
import { checkCrmSecret, KITTY_WA_CLIENT_ID } from "./_lib/config.js";
import { sendWhatsAppMedia, sendWhatsAppMediaWbiz } from "./_lib/wa.js";

export default async function handler(req, res) {
  const authFail = checkCrmSecret(req, res);
  if (authFail) return;
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
  const mediaUrl = "https://ssjbot.gemtre.in/Mission100-Presentation.pdf";
  const caption = "Mission 100 — Race to 100 Grams of Gold. Full rules, rewards & FAQs.";

  let wa = await sendWhatsAppMedia({ phone, mediaUrl, mediaType: "document", filename: "Mission100-Presentation.pdf", caption, client: KITTY_WA_CLIENT_ID });
  if (wa.status !== 1) {
    const baileysError = wa.message;
    wa = await sendWhatsAppMediaWbiz({ phone, mediaUrl, mediaType: "document", caption, whatsappClient: KITTY_WA_CLIENT_ID });
    if (wa.status !== 1) wa.baileysError = baileysError;
  }
  return res.status(200).json(wa);
}
