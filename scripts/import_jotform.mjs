#!/usr/bin/env node

/**
 * JotForm Catalog & Thumbnail Importer for Tsuchinoco
 *
 * Reads product items and thumbnail images from JotForm API,
 * uploads images to Firebase Cloud Storage, creates Firestore `media` docs,
 * and links thumbnails to existing/new catalogue items.
 *
 * Usage:
 *   node scripts/import_jotform.mjs           # Dry-run (preview matches without writing)
 *   node scripts/import_jotform.mjs --apply   # Download, upload to Storage, and update Firestore
 *   node scripts/import_jotform.mjs --form <formId> [--apply]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Load .env.local
const envPath = path.join(rootDir, '.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        let val = (match[2] || '').trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        env[match[1]] = val;
      }
    });
}

const JOTFORM_API_KEY = env.JOTFORM_API_KEY || process.env.JOTFORM_API_KEY;
const PROJECT_ID = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'tsuchinoco-318b2';
let BUCKET = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'tsuchinoco-318b2.firebasestorage.app';
if (BUCKET.startsWith('gs://')) BUCKET = BUCKET.replace('gs://', '');

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const formArgIdx = args.indexOf('--form');
const FORM_ID = formArgIdx !== -1 && args[formArgIdx + 1] ? args[formArgIdx + 1] : '262415889008464'; // Default: CF23 Mail Order

if (!JOTFORM_API_KEY) {
  console.error('Error: JOTFORM_API_KEY not found in .env.local or environment.');
  process.exit(1);
}

// Known manual aliases where Jotform name slightly differs from Catalog item name
const KNOWN_ALIASES = new Map([
  ['okayu splash artprint', 'Okayu Swimsuit Splash Artprint'],
  ['meisho doto & tmo nui artprint', 'Meisho Doto Artprint'],
  ['helldivers 2 truth enforcers standee', 'Truth Enforcers Standee Set'],
]);

// Helper to generate IDs
function newId(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// 2. Google OAuth Token Management
function getAccessToken() {
  const toolsPath = path.join(process.env.HOME || '', '.config/configstore/firebase-tools.json');
  if (!fs.existsSync(toolsPath)) {
    throw new Error('firebase-tools config not found. Run "firebase login" first.');
  }

  let data = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
  let token = data.tokens?.access_token;

  // Quick check if token is valid
  try {
    const check = execSync(
      `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${token}" "https://storage.googleapis.com/storage/v1/b/${BUCKET}"`,
    ).toString().trim();
    if (check === '200') return token;
  } catch {}

  console.log('Refreshing Firebase Google OAuth access token...');
  execSync('npx firebase-tools projects:list', { stdio: 'ignore' });
  data = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
  token = data.tokens?.access_token;
  if (!token) throw new Error('Failed to obtain a valid access token.');
  return token;
}

// Firestore REST encoding helpers
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(val) {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = toFirestoreValue(v);
  }
  return fields;
}

// 3. Main Import Logic
async function main() {
  console.log(`\n======================================================`);
  console.log(`  Tsuchinoco JotForm Catalog & Thumbnail Importer`);
  console.log(`======================================================`);
  console.log(`Target Form ID : ${FORM_ID}`);
  console.log(`Target Bucket  : ${BUCKET}`);
  console.log(`Mode           : ${isApply ? 'LIVE APPLY (will update Storage & Firestore)' : 'DRY RUN (preview only)'}\n`);

  const token = getAccessToken();

  // A. Fetch JotForm data
  console.log(`Fetching form properties from JotForm API...`);
  const jfPropsRes = await fetch(`https://api.jotform.com/form/${FORM_ID}/properties`, {
    headers: { APIKEY: JOTFORM_API_KEY },
  });
  if (!jfPropsRes.ok) throw new Error(`JotForm properties failed: ${jfPropsRes.statusText}`);
  const jfPropsData = await jfPropsRes.json();
  const rawProducts = jfPropsData.content?.products;
  const jfProducts = typeof rawProducts === 'string' ? JSON.parse(rawProducts || '[]') : rawProducts || [];
  console.log(`Found ${jfProducts.length} products in JotForm form.\n`);

  // Parse categories from paymentListSettings
  const rawListSettings = jfPropsData.content?.paymentListSettings;
  const listSettings = typeof rawListSettings === 'string' ? JSON.parse(rawListSettings || '[]') : rawListSettings || [];
  const categoryMap = new Map();
  if (Array.isArray(listSettings) && listSettings[0]?.productCategories) {
    const cats = typeof listSettings[0].productCategories === 'string' ? JSON.parse(listSettings[0].productCategories) : listSettings[0].productCategories;
    for (const c of cats) categoryMap.set(String(c.id), c.name);
  }

  // B. Fetch Questions (check for QRIS and payment note)
  console.log(`Fetching questions from JotForm API...`);
  const jfQRes = await fetch(`https://api.jotform.com/form/${FORM_ID}/questions`, {
    headers: { APIKEY: JOTFORM_API_KEY },
  });
  const jfQData = await jfQRes.json();
  const questions = jfQData.content || {};

  let qrisImageUrl = null;
  let paymentText = null;

  for (const q of Object.values(questions)) {
    if (q.type === 'control_image') {
      const txt = q.text || '';
      if (q.qid === '55' || q.qid === '61' || txt.toLowerCase().includes('payment')) {
        console.log(`Image question #${q.qid}:`, { src: q.src, text: q.text, imageLink: q.imageLink });
        const candidate = q.src || (txt.includes('.') ? `https://www.jotform.com/uploads/qmack719/form_files/${encodeURIComponent(decodeURIComponent(txt))}` : null);
        if (candidate) qrisImageUrl = candidate;
      }
    }
    if (q.type === 'control_text') {
      const rawHtml = q.text || '';
      if (rawHtml.toLowerCase().includes('bank account') || rawHtml.toLowerCase().includes('qris')) {
        paymentText = rawHtml
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<li>/gi, '• ')
          .replace(/<\/li>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    }
  }

  if (qrisImageUrl) console.log(`✓ Detected QRIS Image: ${qrisImageUrl}`);
  if (paymentText) console.log(`✓ Detected Payment Instructions:\n---\n${paymentText}\n---`);

  // C. Fetch existing Firestore catalogue items
  console.log(`\nFetching existing items from Firestore...`);
  let firestoreItems = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/items?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (json.documents) firestoreItems.push(...json.documents);
    pageToken = json.nextPageToken || '';
  } while (pageToken);

  console.log(`Found ${firestoreItems.length} existing items in Firestore catalogue.`);

  const itemsMap = new Map(); // id -> item object
  const itemsByName = new Map(); // lowerName -> item object

  for (const doc of firestoreItems) {
    const id = doc.name.split('/').pop();
    const item = { id, ...decodeFields(doc.fields) };
    itemsMap.set(id, item);
    itemsByName.set(item.name.trim().toLowerCase(), item);
  }

  // D. Match JotForm products with Firestore items
  const matchedList = [];
  const newList = [];

  for (const jp of jfProducts) {
    const rawName = jp.name.trim();
    const lowerName = rawName.toLowerCase();
    const imgs = typeof jp.images === 'string' ? JSON.parse(jp.images || '[]') : jp.images || [];
    const imageUrl = imgs[0] || jp.icon || null;
    const catName = categoryMap.get(String(jp.cid)) || categoryMap.get(String(jp.connectedCategories?.[0])) || '';

    // Check alias
    let matchedItem = null;
    if (KNOWN_ALIASES.has(lowerName)) {
      const aliasName = KNOWN_ALIASES.get(lowerName).toLowerCase();
      matchedItem = itemsByName.get(aliasName);
    }
    // Check exact name
    if (!matchedItem) matchedItem = itemsByName.get(lowerName);
    // Check containment
    if (!matchedItem) {
      for (const [existingName, item] of itemsByName.entries()) {
        if (existingName.includes(lowerName) || lowerName.includes(existingName)) {
          matchedItem = item;
          break;
        }
      }
    }

    if (matchedItem) {
      matchedList.push({
        jfProduct: jp,
        matchedItem,
        imageUrl,
        category: catName || matchedItem.category,
      });
    } else {
      newList.push({
        jfProduct: jp,
        imageUrl,
        category: catName,
      });
    }
  }

  console.log(`\n------------------------------------------------------`);
  console.log(`Matching Results:`);
  console.log(`  ✓ Matched existing items: ${matchedList.length}`);
  console.log(`  + New items to create   : ${newList.length}`);
  console.log(`------------------------------------------------------\n`);

  if (!isApply) {
    console.log(`[DRY RUN SAMPLE MATCHES]`);
    matchedList.slice(0, 10).forEach((m, idx) => {
      console.log(`  ${idx + 1}. [MATCH] "${m.jfProduct.name}" -> "${m.matchedItem.name}" (Current thumb: ${m.matchedItem.thumbnailId || 'none'})`);
    });
    if (newList.length > 0) {
      console.log(`\n[DRY RUN NEW ITEMS]`);
      newList.forEach((n, idx) => {
        console.log(`  ${idx + 1}. [NEW] "${n.jfProduct.name}" (Price: ${n.jfProduct.price}, Category: ${n.category || 'General'})`);
      });
    }

    console.log(`\nTo execute the import, upload images to Cloud Storage, and update Firestore, run:`);
    console.log(`  node scripts/import_jotform.mjs --apply\n`);
    return;
  }

  // E. LIVE APPLY: Download unique images, upload to Storage, create media docs
  console.log(`Executing Live Apply...`);

  // Check existing media documents in Firestore to avoid duplicate uploads
  console.log(`Checking existing media assets in Firestore...`);
  let existingMedia = [];
  let mPageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/media?pageSize=300${mPageToken ? '&pageToken=' + mPageToken : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (json.documents) existingMedia.push(...json.documents);
    mPageToken = json.nextPageToken || '';
  } while (mPageToken);

  const existingMediaByName = new Map();
  for (const doc of existingMedia) {
    const id = doc.name.split('/').pop();
    const m = { id, ...decodeFields(doc.fields) };
    if (m.name) existingMediaByName.set(m.name, id);
  }
  console.log(`Found ${existingMedia.length} existing media assets in Firestore.\n`);

  const uniqueUrls = new Set();
  for (const item of [...matchedList, ...newList]) {
    if (item.imageUrl) uniqueUrls.add(item.imageUrl);
  }
  if (qrisImageUrl) uniqueUrls.add(qrisImageUrl);

  console.log(`Processing ${uniqueUrls.size} unique image assets...`);

  const urlToMediaId = new Map();
  let uploadedCount = 0;

  for (const imgUrl of uniqueUrls) {
    try {
      const isQris = imgUrl === qrisImageUrl;
      const fileName = isQris ? 'qris-payment.png' : path.basename(imgUrl.split('?')[0]) || `thumbnail.png`;

      // Check if already uploaded
      if (existingMediaByName.has(fileName)) {
        const existingId = existingMediaByName.get(fileName);
        urlToMediaId.set(imgUrl, existingId);
        process.stdout.write(`  [Skipped - cached] ${fileName} -> ${existingId}\n`);
        continue;
      }

      const mediaId = newId(10);

      // Download from JotForm
      const resp = await fetch(imgUrl);
      if (!resp.ok) {
        console.warn(`  ⚠ Failed to download: ${imgUrl} (${resp.statusText})`);
        continue;
      }
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const mime = resp.headers.get('content-type') || 'image/png';

      // Upload to Storage
      const storagePath = `media/${mediaId}`;
      const uploadRes = await fetch(
        `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': mime,
          },
          body: buffer,
        },
      );

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.warn(`  ⚠ Storage upload failed for ${storagePath}: ${errText}`);
        continue;
      }

      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(storagePath)}?alt=media`;

      // Create Firestore media document
      const mediaDoc = {
        id: mediaId,
        kind: isQris ? 'image' : 'thumbnail',
        mime,
        url: publicUrl,
        storagePath,
        width: 480,
        height: 480,
        bytes: buffer.length,
        name: fileName,
        createdAt: Date.now(),
        createdBy: 'jotform_importer',
      };

      const mediaDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/media/${mediaId}`;
      await fetch(mediaDocUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: encodeFields(mediaDoc) }),
      });

      urlToMediaId.set(imgUrl, mediaId);
      uploadedCount++;
      process.stdout.write(`  [${uploadedCount}/${uniqueUrls.size}] Uploaded ${fileName} (${(buffer.length / 1024).toFixed(1)} KB)\n`);
    } catch (err) {
      console.warn(`  ⚠ Error processing ${imgUrl}:`, err.message);
    }
  }

  // F. Update existing Firestore items with thumbnailId
  console.log(`\nUpdating existing Firestore items with thumbnail IDs...`);
  let updatedItemsCount = 0;

  for (const m of matchedList) {
    const mediaId = m.imageUrl ? urlToMediaId.get(m.imageUrl) : null;
    if (!mediaId) continue;

    const itemDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/items/${m.matchedItem.id}?updateMask.fieldPaths=thumbnailId&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=updatedBy`;
    const patchBody = {
      fields: {
        thumbnailId: { stringValue: mediaId },
        updatedAt: { integerValue: String(Date.now()) },
        updatedBy: { stringValue: 'jotform_importer' },
      },
    };

    const res = await fetch(itemDocUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    });

    if (res.ok) updatedItemsCount++;
  }
  console.log(`✓ Updated ${updatedItemsCount} existing items with thumbnails.`);

  // G. Create new items in Firestore for unmatched JotForm products
  if (newList.length > 0) {
    console.log(`\nCreating ${newList.length} new items in Firestore catalogue...`);
    let createdCount = 0;

    for (const n of newList) {
      const mediaId = n.imageUrl ? urlToMediaId.get(n.imageUrl) : undefined;
      const itemId = newId(10);
      const rawOptions = n.jfProduct.options;
      const options = typeof rawOptions === 'string' ? JSON.parse(rawOptions || '[]') : rawOptions || [];

      // Extract custom variants (e.g. Size, Type)
      const variants = [];
      const customOpt = options.find((o) => o.type === 'custom');
      if (customOpt && customOpt.properties) {
        const names = customOpt.properties.split('\n').map((s) => s.trim()).filter(Boolean);
        const prices = customOpt.specialPrices ? customOpt.specialPrices.split(',').map(Number) : [];
        names.forEach((vName, idx) => {
          variants.push({
            id: newId(6),
            name: vName,
            active: true,
            price: prices[idx] || Number(n.jfProduct.price) || 0,
          });
        });
      }

      const itemDoc = {
        id: itemId,
        name: n.jfProduct.name.trim(),
        kind: 'product',
        type: n.category ? n.category.toUpperCase() : 'OTHER',
        category: n.category ? n.category.toUpperCase() : undefined,
        price: Number(n.jfProduct.price) || 0,
        producedAt: '',
        active: true,
        thumbnailId: mediaId,
        variants: variants,
        components: [],
        notes: n.jfProduct.description || 'Imported from JotForm',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: 'jotform_importer',
        managerId: '',
      };

      const itemDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/items/${itemId}`;
      const res = await fetch(itemDocUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: encodeFields(itemDoc) }),
      });

      if (res.ok) createdCount++;
    }
    console.log(`✓ Created ${createdCount} new items with thumbnails.`);
  }

  console.log(`\n======================================================`);
  console.log(`  JotForm Import Complete!`);
  console.log(`======================================================`);
  console.log(`Unique images uploaded: ${uploadedCount}`);
  console.log(`Existing items updated: ${updatedItemsCount}`);
  console.log(`New items created     : ${newList.length}`);
  if (qrisImageUrl && urlToMediaId.has(qrisImageUrl)) {
    console.log(`QRIS Payment Media ID : ${urlToMediaId.get(qrisImageUrl)}`);
  }
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('\nFatal Error during JotForm import:', err);
  process.exit(1);
});
