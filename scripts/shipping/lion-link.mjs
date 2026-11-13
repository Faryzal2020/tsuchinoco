#!/usr/bin/env node
// Method 1: Lion Parcel's own website, no key, no API calls.
// Builds the lionparcel.com result-page link for a route; opening it shows every Lion service
// and price. Lion's site blocks scripted calls to its own API ("External access not allowed")
// and gates the price call behind reCAPTCHA, so this script only makes the link for a person.
//
// Places are "Kecamatan, Kota" as Lion spells them (see the dropdown on lionparcel.com/ongkir).
//   node scripts/shipping/lion-link.mjs "Bandung Kulon, Bandung" "Medan Area, Medan" 0.3
//   node scripts/shipping/lion-link.mjs "Coblong, Bandung" "Denpasar Barat, Denpasar" 1.2 --open

const [from, to, weight = '1', flag] = process.argv.slice(2);
if (!from || !to) {
  console.error('usage: lion-link.mjs "<kecamatan, kota>" "<kecamatan, kota>" [weightKg] [--open]');
  process.exit(1);
}

// "Bandung Kulon, Bandung (BDO)" → "bandung-kulon-bandung"
const slug = (place) =>
  place.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const url = `https://lionparcel.com/ongkir/cek-ongkir-${slug(from)}-ke-${slug(to)}?weight=${Number(weight)}`;
console.log(url);
if (flag === '--open') (await import('node:child_process')).spawn('open', [url], { stdio: 'ignore', detached: true });
