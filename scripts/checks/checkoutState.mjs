// Checks the checkout state kept in sessionStorage. Run: node scripts/checks/checkoutState.mjs
import { createJiti } from 'jiti';
import assert from 'node:assert/strict';
const jiti = createJiti(import.meta.url, { alias: { '@': new URL('../../src', import.meta.url).pathname } });
const m = await jiti.import('../../src/lib/checkoutState.ts');
const kv = () => { const s = new Map(); return { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => s.set(k, String(v)), removeItem: (k) => s.delete(k) }; };

assert.deepEqual(m.stepsFor('preorder'), ['fulfilment', 'details', 'review', 'payment']);
assert.deepEqual(m.stepsFor('mail_order'), ['details', 'review', 'payment']);
const pre = m.emptyCheckout('store_cf24_1', 'preorder', 'Bank transfer');
assert.equal(pre.step, 'fulfilment'); assert.equal(pre.fulfilment, 'pickup'); assert.equal(pre.pay, 'Bank transfer'); assert.equal(pre.open, false);
assert.equal(pre.saveAddress, true);
// A state stored before the save-address choice existed reads back with it on.
{ const legacy = kv(); const { saveAddress: _s, ...withoutFlag } = { ...pre, open: true }; legacy.setItem(m.CHECKOUT_KEY, JSON.stringify(withoutFlag)); const r = m.readCheckout(legacy, 'store_cf24_1', 'preorder', 'Bank transfer'); assert.equal(r.saveAddress, true); assert.equal(r.open, true); legacy.setItem(m.CHECKOUT_KEY, JSON.stringify({ ...pre, saveAddress: false })); assert.equal(m.readCheckout(legacy, 'store_cf24_1', 'preorder', 'Bank transfer').saveAddress, false); }
const mo = m.emptyCheckout('store_mail', 'mail_order', 'QRIS');
assert.equal(mo.step, 'details'); assert.equal(mo.fulfilment, 'mail');

// Round trip; a lane mismatch falls back to empty; garbage falls back to empty.
const store = kv();
const typed = { ...pre, step: 'details', name: 'Ayu', address: 'Jl. Mawar 3', postal: '16920', open: true };
m.writeCheckout(store, typed);
assert.deepEqual(m.readCheckout(store, 'store_cf24_1', 'preorder', 'Bank transfer'), typed);
assert.deepEqual(m.readCheckout(store, 'store_mail', 'mail_order', 'Bank transfer'), m.emptyCheckout('store_mail', 'mail_order', 'Bank transfer'));
store.setItem(m.CHECKOUT_KEY, '{not json');
assert.deepEqual(m.readCheckout(store, 'store_cf24_1', 'preorder', 'Bank transfer'), pre);
m.clearCheckout(store); assert.equal(store.getItem(m.CHECKOUT_KEY), null);
// No storage at all (preview / SSR): empty, and writes are no-ops.
assert.deepEqual(m.readCheckout(undefined, 'store_mail', 'mail_order', 'QRIS'), mo);
m.writeCheckout(undefined, mo); m.clearCheckout(undefined);

// Details validation.
const ok = { ...pre, fulfilment: 'mail', name: 'Ayu', email: 'ayu@example.com', phone: '0812', address: 'Jl. Mawar 3', postal: '16920', service: 'reg_pack' };
assert.deepEqual(m.detailsProblems(ok, { needDay: false, shipped: true, shippingProblem: '' }), {});
const bad = m.detailsProblems({ ...ok, name: ' ', email: 'nope', phone: '', address: '' }, { needDay: false, shipped: true, shippingProblem: 'Choose a shipping service.' });
assert.deepEqual(Object.keys(bad).sort(), ['address', 'email', 'name', 'phone', 'ship']);
assert.equal(bad.email, 'That e-mail address does not look right.');
assert.equal(bad.address, 'Required for shipping');
assert.equal(m.detailsProblems({ ...ok, fulfilment: 'pickup', day: '' }, { needDay: true, shipped: false, shippingProblem: '' }).day, 'Choose a day');
assert.deepEqual(m.detailsProblems({ ...ok, fulfilment: 'pickup', address: '' }, { needDay: false, shipped: false, shippingProblem: 'ignored when not shipped' }), {});

// A stored step past what the data supports is clamped back to 'details'; otherwise kept.
assert.equal(m.clampStep({ ...ok, step: 'payment' }, 'preorder', { needDay: false, shipped: true, shippingProblem: 'Wait a moment for the shipping price.' }), 'details');
assert.equal(m.clampStep({ ...ok, step: 'payment' }, 'preorder', { needDay: false, shipped: true, shippingProblem: '' }), 'payment');
assert.equal(m.clampStep({ ...ok, step: 'fulfilment' }, 'preorder', { needDay: false, shipped: true, shippingProblem: 'x' }), 'fulfilment');
assert.equal(m.clampStep({ ...mo, step: 'fulfilment' }, 'mail_order', { needDay: false, shipped: true, shippingProblem: 'x' }), 'details');
// Values staff have since removed (a pick-up day, a payment choice) are dropped on restore.
const stale = { ...ok, day: 'Day 3', pay: 'Cash' };
const clean = m.sanitizeCheckout(stale, { days: ['Day 1', 'Day 2'], pays: ['Bank transfer', 'QRIS'], defaultPay: 'Bank transfer' });
assert.equal(clean.day, ''); assert.equal(clean.pay, 'Bank transfer');
const kept = m.sanitizeCheckout({ ...ok, day: 'Day 1', pay: 'QRIS' }, { days: ['Day 1'], pays: ['Bank transfer', 'QRIS'], defaultPay: 'Bank transfer' });
assert.equal(kept.day, 'Day 1'); assert.equal(kept.pay, 'QRIS');
assert.equal(m.sanitizeCheckout({ ...ok, pay: 'Cash' }, { days: [], pays: [], defaultPay: '' }).pay, '');
console.log('checkoutState ok');
