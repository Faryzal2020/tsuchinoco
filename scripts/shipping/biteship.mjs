#!/usr/bin/env node
// Method 3: Biteship rates API, courier code "lion". Key from dashboard.biteship.com
// (a testing key works for rates). Docs: https://biteship.com/docs/api/rates/retrieve
//
//   node scripts/shipping/biteship.mjs "Bandung Kulon" "Medan Area" 300   (key read from .env.local)
//   node scripts/shipping/biteship.mjs 40131 80112 300   (postcodes skip the paid place search)
//   (weight in grams; --list shows Lion's service codes)
// A courier only returns prices once it is switched on in the Biteship dashboard's courier settings.

try { process.loadEnvFile(new URL("../../.env.local", import.meta.url)); } catch {}
const KEY = process.env.BITESHIP_KEY;
const COURIERS = process.env.COURIERS ?? 'lion';
const BASE = 'https://api.biteship.com/v1';
const [from, to, grams = '1000'] = process.argv.slice(2);
if (!KEY || !from || !to) {
  console.error('usage: biteship.mjs <origin> <destination> [grams]   (needs BITESHIP_KEY in .env.local or the environment)');
  process.exit(1);
}

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { authorization: KEY, 'content-type': 'application/json', ...init.headers },
  });
  const body = await res.json();
  if (!body.success) {
    const hint = /no courier available/i.test(body.error ?? '')
      ? `\n  → "${COURIERS}" returned no price. Check it is switched on in the Biteship dashboard's courier settings.`
      : '';
    throw new Error(`${path}: ${body.error ?? res.status}${hint}`);
  }
  return body;
}

// A 5-digit postcode is sent as is. A name goes through the Maps search first, which costs Rp2
// per lookup on a live key (free on a test key).
async function find(q, side) {
  if (/^\d{5}$/.test(q)) return { [`${side}_postal_code`]: Number(q) };
  const { areas } = await call(`/maps/areas?countries=ID&type=single&input=${encodeURIComponent(q)}`);
  if (!areas?.length) throw new Error(`no area matches "${q}"`);
  console.error(`"${q}" → ${areas[0].name}`);
  return { [`${side}_area_id`]: areas[0].id };
}

if (process.argv.includes('--list')) {
  const { couriers } = await call('/couriers');
  console.table(couriers.filter((c) => /lion/i.test(c.courier_name)));
  process.exit(0);
}

const [origin, destination] = await Promise.all([find(from, 'origin'), find(to, 'destination')]);
const { pricing } = await call('/rates/couriers', {
  method: 'POST',
  body: JSON.stringify({
    ...origin,
    ...destination,
    couriers: COURIERS,
    items: [{ name: 'Merch', value: 100000, weight: Number(grams), quantity: 1 }],
  }),
});
console.table(pricing.map((p) => ({ courier: p.courier_code, service: p.courier_service_code, price: p.price, etd: p.duration })));
