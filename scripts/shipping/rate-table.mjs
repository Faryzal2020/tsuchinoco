#!/usr/bin/env node
// Method 4: offline rate table, no API at all. Copy per-kg prices from lionparcel.com/ongkir
// (or lion-link.mjs) into RATES for the destinations you ship to most, then compute locally.
// Prices go stale: re-check them when Lion announces a tariff change.
//
//   node scripts/shipping/rate-table.mjs medan 1.35
//   node scripts/shipping/rate-table.mjs medan 0.8 20x15x10     (cm; uses volume weight if larger)

// From Bandung Kulon, checked on lionparcel.com on 2026-11-11.
const RATES = {
  medan: { REGPACK: 47000, JAGOPACK: 22000, BOSSPACK: 54000, MINIPACK_300G: 21500 },
};

// Billed weight rounding: a fraction above 0.3 kg rounds up to the next kg. Biteship (whose Lion
// prices match lionparcel.com exactly) bills 1,301 g as 1 kg and 1,310 g as 2 kg; RajaOngkir
// already bills 1,300 g as 2 kg. Checked 2026-11-11.
const TOLERANCE_KG = 0.3;
const VOLUME_DIVISOR = 6000; // cm³ per kg

const [dest, kgArg, dims] = process.argv.slice(2);
const table = RATES[dest?.toLowerCase()];
if (!table || !kgArg) {
  console.error(`usage: rate-table.mjs <${Object.keys(RATES).join('|')}> <kg> [LxWxH cm]`);
  process.exit(1);
}

const actual = Number(kgArg);
const volume = dims ? dims.split('x').map(Number).reduce((a, b) => a * b, 1) / VOLUME_DIVISOR : 0;
const raw = Math.max(actual, volume);
const whole = Math.floor(raw);
const fraction = Math.round((raw - whole) * 100) / 100;
const billed = Math.max(1, fraction > TOLERANCE_KG ? whole + 1 : whole);

console.log(`actual ${actual} kg, volume ${volume.toFixed(2)} kg → billed ${billed} kg`);
for (const [service, perKg] of Object.entries(table)) {
  if (service === 'MINIPACK_300G') {
    if (raw <= 0.3) console.log(`  MINIPACK   Rp${perKg.toLocaleString('id-ID')}`);
    continue;
  }
  console.log(`  ${service.padEnd(10)} Rp${(perKg * billed).toLocaleString('id-ID')}`);
}
