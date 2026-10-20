/**
 * The email to Travis for a contact-form message (onContactMessage.ts):
 * its plain-text and HTML parts say the same. Run with `npm test` in
 * functions/.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildContactMessageEmail } from '../src/onContactMessage';

const message = {
  name: 'Sam <Rivera>',
  email: 'sam@example.com',
  phone: '(352) 555-0100',
  subject: 'Group of 8?',
  message: 'Can you take 8 of us\non a Saturday?',
};

describe('contact-form email', () => {
  test('both parts link Messages in admin and say a reply goes to the sender', () => {
    const { subject, text, html } = buildContactMessageEmail(message, 'https://example.com');
    assert.equal(subject, '[crmf] Group of 8? — from Sam <Rivera>');
    assert.match(text, /View in admin: https:\/\/example\.com\/admin\/messages/);
    assert.match(html, /href="https:\/\/example\.com\/admin\/messages"/);
    assert.match(text, /Reply to this email and it goes to Sam <Rivera>: the reply-to address is theirs\./);
    assert.match(html, /Reply to this email and it goes to Sam &lt;Rivera&gt;: the reply-to address is theirs\./);
  });

  test('the phone is a tel: link that dials, however it was typed', () => {
    const { html } = buildContactMessageEmail(message, 'https://example.com');
    assert.match(html, /href="tel:\+13525550100"/);
    const none = buildContactMessageEmail({ ...message, phone: null }, 'https://example.com');
    assert.doesNotMatch(none.text + none.html, /Phone|tel:/);
  });
});
