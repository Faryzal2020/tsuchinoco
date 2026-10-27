'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { QueryPage, useQuery } from '@/lib/useQuery';
import { formRepo, templateRepo } from '@/lib/repo';
import { formChangedSincePublish, previewPublicForm, publishForm } from '@/lib/formActions';
import { cloneFormFromBatch, applyTemplateToForm, saveFormAsTemplate } from '@/lib/templateActions';
import {
  BLOCK_NAMES,
  THEME_PRESETS,
  newBlock,
  pickupDaysFor,
  publicFormSize,
  PUBLIC_FORM_LIMIT,
  formUrl,
} from '@/lib/forms';
import ThumbnailInput from '@/components/form/ThumbnailInput';
import FormRenderer from '@/components/form/FormRenderer';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal, Confirm } from '@/components/ui/Dialog';
import { Loading, Panel, Pill } from '@/components/ui/Bits';
import type {
  Batch,
  Event,
  FormBlock,
  FormBlockType,
  FormDoc,
  FormTemplate,
  FormTheme,
  Item,
  OfferingEntry,
  ProductsSource,
  PublicForm,
  Variant,
} from '@/types';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Layers,
  Monitor,
  Palette,
  Plus,
  Save,
  Send,
  Settings as SettingsIcon,
  Smartphone,
  Trash2,
} from 'lucide-react';

type StudioTab = 'blocks' | 'theme' | 'settings' | 'templates';

function FormStudio() {
  const { get } = useQuery();
  const id = get('id');
  const { me } = useAuth();
  const { formsById, batches, events, itemsById, settings, publicFormsById, templates } = useData();
  const { run, toast } = useToast();

  const originalForm = formsById.get(id);
  const batch = batches.find((b) => b.id === id);
  const event = batch ? events.find((e) => e.id === batch.eventId) : undefined;
  const pub = publicFormsById.get(id);

  const [draft, setDraft] = useState<FormDoc | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>('blocks');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [isAddBlockOpen, setIsAddBlockOpen] = useState(false);
  const [blockToDelete, setBlockToDelete] = useState<string | null>(null);
  const [snap, setSnap] = useState<Omit<PublicForm, 'id'> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Initialize draft when form loads
  useEffect(() => {
    if (originalForm && !draft) {
      setDraft({ ...originalForm, blocks: originalForm.blocks.map((b) => ({ ...b })) });
      if (originalForm.blocks.length > 0) {
        setExpandedBlockId(originalForm.blocks[0].id);
      }
    }
  }, [originalForm, draft]);

  // Generate live preview snapshot whenever draft changes
  useEffect(() => {
    if (!draft || !batch || !event) return;
    let alive = true;
    previewPublicForm(draft, batch, event, itemsById, settings).then((s) => {
      if (alive) setSnap(s);
    });
    return () => {
      alive = false;
    };
  }, [draft, batch, event, itemsById, settings]);

  if (!originalForm || !batch || !event || !draft) {
    return (
      <Panel className="text-center py-12">
        <Loading label="Loading Form Studio…" />
      </Panel>
    );
  }

  const isUnsaved = JSON.stringify(draft) !== JSON.stringify(originalForm);
  const changedSincePublish = formChangedSincePublish(draft, batch, itemsById);
  const previewSize = snap ? publicFormSize(snap) : 0;
  const publicLink = formUrl(draft.id);

  // ---- Save & Publish Handlers ----
  const handleSaveDraft = async () => {
    setBusy('save');
    await run(async () => {
      await formRepo.patch(draft.id, draft, me);
    }, 'Draft saved');
    setBusy(null);
  };

  const handlePublish = async () => {
    setBusy('publish');
    await run(async () => {
      await formRepo.patch(draft.id, draft, me);
      await publishForm(draft, batch, event, itemsById, settings, pub, me);
    }, pub ? 'Republished' : 'Published');
    setBusy(null);
  };

  // ---- Block Operations ----
  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= draft.blocks.length) return;
    const nextBlocks = [...draft.blocks];
    const [moved] = nextBlocks.splice(index, 1);
    nextBlocks.splice(targetIndex, 0, moved);
    setDraft({ ...draft, blocks: nextBlocks });
  };

  const updateBlock = (blockId: string, patch: Partial<FormBlock>) => {
    setDraft({
      ...draft,
      blocks: draft.blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as FormBlock) : b)),
    });
  };

  const addBlock = (type: FormBlockType) => {
    const block = newBlock(type);
    setDraft({ ...draft, blocks: [...draft.blocks, block] });
    setExpandedBlockId(block.id);
    setIsAddBlockOpen(false);
  };

  const confirmDeleteBlock = () => {
    if (!blockToDelete) return;
    setDraft({ ...draft, blocks: draft.blocks.filter((b) => b.id !== blockToDelete) });
    if (expandedBlockId === blockToDelete) setExpandedBlockId(null);
    setBlockToDelete(null);
  };

  return (
    <div className="space-y-4">
      {/* ---- Studio Navigation & Header ---- */}
      <div className="bg-white border border-line rounded-xl px-5 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/forms/" className="text-xs font-semibold text-ink-2 hover:text-ink">
            ← Forms
          </Link>
          <span className="text-line text-sm">/</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-ink">{draft.title}</h1>
              {isUnsaved && <Pill tone="yellow">Unsaved changes</Pill>}
              {!isUnsaved && pub && changedSincePublish && <Pill tone="yellow">Changed since publish</Pill>}
              {pub ? <Pill tone={pub.enabled ? 'green' : 'yellow'}>{pub.enabled ? 'Live' : 'Live (Paused)'}</Pill> : <Pill>Draft</Pill>}
            </div>
            <p className="text-xs text-ink-2">
              {event.name} · Batch {batch.number} ({batch.mode === 'post' ? 'Mail only' : 'OTS + Mail'})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              navigator.clipboard?.writeText(publicLink);
              toast('Customer form link copied');
            }}
            title="Copy public link"
          >
            <Copy size={14} className="mr-1" /> Copy link
          </Button>

          <Button size="sm" variant="quiet" href={`/forms/preview/?id=${draft.id}`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} className="mr-1" /> Standalone Preview
          </Button>

          <Button
            size="sm"
            variant={isUnsaved ? 'primary' : 'neutral'}
            busy={busy === 'save'}
            onClick={handleSaveDraft}
          >
            <Save size={14} className="mr-1" /> Save draft
          </Button>

          <Button
            size="sm"
            variant={pub && !changedSincePublish && !isUnsaved ? 'neutral' : 'primary'}
            busy={busy === 'publish'}
            onClick={handlePublish}
          >
            <Send size={14} className="mr-1" /> {pub ? 'Republish' : 'Publish'}
          </Button>
        </div>
      </div>

      {/* ---- Split-Screen Workspace ---- */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(420px,480px)_minmax(0,1fr)] gap-5 items-start">
        {/* ================= Left Column: Editor Studio ================= */}
        <div className="bg-white border border-line rounded-xl shadow-xs overflow-hidden flex flex-col">
          {/* Studio Tabs */}
          <div className="flex border-b border-line bg-cream px-3 pt-2 gap-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('blocks')}
              className={`px-3 py-2 border-b-2 rounded-t-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'blocks' ? 'border-accent text-accent bg-white' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              <Layers size={14} /> Blocks ({draft.blocks.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('theme')}
              className={`px-3 py-2 border-b-2 rounded-t-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'theme' ? 'border-accent text-accent bg-white' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              <Palette size={14} /> Theme & Style
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-2 border-b-2 rounded-t-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'settings' ? 'border-accent text-accent bg-white' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              <SettingsIcon size={14} /> Settings
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className={`px-3 py-2 border-b-2 rounded-t-md transition-colors flex items-center gap-1.5 ${
                activeTab === 'templates' ? 'border-accent text-accent bg-white' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              <Copy size={14} /> Clone & Templates
            </button>
          </div>

          {/* Tab 1: Blocks Manager */}
          {activeTab === 'blocks' && (
            <div className="p-4 space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-ink">Form Layout Blocks</h2>
                  <p className="text-xs text-ink-2">Reorder and customize what buyers see on the preorder page.</p>
                </div>
                <Button size="sm" variant="primary" onClick={() => setIsAddBlockOpen(true)}>
                  <Plus size={14} className="mr-1" /> Add block
                </Button>
              </div>

              {/* Block List */}
              <div className="space-y-2">
                {draft.blocks.map((b, idx) => {
                  const isExpanded = expandedBlockId === b.id;
                  return (
                    <div
                      key={b.id}
                      className={`border rounded-lg transition-all ${
                        isExpanded ? 'border-accent bg-cream/40 shadow-xs' : 'border-line hover:border-line-strong bg-white'
                      }`}
                    >
                      {/* Block Row Header */}
                      <div className="flex items-center justify-between p-3 gap-2">
                        <div
                          className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                          onClick={() => setExpandedBlockId(isExpanded ? null : b.id)}
                        >
                          <span className="text-xs font-mono font-bold text-ink-2 w-5">#{idx + 1}</span>
                          <Pill tone="blue" className="text-[11px] uppercase tracking-wider font-semibold">
                            {BLOCK_NAMES[b.type] ?? b.type}
                          </Pill>
                          <span className="text-xs font-medium text-ink truncate">
                            {b.type === 'header' && (b.title || 'Header')}
                            {b.type === 'products' && (b.title || `${b.source.kind} products`)}
                            {b.type === 'payment_instructions' && (b.title || 'Payment & QRIS')}
                            {b.type === 'text' && (b.text?.slice(0, 30) || 'Text block')}
                            {b.type === 'section' && (b.title || 'Section')}
                            {b.type === 'image' && (b.caption || 'Image')}
                            {b.type === 'customer' && 'Name, Phone, Email'}
                            {b.type === 'fulfilment' && 'Pickup & Mail options'}
                            {b.type === 'notes' && 'Buyer Notes'}
                            {b.type === 'submit' && 'Submit Button'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveBlock(idx, 'up')}
                            className="p-1 text-ink-2 hover:text-ink disabled:opacity-20 cursor-pointer"
                            title="Move up"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === draft.blocks.length - 1}
                            onClick={() => moveBlock(idx, 'down')}
                            className="p-1 text-ink-2 hover:text-ink disabled:opacity-20 cursor-pointer"
                            title="Move down"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedBlockId(isExpanded ? null : b.id)}
                            className="p-1 text-ink-2 hover:text-ink cursor-pointer"
                          >
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setBlockToDelete(b.id)}
                            className="p-1 text-red-500 hover:text-red-700 cursor-pointer"
                            title="Delete block"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Block Inline Settings Form */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-line/60 bg-white rounded-b-lg">
                          <BlockConfigEditor
                            block={b}
                            batch={batch}
                            itemsById={itemsById}
                            onChange={(patch) => updateBlock(b.id, patch)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 2: Theme Customizer */}
          {activeTab === 'theme' && (
            <div className="p-4 space-y-5 max-h-[calc(100vh-220px)] overflow-y-auto">
              <div>
                <h2 className="text-sm font-bold text-ink">Theme Presets</h2>
                <p className="text-xs text-ink-2 mb-3">1-click designer color palettes crafted for artist circle forms.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {THEME_PRESETS.map((p) => {
                    const active = draft.theme.background === p.theme.background && draft.theme.accent === p.theme.accent;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, theme: { ...p.theme } })}
                        className={`text-left p-2.5 rounded-lg border transition-all ${
                          active ? 'border-accent ring-1 ring-accent bg-accent/5' : 'border-line hover:border-line-strong'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="flex -space-x-1">
                            <span className="w-4 h-4 rounded-full border border-black/10" style={{ background: p.theme.background }} />
                            <span className="w-4 h-4 rounded-full border border-black/10" style={{ background: p.theme.surface }} />
                            <span className="w-4 h-4 rounded-full border border-black/10" style={{ background: p.theme.accent }} />
                          </div>
                          <span className="text-xs font-bold text-ink">{p.name}</span>
                          {active && <Check size={12} className="ml-auto text-accent" />}
                        </div>
                        <p className="text-[11px] text-ink-2 line-clamp-1">{p.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-line pt-4 space-y-3">
                <h3 className="text-xs font-bold uppercase text-ink-2 tracking-wider">Custom Colors</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <Field label="Background color">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draft.theme.background}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, background: e.target.value } })}
                        className="w-8 h-8 rounded-md cursor-pointer border border-line"
                      />
                      <Input
                        small
                        value={draft.theme.background}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, background: e.target.value } })}
                      />
                    </div>
                  </Field>
                  <Field label="Card surface">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draft.theme.surface}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, surface: e.target.value } })}
                        className="w-8 h-8 rounded-md cursor-pointer border border-line"
                      />
                      <Input
                        small
                        value={draft.theme.surface}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, surface: e.target.value } })}
                      />
                    </div>
                  </Field>
                  <Field label="Accent color">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draft.theme.accent}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, accent: e.target.value } })}
                        className="w-8 h-8 rounded-md cursor-pointer border border-line"
                      />
                      <Input
                        small
                        value={draft.theme.accent}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, accent: e.target.value } })}
                      />
                    </div>
                  </Field>
                  <Field label="Text color">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={draft.theme.text}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, text: e.target.value } })}
                        className="w-8 h-8 rounded-md cursor-pointer border border-line"
                      />
                      <Input
                        small
                        value={draft.theme.text}
                        onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, text: e.target.value } })}
                      />
                    </div>
                  </Field>
                </div>
              </div>

              <div className="border-t border-line pt-4 space-y-3">
                <h3 className="text-xs font-bold uppercase text-ink-2 tracking-wider">Typography & Geometry</h3>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Font">
                    <Select
                      small
                      value={draft.theme.font}
                      onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, font: e.target.value as FormTheme['font'] } })}
                    >
                      <option value="sans">Sans (Clean)</option>
                      <option value="serif">Serif (Editorial)</option>
                      <option value="rounded">Rounded (Manga)</option>
                    </Select>
                  </Field>
                  <Field label="Corner radius">
                    <Select
                      small
                      value={draft.theme.radius}
                      onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, radius: e.target.value as FormTheme['radius'] } })}
                    >
                      <option value="sharp">Sharp (4px)</option>
                      <option value="soft">Soft (12px)</option>
                      <option value="round">Round (20px)</option>
                    </Select>
                  </Field>
                  <Field label="Page width">
                    <Select
                      small
                      value={draft.theme.width}
                      onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, width: e.target.value as FormTheme['width'] } })}
                    >
                      <option value="narrow">Narrow (520px)</option>
                      <option value="normal">Normal (680px)</option>
                      <option value="wide">Wide (860px)</option>
                    </Select>
                  </Field>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Settings */}
          {activeTab === 'settings' && (
            <div className="p-4 space-y-5 max-h-[calc(100vh-220px)] overflow-y-auto text-xs">
              <div>
                <h2 className="text-sm font-bold text-ink">Form Settings</h2>
                <p className="text-xs text-ink-2 mb-3">Configure limits, buyer requirements, and convention pickup days.</p>
              </div>

              <div className="space-y-3">
                <Field label="Form title (Staff & Meta)">
                  <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} small />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Max quantity per row">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={draft.settings.maxQtyPerLine}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          settings: { ...draft.settings, maxQtyPerLine: Math.max(1, Number(e.target.value) || 20) },
                        })
                      }
                      small
                    />
                  </Field>

                  <div className="pt-5 space-y-1">
                    <Checkbox
                      label="Require buyer phone (WhatsApp)"
                      checked={draft.settings.requirePhone}
                      onChange={(e) =>
                        setDraft({ ...draft, settings: { ...draft.settings, requirePhone: e.target.checked } })
                      }
                    />
                    <Checkbox
                      label="Require buyer email"
                      checked={draft.settings.requireEmail}
                      onChange={(e) =>
                        setDraft({ ...draft, settings: { ...draft.settings, requireEmail: e.target.checked } })
                      }
                    />
                  </div>
                </div>

                {/* Pickup Days Editor */}
                <div className="border border-line rounded-lg p-3 bg-cream/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink">Event Pickup Days</span>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          settings: { ...draft.settings, pickupDays: pickupDaysFor(event) },
                        })
                      }
                    >
                      Reset from event dates
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    {draft.settings.pickupDays.map((d, i) => (
                      <div key={i} className="flex gap-1.5 items-center">
                        <Input
                          small
                          value={d}
                          onChange={(e) => {
                            const next = [...draft.settings.pickupDays];
                            next[i] = e.target.value;
                            setDraft({ ...draft, settings: { ...draft.settings, pickupDays: next } });
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = draft.settings.pickupDays.filter((_, idx) => idx !== i);
                            setDraft({ ...draft, settings: { ...draft.settings, pickupDays: next } });
                          }}
                          className="p-1 text-red-500 hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      onClick={() => {
                        const count = draft.settings.pickupDays.length + 1;
                        setDraft({
                          ...draft,
                          settings: {
                            ...draft.settings,
                            pickupDays: [...draft.settings.pickupDays, `Day ${count}`],
                          },
                        });
                      }}
                    >
                      + Add pickup day
                    </Button>
                  </div>
                </div>

                <Field label="Thank-you confirmation message">
                  <Textarea
                    rows={2}
                    value={draft.settings.thankYouMessage}
                    onChange={(e) =>
                      setDraft({ ...draft, settings: { ...draft.settings, thankYouMessage: e.target.value } })
                    }
                  />
                </Field>

                <Field label="Closed message (shown when disabled)">
                  <Textarea
                    rows={2}
                    value={draft.settings.closedMessage}
                    onChange={(e) =>
                      setDraft({ ...draft, settings: { ...draft.settings, closedMessage: e.target.value } })
                    }
                  />
                </Field>
              </div>
            </div>
          )}

          {/* Tab 4: Clone & Templates */}
          {activeTab === 'templates' && (
            <div className="p-4 space-y-5 max-h-[calc(100vh-220px)] overflow-y-auto text-xs">
              <TemplatesTabContent
                draft={draft}
                setDraft={setDraft}
                batchId={batch.id}
                batches={batches}
                events={events}
                formsById={formsById}
                templates={templates}
                me={me}
              />
            </div>
          )}
        </div>

        {/* ================= Right Column: Live Reactive Preview ================= */}
        <div className="sticky top-4 space-y-3">
          {/* Preview Toolbar */}
          <div className="bg-white border border-line rounded-lg px-4 py-2 shadow-xs flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-ink">Live Preview</span>
              {snap && (
                <Pill tone={previewSize > PUBLIC_FORM_LIMIT ? 'red' : 'neutral'}>
                  {Math.round(previewSize / 1024)} KB of {Math.round(PUBLIC_FORM_LIMIT / 1024)} KB
                </Pill>
              )}
            </div>

            <div className="flex items-center gap-1 bg-cream rounded-md p-0.5 border border-line">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                className={`px-2.5 py-1 rounded flex items-center gap-1 font-medium transition-all ${
                  viewport === 'desktop' ? 'bg-white shadow-xs text-ink font-bold' : 'text-ink-2 hover:text-ink'
                }`}
              >
                <Monitor size={13} /> Desktop
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                className={`px-2.5 py-1 rounded flex items-center gap-1 font-medium transition-all ${
                  viewport === 'mobile' ? 'bg-white shadow-xs text-ink font-bold' : 'text-ink-2 hover:text-ink'
                }`}
              >
                <Smartphone size={13} /> Mobile
              </button>
            </div>
          </div>

          {/* Preview Canvas Window */}
          <div className="flex justify-center bg-zinc-100 rounded-xl p-4 border border-line overflow-x-auto min-h-[500px]">
            <div
              className={`transition-all duration-300 w-full ${
                viewport === 'mobile' ? 'max-w-[400px] shadow-xl rounded-2xl border-4 border-zinc-700 bg-white overflow-hidden' : 'max-w-[860px]'
              }`}
            >
              {!snap ? (
                <Loading label="Rendering preview…" />
              ) : (
                <FormRenderer key={JSON.stringify(snap.blocks) + JSON.stringify(snap.theme)} form={snap} preview />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Block Modal */}
      <Modal open={isAddBlockOpen} onClose={() => setIsAddBlockOpen(false)} title="Add Block to Form">
        <div className="grid grid-cols-2 gap-2.5 text-left text-xs">
          {(
            [
              { type: 'header', title: 'Header Banner', desc: 'Title, subtitle & top image' },
              { type: 'products', title: 'Product Catalog', desc: 'Merch grid or item list' },
              { type: 'payment_instructions', title: 'Payment & QRIS', desc: 'Bank info & QRIS scan code' },
              { type: 'text', title: 'Text Note', desc: 'Announcements, booth rules, FAQs' },
              { type: 'image', title: 'Picture Banner', desc: 'Illustrations or promo posters' },
              { type: 'section', title: 'Section Title', desc: 'Heading with optional subtitle' },
              { type: 'divider', title: 'Divider Line', desc: 'Horizontal visual separator' },
              { type: 'customer', title: 'Customer Details', desc: 'Name, phone & email fields' },
              { type: 'fulfilment', title: 'Pickup or Mail', desc: 'OTS pickup days or shipping' },
              { type: 'notes', title: 'Customer Notes', desc: 'Optional notes box for buyers' },
              { type: 'submit', title: 'Submit Block', desc: 'Preorder submission & total' },
            ] as const
          ).map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => addBlock(item.type)}
              className="p-3 border border-line rounded-lg hover:border-accent hover:bg-cream/40 transition-all text-left flex flex-col gap-0.5 cursor-pointer"
            >
              <span className="font-bold text-ink">{item.title}</span>
              <span className="text-ink-2 text-[11px]">{item.desc}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Confirm Delete Block Dialog */}
      <Confirm
        open={!!blockToDelete}
        onClose={() => setBlockToDelete(null)}
        onConfirm={confirmDeleteBlock}
        title="Remove Block?"
        confirmLabel="Remove"
        danger
      >
        Are you sure you want to remove this block from the form layout?
      </Confirm>
    </div>
  );
}

// ---- Subcomponents ----

/** Inline editor for individual block types */
function BlockConfigEditor({
  block: b,
  batch,
  itemsById,
  onChange,
}: {
  block: FormBlock;
  batch: Batch;
  itemsById: Map<string, Item>;
  onChange: (patch: Partial<FormBlock>) => void;
}) {
  switch (b.type) {
    case 'header':
      return (
        <div className="space-y-2 text-xs">
          <Field label="Main title">
            <Input small value={b.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          <Field label="Subtitle">
            <Input small value={b.subtitle ?? ''} onChange={(e) => onChange({ subtitle: e.target.value })} />
          </Field>
          <Field label="Header banner picture">
            <ThumbnailInput
              value={b.imageId}
              kind="image"
              onChange={(imageId) => onChange({ imageId })}
              title="Header Image"
            />
          </Field>
        </div>
      );

    case 'products': {
      const offeredCategories: string[] = Array.from(
        new Set(
          batch.offering
            .map((e: OfferingEntry) => itemsById.get(e.itemId)?.type)
            .filter((t: string | undefined): t is string => Boolean(t && t !== 'bundle')),
        ),
      );

      return (
        <div className="space-y-3 text-xs">
          <Field label="Block section title (optional)">
            <Input small value={b.title ?? ''} placeholder="e.g. Acrylic Standees" onChange={(e) => onChange({ title: e.target.value })} />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Source filter">
              <Select
                small
                value={b.source.kind}
                onChange={(e) => {
                  const kind = e.target.value as ProductsSource['kind'];
                  if (kind === 'all') onChange({ source: { kind: 'all' } });
                  else if (kind === 'bundles') onChange({ source: { kind: 'bundles' } });
                  else if (kind === 'type') onChange({ source: { kind: 'type', type: offeredCategories[0] || '' } });
                  else if (kind === 'entries') onChange({ source: { kind: 'entries', keys: [] } });
                }}
              >
                <option value="all">All offered products</option>
                <option value="type">By item type / category</option>
                <option value="bundles">Bundles only</option>
                <option value="entries">Hand-picked specific items</option>
              </Select>
            </Field>

            <Field label="Display layout">
              <Select
                small
                value={b.layout}
                onChange={(e) => onChange({ layout: e.target.value as 'list' | 'grid' })}
              >
                <option value="list">List (rows)</option>
                <option value="grid">Grid (2-column cards)</option>
              </Select>
            </Field>
          </div>

          {b.source.kind === 'type' && (
            <Field label="Select category">
              <Select
                small
                value={b.source.type}
                onChange={(e) => onChange({ source: { kind: 'type', type: e.target.value } })}
              >
                {offeredCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {b.source.kind === 'entries' && (
            <div className="border border-line rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
              <span className="font-semibold block mb-1">Pick items to include in this block:</span>
              {batch.offering.map((e: OfferingEntry) => {
                const item = itemsById.get(e.itemId);
                if (!item) return null;
                const v = e.variantId ? item.variants?.find((v: Variant) => v.id === e.variantId) : undefined;
                const key = e.variantId ? `${e.itemId}:${e.variantId}` : e.itemId;
                const checked = (b.source as { keys: string[] }).keys.includes(key);

                return (
                  <Checkbox
                    key={key}
                    label={`${item.name}${v?.name ? ` · ${v.name}` : ''}`}
                    checked={checked}
                    onChange={(ev) => {
                      const prevKeys = (b.source as { keys: string[] }).keys;
                      const nextKeys = ev.target.checked ? [...prevKeys, key] : prevKeys.filter((k) => k !== key);
                      onChange({ source: { kind: 'entries', keys: nextKeys } });
                    }}
                  />
                );
              })}
            </div>
          )}

          <div className="flex gap-4 pt-1">
            <Checkbox
              label="Show product thumbnails"
              checked={b.showThumbnails}
              onChange={(e) => onChange({ showThumbnails: e.target.checked })}
            />
            <Checkbox
              label="Show prices"
              checked={b.showPrices}
              onChange={(e) => onChange({ showPrices: e.target.checked })}
            />
          </div>
        </div>
      );
    }

    case 'payment_instructions':
      return (
        <div className="space-y-2 text-xs">
          <Field label="Block title">
            <Input small value={b.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          <Field label="Payment instructions (e.g. Bank Account details)">
            <Textarea
              rows={3}
              value={b.text ?? ''}
              placeholder="e.g. Transfer to BCA 123456789 a.n. John Doe"
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </Field>
          <Field label="QRIS code image">
            <ThumbnailInput
              value={b.imageId}
              kind="image"
              onChange={(imageId) => onChange({ imageId })}
              title="QRIS Code Image"
            />
          </Field>
        </div>
      );

    case 'text':
      return (
        <Field label="Text content" className="text-xs">
          <Textarea rows={4} value={b.text} onChange={(e) => onChange({ text: e.target.value })} />
        </Field>
      );

    case 'section':
      return (
        <div className="space-y-2 text-xs">
          <Field label="Section title">
            <Input small value={b.title} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
          <Field label="Description (optional)">
            <Input small value={b.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} />
          </Field>
        </div>
      );

    case 'image':
      return (
        <div className="space-y-2 text-xs">
          <Field label="Image">
            <ThumbnailInput value={b.imageId} kind="image" onChange={(imageId) => onChange({ imageId: imageId || '' })} />
          </Field>
          <Field label="Caption (optional)">
            <Input small value={b.caption ?? ''} onChange={(e) => onChange({ caption: e.target.value })} />
          </Field>
          <Field label="Width">
            <Select small value={b.size} onChange={(e) => onChange({ size: e.target.value as 'full' | 'half' })}>
              <option value="full">Full width</option>
              <option value="half">Half width</option>
            </Select>
          </Field>
        </div>
      );

    default:
      return <p className="text-ink-2 text-xs">This block does not require layout configuration.</p>;
  }
}

/** Tab for fast cloning from past events and template management */
function TemplatesTabContent({
  draft,
  setDraft,
  batchId,
  batches,
  events,
  formsById,
  templates,
  me,
}: {
  draft: FormDoc;
  setDraft: (d: FormDoc) => void;
  batchId: string;
  batches: Batch[];
  events: Event[];
  formsById: Map<string, FormDoc>;
  templates: FormTemplate[];
  me: string;
}) {
  const { run } = useToast();
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  const eventMap = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const pastBatches = useMemo(
    () =>
      batches
        .filter((b) => b.id !== batchId && formsById.has(b.id))
        .map((b) => ({
          batch: b,
          event: eventMap.get(b.eventId),
          form: formsById.get(b.id)!,
        })),
    [batches, batchId, formsById, eventMap],
  );

  const cloneFromSelected = () => {
    const sourceForm = formsById.get(selectedBatchId);
    if (!sourceForm) return;
    const cloned = cloneFormFromBatch(draft, sourceForm);
    setDraft(cloned);
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    setSavingTemplate(true);
    await run(async () => {
      await saveFormAsTemplate(draft, templateName, templateDesc, false, me);
      setTemplateName('');
      setTemplateDesc('');
    }, 'Template saved to library');
    setSavingTemplate(false);
  };

  return (
    <div className="space-y-6">
      {/* 1-Click Fast Clone */}
      <div className="border border-line rounded-lg p-3 bg-cream/40 space-y-2">
        <h3 className="font-bold text-ink">1-Click Clone from Past Event</h3>
        <p className="text-ink-2">
          Copy blocks, theme, and styling from an existing event batch into this form without affecting your offering.
        </p>
        <div className="flex gap-2">
          <Select small value={selectedBatchId} onChange={(e) => setSelectedBatchId(e.target.value)} className="flex-1">
            <option value="">Select past event batch…</option>
            {pastBatches.map(({ batch: b, event: e, form }) => (
              <option key={b.id} value={b.id}>
                {e?.name ?? 'Event'} · Batch {b.number} ({form.blocks.length} blocks)
              </option>
            ))}
          </Select>
          <Button size="sm" variant="primary" disabled={!selectedBatchId} onClick={cloneFromSelected}>
            Apply Layout
          </Button>
        </div>
      </div>

      {/* Save as Template */}
      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="font-bold text-ink">Save Current Layout as Template</h3>
        <Field label="Template name">
          <Input small placeholder="e.g. Standard Convention Preorder" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <Input small placeholder="e.g. 2-column standees, comics list, QRIS at bottom" value={templateDesc} onChange={(e) => setTemplateDesc(e.target.value)} />
        </Field>
        <Button size="sm" disabled={!templateName.trim()} busy={savingTemplate} onClick={handleSaveTemplate}>
          Save as Template
        </Button>
      </div>

      {/* Saved Templates List */}
      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="font-bold text-ink">Circle Template Library ({templates.length})</h3>
        {templates.length === 0 ? (
          <p className="hint">No saved templates yet. Save one above to reuse across batches.</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="p-2.5 border border-line rounded-lg flex items-center justify-between gap-2 bg-white">
                <div>
                  <div className="font-bold text-ink flex items-center gap-1.5">
                    {t.name} {t.isDefault && <Pill tone="blue">Default</Pill>}
                  </div>
                  {t.description && <p className="text-ink-2 text-[11px]">{t.description}</p>}
                  <span className="text-[10px] text-ink-2 block mt-0.5">{t.blocks.length} blocks</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" onClick={() => setDraft(applyTemplateToForm(draft, t))}>
                    Apply
                  </Button>
                  <button
                    type="button"
                    onClick={() => templateRepo.remove(t.id)}
                    className="p-1 text-red-500 hover:text-red-700 cursor-pointer"
                    title="Delete template"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <QueryPage>
      <FormStudio />
    </QueryPage>
  );
}
