/**
 * Unit coverage for extractIncomingMessage — specifically the new
 * image-message branch (mig 033 photo journals).
 *
 * The full text + button + voice flows are exercised by other tests;
 * here we just pin down that an inbound image payload from Meta gets
 * unpacked correctly: imageId is forwarded, MIME type is preserved,
 * caption (if present) lands in `text` so the webhook can save it
 * as the journal body.
 */

import { describe, it, expect } from 'vitest';
import { extractIncomingMessage } from '@/lib/whatsapp';

function envelope(messageOverrides: Record<string, unknown>): Record<string, unknown> {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: '919876543210',
                  id: 'wamid.test',
                  ...messageOverrides,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('extractIncomingMessage — image (photo journal) branch', () => {
  it('extracts an image with no caption — text is empty', () => {
    const out = extractIncomingMessage(envelope({
      type: 'image',
      image: { id: 'meta_image_id_1', mime_type: 'image/jpeg' },
    }));
    expect(out).not.toBeNull();
    expect(out?.imageId).toBe('meta_image_id_1');
    expect(out?.imageMimeType).toBe('image/jpeg');
    expect(out?.text).toBe('');
    expect(out?.audioId).toBeUndefined();
  });

  it('extracts an image WITH caption — caption lands in text', () => {
    const out = extractIncomingMessage(envelope({
      type: 'image',
      image: {
        id: 'meta_image_id_2',
        mime_type: 'image/png',
        caption: 'Sunday morning view',
      },
    }));
    expect(out).not.toBeNull();
    expect(out?.imageId).toBe('meta_image_id_2');
    expect(out?.imageMimeType).toBe('image/png');
    expect(out?.text).toBe('Sunday morning view');
  });

  it('returns null for an image without an id (malformed payload)', () => {
    const out = extractIncomingMessage(envelope({
      type: 'image',
      image: { mime_type: 'image/jpeg' }, // no id
    }));
    // Defence-in-depth: if Meta ever sends a malformed payload (or an
    // attacker forges one), we don't want to mis-route as a photo
    // journal with no actual photo to download.
    expect(out).toBeNull();
  });

  it('still extracts text messages cleanly (regression: image branch did not break others)', () => {
    const out = extractIncomingMessage(envelope({
      type: 'text',
      text: { body: 'tasks' },
    }));
    expect(out?.text).toBe('tasks');
    expect(out?.imageId).toBeUndefined();
  });

  it('still extracts voice notes cleanly (regression)', () => {
    const out = extractIncomingMessage(envelope({
      type: 'voice',
      voice: { id: 'meta_voice_id_1' },
    }));
    expect(out?.audioId).toBe('meta_voice_id_1');
    expect(out?.imageId).toBeUndefined();
  });
});
