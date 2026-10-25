import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyMonnifyWebhookSignature } from "../modules/monnify/service/monnify.webhook.js";

const secret = "TEST_SECRET_KEY_123";
const bodyA = Buffer.from('{"eventType":"SUCCESSFUL_TRANSACTION","eventData":{"amountPaid":1000}}', 'utf8');
const bodyB = Buffer.from('{"eventType":"SUCCESSFUL_TRANSACTION","eventData":{"amountPaid":2000}}', 'utf8');

function hmac(body: Buffer) {
  return crypto.createHmac('sha512', secret).update(body).digest('hex');
}

test("monnify signature: valid", () => {
  const sig = hmac(bodyA);
  assert.doesNotThrow(() =>
    verifyMonnifyWebhookSignature({ rawBody: bodyA, signatureHeader: sig, clientSecretKey: secret }),
  );
});

test("monnify signature: invalid when body changed", () => {
  const sig = hmac(bodyA); // signature for A
  assert.throws(() =>
    verifyMonnifyWebhookSignature({ rawBody: bodyB, signatureHeader: sig, clientSecretKey: secret }),
    /Invalid webhook signature/,
  );
});

test("monnify signature: invalid when signature changed", () => {
  const sig = hmac(bodyA).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));
  assert.throws(() =>
    verifyMonnifyWebhookSignature({ rawBody: bodyA, signatureHeader: sig, clientSecretKey: secret }),
    /Invalid webhook signature/,
  );
});

test("monnify signature: missing raw body", () => {
  const sig = hmac(bodyA);
  assert.throws(() =>
    verifyMonnifyWebhookSignature({ rawBody: undefined, signatureHeader: sig, clientSecretKey: secret }),
    /Missing raw body/,
  );
});

test("monnify signature: missing signature header", () => {
  assert.throws(() =>
    verifyMonnifyWebhookSignature({ rawBody: bodyA, signatureHeader: undefined as any, clientSecretKey: secret }),
    /Missing monnify-signature/,
  );
});

test("monnify signature: missing client secret", () => {
  const sig = hmac(bodyA);
  assert.throws(() =>
    verifyMonnifyWebhookSignature({ rawBody: bodyA, signatureHeader: sig, clientSecretKey: "" as any }),
    /Missing Monnify client secret/,
  );
});
