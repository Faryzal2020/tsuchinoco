// Checks the pure address-book rules. Run: node scripts/checks/addressBook.mjs
import { createJiti } from 'jiti';
import assert from 'node:assert/strict';
const jiti = createJiti(import.meta.url, { alias: { '@': new URL('../../src', import.meta.url).pathname } });
const { addressKey, rememberAddress, forgetAddress, findAddress, rememberInBook, forgetInBook, MAX_SAVED_ADDRESSES } = await jiti.import('../../src/lib/addressBook.ts');
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
// Line breaks survive; only runs of spaces collapse.
assert.equal(rememberAddress([], { postalCode: '16920', address: ' Jl. Mawar 3  \n  RT 01, Bogor ' }, 1, id)[0].address, 'Jl. Mawar 3\nRT 01, Bogor');
// A device clock behind the others never drops the address just used, and a touched entry moves to the top.
let skew = [];
for (let t = 5000; t <= 9000; t += 1000) skew = rememberAddress(skew, { postalCode: '2000' + (t / 1000), address: `Old ${t}` }, t, id);
const behind = rememberAddress(skew, { postalCode: '16920', address: 'Fresh' }, 100, id);
assert.equal(behind[0].address, 'Fresh'); assert.equal(behind.length, MAX_SAVED_ADDRESSES); assert.ok(!behind.some((a) => a.address === 'Old 5000'));
const touched = rememberAddress(skew, { postalCode: '20007', address: 'old 7000' }, 100, id);
assert.equal(touched[0].address, 'old 7000'); assert.equal(touched.length, 5);

// Through an address book: the list is re-read right before writing, and a failed read writes nothing.
const fakeBook = (stored, fail = false) => { const calls = []; return { calls, load: async () => { if (fail) throw new Error('offline'); return stored; }, save: async (_uid, list) => { calls.push(list); } }; };
const bk = fakeBook(two);
const written = await rememberInBook(bk, 'u1', { postalCode: '16920', address: 'Jl. Melati 9' }, 9000, id);
assert.equal(bk.calls.length, 1); assert.equal(written[0].address, 'Jl. Melati 9'); assert.equal(written.length, 3);
const dead = fakeBook(two, true);
assert.equal(await rememberInBook(dead, 'u1', { postalCode: '16920', address: 'Jl. Melati 9' }, 9000, id), null);
assert.equal(dead.calls.length, 0);
const fb = fakeBook(two);
assert.deepEqual((await forgetInBook(fb, 'u1', 'a2')).map((a) => a.id), ['a1']); assert.equal(fb.calls.length, 1);
assert.equal(await forgetInBook(fakeBook(two, true), 'u1', 'a2'), null);
console.log('addressBook ok');
