#!/usr/bin/env node
// Method 2: RajaOngkir (Komerce) API, courier code "lion". Free starter key at rajaongkir.com.
// Docs: https://rajaongkir.com/docs/shipping-cost/endpoint-rajaongkir-for-search-base/calculate-domestic-cost
//
//   node scripts/shipping/rajaongkir.mjs "Bandung" "Medan" 300   (key read from .env.local)
//   (weight in grams; add other couriers with COURIERS=lion:jne:jnt)

try { process.loadEnvFile(new URL("../../.env.local", import.meta.url)); } catch {}
const KEY = process.env.RAJAONGKIR_KEY;
const COURIERS = process.env.COURIERS ?? 'lion';
const BASE = 'https://rajaongkir.komerce.id/api/v1';
const [from, to, grams = '1000'] = process.argv.slice(2);
if (!KEY || !from || !to) {
  console.error('usage: rajaongkir.mjs <origin> <destination> [grams]   (needs RAJAONGKIR_KEY in .env.local or the environment)');
  process.exit(1);
}

async function call(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { key: KEY, ...init.headers } });
  const body = await res.json();
  if (body.meta?.code !== 200) throw new Error(`${path}: ${body.meta?.message ?? res.status}`);
  return body.data;
}

async function find(q) {
  const data = await call(`/destination/domestic-destination?search=${encodeURIComponent(q)}&limit=5&offset=0`);
  if (!data?.length) throw new Error(`no destination matches "${q}"`);
  console.error(`"${q}" → ${data[0].label}`);
  return data[0].id;
}

const [origin, destination] = await Promise.all([find(from), find(to)]);
const rates = await call('/calculate/domestic-cost', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ origin, destination, weight: String(grams), courier: COURIERS, price: 'lowest' }),
});
console.table(rates.map((r) => ({ courier: r.code, service: r.service, desc: r.description, cost: r.cost, etd: r.etd })));
