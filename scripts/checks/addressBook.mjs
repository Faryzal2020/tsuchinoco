// Checks the pure address-book rules. Run: node scripts/checks/addressBook.mjs
import { createJiti } from 'jiti';
import assert from 'node:assert/strict';
const jiti = createJiti(import.meta.url, { alias: { '@': new URL('../../src', import.meta.url).pathname } });
const { addressKey, rememberAddress, forgetAddress, findAddress, MAX_SAVED_ADDRESSES } = await jiti.import('../../src/lib/addressBook.ts');
let n = 0; const id = () => `a${++n}`;

assert.equal(addressKey('16920', '  Jl. Mawar  No. 3,\nBogor '), '16920|jl. mawar no. 3, bogor');
assert.equal(addressKey('16920', 'JL. MAWAR NO. 3, BOGOR'), addressKey('16920', 'jl. mawar no. 3, bogor'));

const one = rememberAddress([], { postalCode: '16920', address: 'Jl. Mawar 3' }, 1000, id);
assert.deepEqual(one, [{ id: 'a1', postalCode: '16920', address: 'Jl. Mawar 3', lastUsedAt: 1000 }]);
// Same address, different case and spacing: no new entry, lastUsedAt moves, stored text is the new one trimmed.
const same = rememberAddress(one, { postalCode: '16920', address: '  jl. mawar   3 ' }, 2000, id);
assert.equal(same.length, 1); assert.equal(same[0].id, 'a1'); assert.equal(same[0].lastUsedAt, 2000); assert.equal(same[0].address, 'jl. mawar 3');
// Most recently used first.
const two = rememberAddress(same, { postalCode: '40115', address: 'Jl. Braga 1' }, 3000, id);
assert.deepEqual(two.map((a) => a.id), ['a2', 'a1']);
// Sixth distinct address evicts the least recently used (a1), never the newest.
let list = two;
for (let t = 4000; t <= 7000; t += 1000) list = rememberAddress(list, { postalCode: '1000' + (t / 1000), address: `Addr ${t}` }, t, id);
assert.equal(list.length, MAX_SAVED_ADDRESSES);
assert.ok(!list.some((a) => a.id === 'a1'));
assert.equal(list[0].lastUsedAt, 7000);
// Forget and find.
assert.deepEqual(forgetAddress(two, 'a2').map((a) => a.id), ['a1']);
assert.equal(findAddress(two, '40115', 'JL. BRAGA 1')?.id, 'a2');
assert.equal(findAddress(two, '40115', 'Jl. Braga 2'), undefined);
console.log('addressBook ok');
