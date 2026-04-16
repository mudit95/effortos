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

/**
 * Send a plain text message to a WhatsApp user.
 */
export async function sendTextMessage(to: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.error('WhatsApp not configured — missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID');
    return;
  }

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
      type: 'text',
      text: { preview_url: false, body },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('WhatsApp send failed:', res.status, err);
  }
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
