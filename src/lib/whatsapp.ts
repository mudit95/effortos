/**
 * WhatsApp Cloud API helper — sending messages + verification.
 *
 * Env vars required:
 *   WHATSAPP_TOKEN          – Permanent system-user token (or temporary dev token)
 *   WHATSAPP_PHONE_ID       – Phone Number ID from Meta dashboard
 *   WHATSAPP_VERIFY_TOKEN   – Arbitrary secret you choose for webhook verification
 */

const API_VERSION = 'v21.0';

function getBaseUrl(phoneId: string) {
  return `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`;
}

// WhatsApp caps text bodies at 4096 UTF-16 code units per Meta's docs.
// We leave margin so AI replies with odd Unicode (emoji + ZWJ sequences)
// can't tip over the hard limit and trigger a 400 from Meta.
const WHATSAPP_TEXT_MAX = 4000;

/**
 * Split `body` into WhatsApp-sendable chunks, preferring paragraph / line /
 * word boundaries over mid-word splits. Each chunk is <= WHATSAPP_TEXT_MAX.
 *
 * Exported so callers that want their own chunk-counting prefix can
 * chunk first and customise the boundary text.
 */
export function splitForWhatsApp(body: string, max = WHATSAPP_TEXT_MAX): string[] {
  if (body.length <= max) return [body];

  const chunks: string[] = [];
  let remaining = body;

  while (remaining.length > max) {
    // Prefer a paragraph break, then a line break, then a word break,
    // then a hard split — in that order — within the last 20% of the window.
    const window = remaining.slice(0, max);
    const floor = Math.floor(max * 0.8);
    let splitAt = -1;
    const para = window.lastIndexOf('\n\n');
    if (para >= floor) splitAt = para + 2;
    if (splitAt < 0) {
      const line = window.lastIndexOf('\n');
      if (line >= floor) splitAt = line + 1;
    }
    if (splitAt < 0) {
      const space = window.lastIndexOf(' ');
      if (space >= floor) splitAt = space + 1;
    }
    if (splitAt < 0) splitAt = max;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

/**
 * Send a plain text message to a WhatsApp user.
 *
 * Automatically chunks long bodies so we never POST a 4097+ char payload
 * (Meta returns 400 for oversized text). Long replies are prefixed with
 * (1/N) so the user knows there's more coming. Returns `true` only if
 * every chunk was accepted by Meta.
 */
export async function sendTextMessage(to: string, body: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.error('[WhatsApp] Not configured — missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID');
    return false;
  }

  const chunks = splitForWhatsApp(body);
  const url = getBaseUrl(phoneId);

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks.length > 1
      ? `(${i + 1}/${chunks.length}) ${chunks[i]}`
      : chunks[i];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { preview_url: false, body: text },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[WhatsApp] Send failed:', res.status, err, 'chunk', i + 1, 'of', chunks.length);
        return false;
      }
    } catch (err) {
      console.error('[WhatsApp] Send error on chunk', i + 1, ':', err);
      return false;
    }
  }
  return true;
}

/**
 * Send a message with quick-reply buttons (max 3 buttons).
 */
export async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return;

  const res = await fetch(getBaseUrl(phoneId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('WhatsApp button send failed:', res.status, err);
  }
}

/**
 * Parse the incoming webhook payload and extract the first user message.
 * Returns null if the payload isn't a user message (e.g. status update).
 */
export function extractIncomingMessage(body: Record<string, unknown>): {
  from: string; // sender's phone in E.164 (e.g. "919876543210")
  text: string;
  messageId: string;
  buttonReplyId?: string;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = (body as any)?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (!msg) return null;

    const from: string = msg.from;
    const messageId: string = msg.id;

    // Button reply
    if (msg.type === 'interactive' && msg.interactive?.button_reply) {
      return {
        from,
        text: msg.interactive.button_reply.title,
        messageId,
        buttonReplyId: msg.interactive.button_reply.id,
      };
    }

    // Text message
    if (msg.type === 'text' && msg.text?.body) {
      return { from, text: msg.text.body, messageId };
    }

    return null;
  } catch {
    return null;
  }
}
