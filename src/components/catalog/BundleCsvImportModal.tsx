'use client';

import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { itemRepo } from '@/lib/repo';
import { formatMoney } from '@/lib/format';
import type { BundleComponent, Item } from '@/types';
import Button from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Pill, TableWrap } from '@/components/ui/Bits';

interface RawBundleItem {
  itemName: string;
  variantText: string;
}

interface ParsedBundleGroup {
  bundleName: string;
  items: RawBundleItem[];
}

interface ResolvedComponent {
  rawItemName: string;
  rawVariantText: string;
  matchedItem?: Item;
  matchedVariantId: string;
  matchedVariantName?: string;
}

interface ResolvedBundle {
  bundleName: string;
  existingBundle?: Item;
  components: ResolvedComponent[];
}

export default function BundleCsvImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}) {
  const { items, settings } = useData();
  const { me } = useAuth();
  const { run, toast } = useToast();

  const [fileName, setFileName] = useState('');
  const [parsedBundles, setParsedBundles] = useState<ParsedBundleGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Lookup maps
  const bundleMap = useMemo(() => {
    const map = new Map<string, Item>();
    items.filter((i) => i.kind === 'bundle').forEach((b) => {
      map.set(b.name.trim().toLowerCase(), b);
    });
    return map;
  }, [items]);

  const productList = useMemo(() => items.filter((i) => i.kind === 'product'), [items]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      try {
        const parsed = Papa.parse<string[]>(text, {
          skipEmptyLines: 'greedy',
        });

        const rows = parsed.data;
        if (!rows || rows.length === 0) {
          setError('CSV file is empty');
          return;
        }

        // Determine columns
        // Header line typically: "Bundle Name", "Items", "Variant"
        let startIdx = 0;
        const firstRow = rows[0].map((c) => (c || '').trim().toLowerCase());
        if (firstRow.some((c) => c.includes('bundle') || c.includes('items'))) {
          startIdx = 1;
        }

        const groups: ParsedBundleGroup[] = [];
        let currentGroup: ParsedBundleGroup | null = null;

        for (let i = startIdx; i < rows.length; i++) {
          const row = rows[i];
          const rawBundleName = (row[0] || '').trim();
          const rawItemName = (row[1] || '').trim();
          const rawVariant = (row[2] || '').trim();

          // Stop parsing if this is the summary footer row (e.g. empty or total calculations)
          if (!rawBundleName && !rawItemName && !rawVariant) {
            continue;
          }

          if (rawBundleName) {
            currentGroup = {
              bundleName: rawBundleName,
              items: [],
            };
            groups.push(currentGroup);
          }

          if (rawItemName && currentGroup) {
            currentGroup.items.push({
              itemName: rawItemName,
              variantText: rawVariant,
            });
          }
        }

        if (groups.length === 0) {
          setError('No bundles found in the uploaded CSV');
          return;
        }

        setParsedBundles(groups);
      } catch (err: any) {
        setError(err.message || 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  };

  // Resolve bundles & component matching
  const resolvedBundles = useMemo<ResolvedBundle[]>(() => {
    return parsedBundles.map((group) => {
      const bundleNameKey = group.bundleName.trim().toLowerCase();
      // Match bundle in database
      let existingBundle = bundleMap.get(bundleNameKey);
      if (!existingBundle) {
        // Fallback partial match
        existingBundle = items.find(
          (i) =>
            i.kind === 'bundle' &&
            (i.name.toLowerCase().includes(bundleNameKey) || bundleNameKey.includes(i.name.toLowerCase()))
        );
      }

      const components: ResolvedComponent[] = group.items.map((it) => {
        const itemKey = it.itemName.trim().toLowerCase();
        // Match product
        let matchedProduct = productList.find(
          (p) => p.name.trim().toLowerCase() === itemKey
        );

        if (!matchedProduct) {
          // Try loose matching
          matchedProduct = productList.find(
            (p) =>
              p.name.toLowerCase().includes(itemKey) ||
              itemKey.includes(p.name.toLowerCase())
          );
        }

        let matchedVariantId = '';
        let matchedVariantName = '';

        if (matchedProduct && matchedProduct.variants && matchedProduct.variants.length > 0) {
          // Clean variant text e.g. "(Gigi)" -> "Gigi"
          const cleanVar = it.variantText.replace(/[()]/g, '').trim().toLowerCase();
          if (cleanVar) {
            // Split comma choices e.g. "JP,EN"
            const choices = cleanVar.split(',').map((c) => c.trim().toLowerCase());
            const found = matchedProduct.variants.find((v) =>
              choices.some(
                (c) =>
                  v.name.toLowerCase() === c ||
                  v.name.toLowerCase().includes(c) ||
                  c.includes(v.name.toLowerCase())
              )
            );
            if (found) {
              matchedVariantId = found.id;
              matchedVariantName = found.name;
            } else {
              matchedVariantId = matchedProduct.variants[0]?.id || '';
              matchedVariantName = matchedProduct.variants[0]?.name || '';
            }
          } else {
            matchedVariantId = matchedProduct.variants[0]?.id || '';
            matchedVariantName = matchedProduct.variants[0]?.name || '';
          }
        }

        return {
          rawItemName: it.itemName,
          rawVariantText: it.variantText,
          matchedItem: matchedProduct,
          matchedVariantId,
          matchedVariantName,
        };
      });

      return {
        bundleName: group.bundleName,
        existingBundle,
        components,
      };
    });
  }, [parsedBundles, bundleMap, productList, items]);

  const matchStats = useMemo(() => {
    let matchedBundlesCount = 0;
    let totalComponentsCount = 0;
    let matchedComponentsCount = 0;

    resolvedBundles.forEach((b) => {
      if (b.existingBundle) matchedBundlesCount++;
      b.components.forEach((c) => {
        totalComponentsCount++;
        if (c.matchedItem) matchedComponentsCount++;
      });
    });

    return {
      totalBundles: resolvedBundles.length,
      matchedBundlesCount,
      totalComponentsCount,
      matchedComponentsCount,
    };
  }, [resolvedBundles]);

  const handleApplyImport = async () => {
    if (resolvedBundles.length === 0) return;
    setBusy(true);

    let updatedCount = 0;
    const ok = await run(async () => {
      for (const res of resolvedBundles) {
        if (!res.existingBundle) continue;

        // Build valid BundleComponent array
        const components: BundleComponent[] = [];
        for (const c of res.components) {
          if (!c.matchedItem) continue;
          components.push({
            itemId: c.matchedItem.id,
            variantId: c.matchedVariantId || '',
            qty: 1,
          });
        }

        if (components.length > 0) {
          await itemRepo.patch(
            res.existingBundle.id,
            { components },
            me
          );
          updatedCount++;
        }
      }
    }, `Imported components for ${updatedCount} bundles`);

    setBusy(false);
    if (ok) {
      toast(`Successfully configured ${updatedCount} bundles`);
      onImported?.();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import Bundles Configuration from CSV"
      wide
      footer={
        <div className="flex w-full items-center justify-between">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={resolvedBundles.length === 0 || matchStats.matchedBundlesCount === 0 || busy}
            busy={busy}
            onClick={handleApplyImport}
          >
            Apply Import ({matchStats.matchedBundlesCount} Bundles)
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Upload your Bundles CSV sheet (e.g.{' '}
          <code className="text-xs font-mono bg-cream-2 px-1.5 py-0.5 rounded border border-line">
            0_MAIN Tsuchinoco CF23 Supersheet - Bundles.csv
          </code>
          ) to link products and variants to their parent bundle packages.
        </p>

        {/* Upload File Input */}
        <div className="p-4 rounded-xl border-2 border-dashed border-line bg-surface flex flex-col items-center justify-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileUpload}
            className="block text-sm text-ink file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-yellow file:text-ink hover:file:bg-yellow-2 cursor-pointer"
          />
          {fileName && <span className="text-xs text-ink-2 font-mono">Selected: {fileName}</span>}
          {error && <span className="text-xs text-red-600 font-semibold">{error}</span>}
        </div>

        {/* Parse Preview */}
        {resolvedBundles.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 p-3 bg-white rounded-lg border border-line text-xs font-medium">
              <span className="font-bold text-ink">Summary:</span>
              <Pill tone={matchStats.matchedBundlesCount > 0 ? 'green' : 'yellow'}>
                {matchStats.matchedBundlesCount} / {matchStats.totalBundles} Bundles Matched
              </Pill>
              <Pill tone={matchStats.matchedComponentsCount === matchStats.totalComponentsCount ? 'green' : 'yellow'}>
                {matchStats.matchedComponentsCount} / {matchStats.totalComponentsCount} Items Matched
              </Pill>
            </div>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {resolvedBundles.map((b, idx) => {
                const isMatched = !!b.existingBundle;
                const matchedComps = b.components.filter((c) => !!c.matchedItem).length;

                return (
                  <div
                    key={idx}
                    className={`rounded-xl border p-3 bg-white transition-colors ${
                      isMatched ? 'border-line' : 'border-amber-200 bg-amber-50/20'
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-line pb-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-ink">{b.bundleName}</span>
                        {isMatched ? (
                          <Pill tone="green">Matched in Catalogue</Pill>
                        ) : (
                          <Pill tone="yellow">Not Found in Catalogue</Pill>
                        )}
                      </div>
                      <span className="text-xs text-ink-2">
                        {matchedComps} / {b.components.length} components resolved
                      </span>
                    </div>

                    <div className="grid gap-1 text-xs">
                      {b.components.map((c, cIdx) => (
                        <div
                          key={cIdx}
                          className="flex items-center justify-between py-1 border-b border-line/30 last:border-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className={c.matchedItem ? 'text-green-600' : 'text-red-500'}>
                              {c.matchedItem ? '✓' : '✗'}
                            </span>
                            <span className="font-medium text-ink">{c.rawItemName}</span>
                            {c.rawVariantText && (
                              <span className="text-ink-2 font-mono">[{c.rawVariantText}]</span>
                            )}
                          </div>
                          <div>
                            {c.matchedItem ? (
                              <span className="text-ink-2">
                                → {c.matchedItem.name}{' '}
                                {c.matchedVariantName && (
                                  <span className="font-semibold text-blue-700">
                                    ({c.matchedVariantName})
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-red-600 italic">No matching product in catalogue</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
