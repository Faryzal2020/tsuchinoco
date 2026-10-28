'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useData, useEventOrders } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { usePrefs } from '@/lib/prefs';
import { useToast } from '@/components/ui/Toast';
import { fx } from '@/lib/functions';
import { logActivity, settingsRepo } from '@/lib/repo';
import type { EmailRecipient, EmailTemplate } from '@/types';
import Button from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';
import RichTextEditor from '@/components/email/RichTextEditor';
import {
  Mail,
  Send,
  Users,
  FileSpreadsheet,
  Settings as SettingsIcon,
  AlertCircle,
  Eye,
  Edit3,
  Smartphone,
  Monitor,
  Search,
  Sparkles,
  Info,
  Trash2,
  ExternalLink,
  Plus,
  Check,
  X,
  FolderOpen,
  Save,
} from 'lucide-react';

const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'preset_pickup',
    name: 'Preorder Ready for Pickup',
    subject: '[{{event}}] Your preorder is ready for pickup! ({{orderNumber}})',
    html: `<h1>Hello {{name}}!</h1>
<p>Thank you for preordering with us for <strong>{{event}}</strong>. We are pleased to announce that your items have been prepared and are ready for collection!</p>
<blockquote>
<p><strong>Order Number:</strong> {{orderNumber}}<br/><strong>Batch:</strong> {{batch}}<br/><strong>Pickup Location:</strong> Booth Area / Circle Table</p>
</blockquote>
<p>When collecting your order, please present your <strong>Order Number ({{orderNumber}})</strong> or your name (<strong>{{name}}</strong>) to our staff at the booth.</p>
<hr/>
<p>If you have any questions or someone else is collecting on your behalf, please reply directly to this email.</p>
<p>See you at the event!<br/><em>Tsuchinoco Circle Team</em></p>`,
  },
  {
    id: 'preset_shipped',
    name: 'Order Shipped Notice',
    subject: '[{{event}}] Your order has been dispatched!',
    html: `<h1>Good news, {{name}}!</h1>
<p>Your mail-order from <strong>{{event}}</strong> (Order: <strong>{{orderNumber}}</strong>) has been packed and handed over to the courier service.</p>
<p>Please allow 2–5 business days for standard delivery depending on your location.</p>
<hr/>
<p>Thank you again for supporting our circle! If you have any questions or package issues, feel free to contact us.</p>
<p>Best regards,<br/><em>Tsuchinoco Circle Team</em></p>`,
  },
  {
    id: 'preset_announcement',
    name: 'Event Announcement & Schedule',
    subject: '[{{event}}] Visit our booth at {{event}}!',
    html: `<h1>Hi {{name}}!</h1>
<p>We're thrilled to share our catalogue and booth schedule for the upcoming <strong>{{event}}</strong>!</p>
<p>Be sure to stop by our booth to check out our newest merchandise, artbooks, and exclusive event freebies.</p>
<hr/>
<p>Looking forward to meeting you there!<br/><em>Tsuchinoco Circle Team</em></p>`,
  },
  {
    id: 'preset_blank',
    name: 'Blank Draft',
    subject: '',
    html: '<p>Write your message here…</p>',
  },
];

export default function EmailBroadcastPage() {
  const { events, batches, settings } = useData();
  const { me, meName } = useAuth();
  const { currentEventId, setCurrentEventId } = usePrefs();
  const { run, error, toast } = useToast();

  // Selected event
  const [selectedEventId, setSelectedEventId] = useState<string>(currentEventId || events[0]?.id || '');
  useEffect(() => {
    if (!selectedEventId && (currentEventId || events[0]?.id)) {
      setSelectedEventId(currentEventId || events[0]?.id || '');
    }
  }, [currentEventId, events, selectedEventId]);

  const activeEvent = useMemo(() => events.find((e) => e.id === selectedEventId), [events, selectedEventId]);

  // Batches of the selected event
  const eventBatches = useMemo(
    () => batches.filter((b) => b.eventId === selectedEventId).sort((a, b) => a.number - b.number),
    [batches, selectedEventId]
  );

  // Orders for the selected event
  const { orders: eventOrders } = useEventOrders(selectedEventId || undefined);

  // Recipient selection states
  const [recipientTab, setRecipientTab] = useState<'batches' | 'custom'>('batches');
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);

  // When batches load or event changes, select all batches by default
  useEffect(() => {
    if (eventBatches.length > 0) {
      setSelectedBatchIds(eventBatches.map((b) => b.id));
    } else {
      setSelectedBatchIds([]);
    }
  }, [selectedEventId, eventBatches]);

  // Filters for batch customers table
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [customerSearch, setCustomerSearch] = useState('');
  const [unselectedOrderIds, setUnselectedOrderIds] = useState<Set<string>>(new Set());

  // Custom spreadsheet pasted text
  const [customText, setCustomText] = useState('');
  const [customRecipients, setCustomRecipients] = useState<{ email: string; name: string }[]>([]);
  const [customInputError, setCustomInputError] = useState('');

  // Email Templates
  const templates: EmailTemplate[] = useMemo(() => {
    if (settings.emailTemplates && settings.emailTemplates.length > 0) {
      return settings.emailTemplates;
    }
    return DEFAULT_EMAIL_TEMPLATES;
  }, [settings.emailTemplates]);

  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null);

  // Close active mobile template actions when clicking outside
  useEffect(() => {
    if (!activeTemplateId) return;
    const handleWindowClick = () => setActiveTemplateId(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, [activeTemplateId]);

  // Email Composer states
  const [fromName, setFromName] = useState(settings.resendFromName || 'Tsuchinoco Studio');
  const [fromEmail, setFromEmail] = useState(settings.resendFromEmail || 'onboarding@resend.dev');
  const [replyTo, setReplyTo] = useState(settings.resendReplyTo || '');
  const [subject, setSubject] = useState('[{{event}}] Notice regarding your preorder');
  const [htmlContent, setHtmlContent] = useState(
    (settings.emailTemplates && settings.emailTemplates[0]?.html) || DEFAULT_EMAIL_TEMPLATES[0].html
  );

  // Editor mode & Preview
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewRecipientIndex, setPreviewRecipientIndex] = useState(0);

  // Resend Settings Modal
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(settings.resendApiKey || '');

  // Sending progress & confirmation
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({ current: 0, total: 0 });
  const [sendSummaryModalOpen, setSendSummaryModalOpen] = useState(false);
  const [sendResults, setSendResults] = useState<{
    total: number;
    sentCount: number;
    failedCount: number;
    results: { email: string; success: boolean; id?: string; error?: string }[];
  } | null>(null);

  // Sync settings when loaded
  useEffect(() => {
    if (settings.resendApiKey) setApiKeyInput(settings.resendApiKey);
    if (settings.resendFromEmail) setFromEmail(settings.resendFromEmail);
    if (settings.resendFromName) setFromName(settings.resendFromName);
    if (settings.resendReplyTo) setReplyTo(settings.resendReplyTo);
  }, [settings]);

  // Compute customers from selected batches
  const batchCustomers = useMemo(() => {
    if (selectedBatchIds.length === 0 || eventOrders.length === 0) return [];

    const batchIdSet = new Set(selectedBatchIds);
    const batchMap = new Map(eventBatches.map((b) => [b.id, b]));

    // Filter orders matching selected batches
    const matchingOrders = eventOrders.filter((o) => batchIdSet.has(o.batchId));

    // Deduplicate by customer email
    const byEmail = new Map<string, EmailRecipient>();

    for (const o of matchingOrders) {
      const email = (o.customer?.email ?? '').trim().toLowerCase();
      if (!email || !email.includes('@')) continue;

      const batch = batchMap.get(o.batchId);
      const batchName = batch ? `Batch ${batch.number}` : 'Batch';

      if (!byEmail.has(email)) {
        byEmail.set(email, {
          id: o.id,
          email,
          name: (o.customer?.name ?? '').trim() || 'Customer',
          batchId: o.batchId,
          batchName,
          orderId: o.id,
          transactionId: o.transactionId || o.id,
          status: o.status,
          fulfilment: o.fulfilment,
          source: 'batch',
        });
      }
    }

    return Array.from(byEmail.values());
  }, [selectedBatchIds, eventOrders, eventBatches]);

  // Filtered batch customers according to status and search
  const filteredBatchCustomers = useMemo(() => {
    return batchCustomers.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (customerSearch.trim()) {
        const q = customerSearch.toLowerCase();
        const matchName = (c.name || '').toLowerCase().includes(q);
        const matchEmail = c.email.toLowerCase().includes(q);
        const matchTid = (c.transactionId || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchTid) return false;
      }
      return true;
    });
  }, [batchCustomers, statusFilter, customerSearch]);

  // Parse custom spreadsheet / pasted text
  const parseCustomText = (text: string) => {
    setCustomInputError('');
    if (!text.trim()) {
      setCustomRecipients([]);
      return;
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: { email: string; name: string }[] = [];
    const seenEmails = new Set<string>();

    for (const line of lines) {
      // Check for tabs (Excel / Google Sheets paste: Name \t Email or Email \t Name)
      if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim());
        const emailIndex = parts.findIndex((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
        if (emailIndex !== -1) {
          const email = parts[emailIndex].toLowerCase();
          const name = parts.find((_, i) => i !== emailIndex) || '';
          if (!seenEmails.has(email)) {
            seenEmails.add(email);
            parsed.push({ email, name });
          }
          continue;
        }
      }

      // Check for CSV format: Name, Email
      if (line.includes(',')) {
        const parts = line.split(',').map((p) => p.trim().replace(/^["']|["']$/g, ''));
        const emailIndex = parts.findIndex((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
        if (emailIndex !== -1) {
          const email = parts[emailIndex].toLowerCase();
          const name = parts.find((_, i) => i !== emailIndex) || '';
          if (!seenEmails.has(email)) {
            seenEmails.add(email);
            parsed.push({ email, name });
          }
          continue;
        }
      }

      // Check for Name <email@example.com> format
      const bracketMatch = line.match(/^([^<]+)<([^>]+)>$/);
      if (bracketMatch) {
        const name = bracketMatch[1].trim();
        const email = bracketMatch[2].trim().toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !seenEmails.has(email)) {
          seenEmails.add(email);
          parsed.push({ email, name });
          continue;
        }
      }

      // Check if line is just a bare email
      const cleaned = line.replace(/^[<"']|[>"']$/g, '').trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) && !seenEmails.has(cleaned)) {
        seenEmails.add(cleaned);
        parsed.push({ email: cleaned, name: '' });
      }
    }

    setCustomRecipients(parsed);
    if (parsed.length === 0 && text.trim().length > 0) {
      setCustomInputError('No valid email addresses found in the pasted content.');
    }
  };

  // Total active recipients to be sent
  const activeRecipients: EmailRecipient[] = useMemo(() => {
    const list: EmailRecipient[] = [];
    const seen = new Set<string>();

    if (recipientTab === 'batches') {
      for (const c of filteredBatchCustomers) {
        if (!unselectedOrderIds.has(c.id || c.email)) {
          seen.add(c.email);
          list.push(c);
        }
      }
    } else {
      for (const r of customRecipients) {
        if (!seen.has(r.email)) {
          seen.add(r.email);
          list.push({
            email: r.email,
            name: r.name || 'Recipient',
            source: 'custom',
          });
        }
      }
    }

    return list;
  }, [recipientTab, filteredBatchCustomers, unselectedOrderIds, customRecipients]);

  // Toggle individual batch customer checkbox
  const toggleCustomer = (idOrEmail: string) => {
    setUnselectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(idOrEmail)) next.delete(idOrEmail);
      else next.add(idOrEmail);
      return next;
    });
  };

  // Toggle select all filtered batch customers
  const toggleSelectAllFiltered = () => {
    const allFilteredKeys = filteredBatchCustomers.map((c) => c.id || c.email);
    const allSelected = allFilteredKeys.every((k) => !unselectedOrderIds.has(k));

    setUnselectedOrderIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allFilteredKeys.forEach((k) => next.add(k));
      } else {
        allFilteredKeys.forEach((k) => next.delete(k));
      }
      return next;
    });
  };

  // Template Actions
  const handleLoadTemplate = (template: EmailTemplate) => {
    setSubject(template.subject);
    setHtmlContent(template.html);
    toast(`Loaded template: ${template.name}`);
  };

  const handleSaveToTemplate = async (template: EmailTemplate) => {
    const updated = templates.map((t) =>
      t.id === template.id
        ? { ...t, subject, html: htmlContent, updatedAt: Date.now() }
        : t
    );
    await run(
      () => settingsRepo.save({ ...settings, emailTemplates: updated }, me),
      `Saved current setup to "${template.name}"`
    );
  };

  const handleCreateTemplate = async () => {
    const trimmed = newTemplateName.trim();
    if (!trimmed) {
      error('Please enter a template name.');
      return;
    }
    const newTmpl: EmailTemplate = {
      id: `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      subject,
      html: htmlContent,
      updatedAt: Date.now(),
    };
    const updated = [...templates, newTmpl];
    await run(
      () => settingsRepo.save({ ...settings, emailTemplates: updated }, me),
      `Template "${trimmed}" saved!`
    );
    setIsAddingTemplate(false);
    setNewTemplateName('');
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    const updated = templates.filter((t) => t.id !== templateId);
    await run(
      () => settingsRepo.save({ ...settings, emailTemplates: updated }, me),
      `Deleted template "${templateName}"`
    );
  };

  // Save Resend API settings to global circle settings
  const saveApiSettings = async () => {
    await run(
      () =>
        settingsRepo.save(
          {
            ...settings,
            resendApiKey: apiKeyInput.trim(),
            resendFromEmail: fromEmail.trim(),
            resendFromName: fromName.trim(),
            resendReplyTo: replyTo.trim(),
          },
          me
        ),
      'Resend settings saved'
    );
    setSettingsModalOpen(false);
  };

  // Generate rendered HTML for preview or sending
  const getRenderedContent = (rawHtml: string, rawSubject: string, recipient?: EmailRecipient) => {
    const vars: Record<string, string> = {
      name: recipient?.name || 'Valued Customer',
      email: recipient?.email || 'customer@example.com',
      event: activeEvent?.name || 'Event',
      batch: recipient?.batchName || 'Preorder Batch',
      orderNumber: recipient?.transactionId || 'CF_B1_001',
    };

    let body = rawHtml;
    let subj = rawSubject;

    for (const [k, v] of Object.entries(vars)) {
      const re = new RegExp(`{{\\s*${k}\\s*}}`, 'gi');
      body = body.replace(re, v);
      subj = subj.replace(re, v);
    }

    return { body, subj };
  };

  // Send a single test email to the current staff user
  const sendTestEmail = async () => {
    const staffEmail = me.includes('@') ? me : '';
    if (!staffEmail) {
      error('Your staff login does not have a valid email address.');
      return;
    }

    const apiKey = settings.resendApiKey || apiKeyInput.trim();
    if (!apiKey) {
      error('Please configure your Resend API Key first in Settings.');
      setSettingsModalOpen(true);
      return;
    }

    const sampleRecipient: EmailRecipient = activeRecipients[0] || {
      email: staffEmail,
      name: meName || 'Staff Member',
      batchName: 'Batch 1',
      transactionId: 'TEST_001',
      source: 'custom',
    };

    const { body: testBody, subj: testSubj } = getRenderedContent(htmlContent, subject, sampleRecipient);

    const fromAddress = fromName.trim() ? `${fromName.trim()} <${fromEmail.trim()}>` : fromEmail.trim();

    try {
      const ok = await run(async () => {
        // Try Cloud Function callable first
        try {
          const res = await fx.sendBroadcastEmail({
            recipients: [{ email: staffEmail, name: meName || 'Staff', variables: { name: meName || 'Staff' } }],
            subject: `[TEST] ${testSubj}`,
            html: testBody,
            from: fromAddress,
            replyTo: replyTo.trim() || undefined,
            apiKey,
          });
          if (res.failedCount > 0) throw new Error(res.results[0]?.error || 'Failed to send test email');
          return true;
        } catch (fnErr: unknown) {
          // If function is not deployed yet, fallback to direct Resend API call
          console.warn('[email] Cloud function failed, attempting direct Resend call:', fnErr);
          const directRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              from: fromAddress,
              to: staffEmail,
              subject: `[TEST] ${testSubj}`,
              html: testBody,
              reply_to: replyTo.trim() || undefined,
            }),
          });
          const json = await directRes.json();
          if (!directRes.ok) throw new Error(json.message || 'Direct Resend API call failed');
          return true;
        }
      }, `Test email sent to ${staffEmail}!`);

      if (ok) {
        toast(`Check inbox at ${staffEmail}`);
      }
    } catch (e: unknown) {
      error(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Send the actual broadcast to all active recipients
  const executeBroadcast = async () => {
    if (activeRecipients.length === 0) {
      error('No recipients selected.');
      return;
    }
    const apiKey = settings.resendApiKey || apiKeyInput.trim();
    if (!apiKey) {
      error('Please configure your Resend API Key first in Settings.');
      setSettingsModalOpen(true);
      return;
    }

    setIsSending(true);
    setConfirmModalOpen(false);
    setSendProgress({ current: 0, total: activeRecipients.length });

    const fromAddress = fromName.trim() ? `${fromName.trim()} <${fromEmail.trim()}>` : fromEmail.trim();

    // Prepare recipients payload with variables
    const payloadRecipients = activeRecipients.map((r) => ({
      email: r.email,
      name: r.name,
      variables: {
        name: r.name || 'Customer',
        email: r.email,
        batch: r.batchName || 'Preorder Batch',
        event: activeEvent?.name || 'Event',
        orderNumber: r.transactionId || '',
      },
    }));

    try {
      let resultData: {
        total: number;
        sentCount: number;
        failedCount: number;
        results: { email: string; success: boolean; id?: string; error?: string }[];
      };

      try {
        // Attempt via backend Cloud Function
        const res = await fx.sendBroadcastEmail({
          recipients: payloadRecipients,
          subject,
          html: htmlContent,
          from: fromAddress,
          replyTo: replyTo.trim() || undefined,
          apiKey,
        });

        resultData = {
          total: res.total,
          sentCount: res.sentCount,
          failedCount: res.failedCount,
          results: res.results,
        };
      } catch (fnErr: unknown) {
        console.warn('[email] Backend function not accessible, executing batch client fallback:', fnErr);

        // Client-side fallback batching
        const fallbackResults: { email: string; success: boolean; id?: string; error?: string }[] = [];

        for (let i = 0; i < payloadRecipients.length; i++) {
          const r = payloadRecipients[i];
          setSendProgress({ current: i + 1, total: payloadRecipients.length });

          const { body: renderedBody, subj: renderedSubj } = getRenderedContent(
            htmlContent,
            subject,
            activeRecipients[i]
          );

          try {
            const resp = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                from: fromAddress,
                to: r.name ? `${r.name} <${r.email}>` : r.email,
                subject: renderedSubj,
                html: renderedBody,
                reply_to: replyTo.trim() || undefined,
              }),
            });
            const json = await resp.json();
            if (resp.ok) {
              fallbackResults.push({ email: r.email, success: true, id: json.id });
            } else {
              fallbackResults.push({ email: r.email, success: false, error: json.message || 'API error' });
            }
          } catch (netErr: unknown) {
            fallbackResults.push({ email: r.email, success: false, error: netErr instanceof Error ? netErr.message : 'Network error' });
          }
        }

        resultData = {
          total: payloadRecipients.length,
          sentCount: fallbackResults.filter((r) => r.success).length,
          failedCount: fallbackResults.filter((r) => !r.success).length,
          results: fallbackResults,
        };
      }

      setSendResults(resultData);
      setSendSummaryModalOpen(true);

      // Log activity to audit logs
      await logActivity(
        'email_broadcast',
        'email',
        `Broadcasted email "${subject}" to ${resultData.sentCount} recipients (${resultData.failedCount} failed)`,
        me,
        {
          entityName: `${activeEvent?.name || 'Email Broadcast'} (${resultData.sentCount} sent)`,
        }
      );

      toast(`Broadcast completed: ${resultData.sentCount} sent, ${resultData.failedCount} failed.`);
    } catch (e: unknown) {
      error(`Broadcast failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSending(false);
    }
  };

  const samplePreview = getRenderedContent(
    htmlContent,
    subject,
    activeRecipients[previewRecipientIndex] || activeRecipients[0]
  );

  return (
    <>
      <PageHeader
        title="Email Broadcast"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="quiet" onClick={() => setSettingsModalOpen(true)}>
              <SettingsIcon className="w-4 h-4 mr-1 text-ink-2" />
              Resend Settings
            </Button>
            <Button size="sm" variant="quiet" onClick={sendTestEmail} disabled={isSending}>
              <Mail className="w-4 h-4 mr-1 text-blue-600" />
              Send Test to Me
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setConfirmModalOpen(true)}
              disabled={activeRecipients.length === 0 || isSending}
            >
              <Send className="w-4 h-4 mr-1.5" />
              Send Broadcast ({activeRecipients.length})
            </Button>
          </div>
        }
      >
        <p className="hint">
          Compose and send personalized emails to event customers or custom lists using Resend.
        </p>
      </PageHeader>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Recipient Selection (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-4">
          <Panel pad={false}>
            {/* Recipient Source Tabs */}
            <div className="p-3 border-b border-line bg-surface-2/60 flex items-center justify-between">
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setRecipientTab('batches')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                    recipientTab === 'batches'
                      ? 'bg-white text-ink shadow-2xs border border-line'
                      : 'text-ink-2 hover:bg-cream-2'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  Event & Batches
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientTab('custom')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                    recipientTab === 'custom'
                      ? 'bg-white text-ink shadow-2xs border border-line'
                      : 'text-ink-2 hover:bg-cream-2'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  Custom / Spreadsheet
                </button>
              </div>

              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
                {activeRecipients.length} Recipient{activeRecipients.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* TAB 1: Event & Batches Selection */}
            {recipientTab === 'batches' && (
              <div className="p-4 space-y-4">
                {/* Event Selector */}
                <Field label="Event">
                  <Select
                    value={selectedEventId}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setCurrentEventId(e.target.value);
                    }}
                  >
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({ev.code})
                      </option>
                    ))}
                  </Select>
                </Field>

                {/* Batches Checkboxes */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-ink uppercase tracking-wide">
                      Select Batches ({selectedBatchIds.length}/{eventBatches.length})
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedBatchIds(eventBatches.map((b) => b.id))}
                        className="text-[11px] text-blue-600 hover:underline font-medium"
                      >
                        All
                      </button>
                      <span className="text-ink-3 text-xs">|</span>
                      <button
                        type="button"
                        onClick={() => setSelectedBatchIds([])}
                        className="text-[11px] text-ink-2 hover:underline font-medium"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {eventBatches.length === 0 ? (
                    <p className="text-xs text-ink-3 italic p-2 bg-cream-2/40 rounded border border-line">
                      No batches found for this event.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto p-1.5 bg-cream-2/30 rounded-lg border border-line">
                      {eventBatches.map((b) => {
                        const batchOrderCount = eventOrders.filter((o) => o.batchId === b.id).length;
                        const isChecked = selectedBatchIds.includes(b.id);
                        return (
                          <label
                            key={b.id}
                            className={`flex items-center justify-between p-2 rounded-md border transition-colors cursor-pointer text-xs ${
                              isChecked
                                ? 'bg-white border-blue-300 shadow-2xs font-medium'
                                : 'bg-surface border-line/60 opacity-75 hover:opacity-100'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedBatchIds((prev) => [...prev, b.id]);
                                  else setSelectedBatchIds((prev) => prev.filter((id) => id !== b.id));
                                }}
                                className="checkbox"
                              />
                              <span className="font-semibold text-ink">Batch {b.number}</span>
                              <span className="text-ink-2 lowercase font-normal">({b.mode})</span>
                            </div>
                            <span className="text-[11px] font-mono text-ink-2 bg-cream-2 px-1.5 py-0.5 rounded border border-line">
                              {batchOrderCount} order{batchOrderCount === 1 ? '' : 's'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Filters & Customer Table */}
                <div className="pt-2 border-t border-line space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-ink uppercase tracking-wide">
                      Customers ({filteredBatchCustomers.length})
                    </span>
                    <button
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      {filteredBatchCustomers.every((c) => !unselectedOrderIds.has(c.id || c.email))
                        ? 'Deselect all'
                        : 'Select all'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-ink-3 absolute left-2.5 top-2.5" />
                      <Input
                        small
                        placeholder="Search customer, email..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                    <Select small value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                      <option value="all">All Statuses</option>
                      <option value="awaiting_pickup">Awaiting Pickup</option>
                      <option value="collected">Collected</option>
                      <option value="awaiting_shipment">Awaiting Shipment</option>
                      <option value="shipped">Shipped</option>
                      <option value="not_collected">Not Collected</option>
                    </Select>
                  </div>

                  {/* Customer list container */}
                  <div className="max-h-[280px] overflow-y-auto border border-line rounded-lg bg-white divide-y divide-line/60">
                    {filteredBatchCustomers.length === 0 ? (
                      <div className="p-4 text-center text-xs text-ink-3 italic">
                        No customers match the selected batches and filters.
                      </div>
                    ) : (
                      filteredBatchCustomers.map((c) => {
                        const isChecked = !unselectedOrderIds.has(c.id || c.email);
                        return (
                          <div
                            key={c.id || c.email}
                            onClick={() => toggleCustomer(c.id || c.email)}
                            className={`p-2.5 flex items-center justify-between gap-2 hover:bg-cream-2/40 cursor-pointer transition-colors text-xs ${
                              isChecked ? '' : 'opacity-40 bg-cream-2/20'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCustomer(c.id || c.email)}
                                onClick={(e) => e.stopPropagation()}
                                className="checkbox shrink-0"
                              />
                              <div className="min-w-0 truncate">
                                <div className="font-semibold text-ink truncate">{c.name}</div>
                                <div className="text-ink-2 truncate text-[11px] mono">{c.email}</div>
                              </div>
                            </div>
                            <div className="shrink-0 text-right space-y-0.5">
                              <span className="mono text-[10px] text-ink-2 block">{c.transactionId}</span>
                              <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                                {c.batchName}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Custom List / Spreadsheet Paste */}
            {recipientTab === 'custom' && (
              <div className="p-4 space-y-3">
                <Field
                  label="Paste from Spreadsheet / Custom List"
                  hint="Copy & paste from Google Sheets or Excel (Name and Email columns), or one email per line."
                >
                  <Textarea
                    rows={8}
                    className="font-mono text-xs"
                    placeholder="Alice&#9;alice@example.com&#10;Bob&#9;bob@example.com&#10;carol@example.com"
                    value={customText}
                    onChange={(e) => {
                      setCustomText(e.target.value);
                      parseCustomText(e.target.value);
                    }}
                  />
                </Field>

                {customInputError && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {customInputError}
                  </p>
                )}

                {customRecipients.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-line">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-ink">
                        Parsed Recipients ({customRecipients.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomText('');
                          setCustomRecipients([]);
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Clear List
                      </button>
                    </div>

                    <div className="max-h-[220px] overflow-y-auto border border-line rounded-lg bg-white divide-y divide-line/60">
                      {customRecipients.map((r, idx) => (
                        <div key={idx} className="p-2 flex items-center justify-between text-xs">
                          <div className="truncate">
                            <span className="font-semibold text-ink mr-2">{r.name || '(No name)'}</span>
                            <span className="mono text-[11px] text-ink-2">{r.email}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const next = customRecipients.filter((_, i) => i !== idx);
                              setCustomRecipients(next);
                            }}
                            className="text-ink-3 hover:text-red-600 p-1"
                            title="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        {/* Right Column: Email Composer & Preview (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-4">
          <Panel>
            {/* Template Presets Bar */}
            <div className="mb-4 pb-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-ink-2 flex items-center gap-1 mr-1">
                  <Sparkles className="w-3.5 h-3.5 text-yellow-600" />
                  Templates:
                </span>

                {templates.map((tmpl) => {
                  const isHovered = hoveredTemplateId === tmpl.id;
                  const isActive = activeTemplateId === tmpl.id;
                  const showActions = isHovered || isActive;

                  return (
                    <div
                      key={tmpl.id}
                      className="relative inline-flex items-center group"
                      onMouseEnter={() => setHoveredTemplateId(tmpl.id)}
                      onMouseLeave={() => setHoveredTemplateId(null)}
                    >
                      <div
                        onClick={() => {
                          // Click on mobile (or desktop) toggles action buttons rather than immediately loading
                          setActiveTemplateId(isActive ? null : tmpl.id);
                        }}
                        className={`text-xs pl-2.5 pr-2 py-1 rounded-lg border flex items-center gap-1.5 transition-all select-none cursor-pointer ${
                          showActions
                            ? 'bg-cream-2 border-ink-3/50 shadow-2xs'
                            : 'bg-surface border-line text-ink hover:border-ink-3/40'
                        }`}
                        title={showActions ? undefined : tmpl.name}
                      >
                        <span className="font-medium text-ink truncate max-w-[140px] sm:max-w-[160px]">
                          {tmpl.name}
                        </span>

                        {/* Action buttons on the template button: Load and Save (icon only) */}
                        <div
                          className={`items-center gap-0.5 ${
                            showActions ? 'flex' : 'hidden sm:group-hover:flex'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadTemplate(tmpl);
                              setActiveTemplateId(null);
                            }}
                            className="p-1 rounded hover:bg-blue-100 text-blue-700 transition-colors"
                            title={`Load "${tmpl.name}"`}
                            aria-label={`Load ${tmpl.name}`}
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveToTemplate(tmpl);
                              setActiveTemplateId(null);
                            }}
                            className="p-1 rounded hover:bg-emerald-100 text-emerald-700 transition-colors"
                            title={`Save current setup to "${tmpl.name}"`}
                            aria-label={`Save current setup to ${tmpl.name}`}
                          >
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          {!tmpl.id.startsWith('preset_') && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTemplate(tmpl.id, tmpl.name);
                                setActiveTemplateId(null);
                              }}
                              className="p-1 rounded hover:bg-red-100 text-red-600 transition-colors"
                              title={`Delete "${tmpl.name}"`}
                              aria-label={`Delete ${tmpl.name}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* "+" Button to create/save current setup as new template */}
                {isAddingTemplate ? (
                  <div className="flex items-center gap-1 bg-white border border-blue-400 rounded-lg p-0.5 shadow-2xs">
                    <input
                      type="text"
                      autoFocus
                      placeholder="Template name..."
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateTemplate();
                        if (e.key === 'Escape') {
                          setIsAddingTemplate(false);
                          setNewTemplateName('');
                        }
                      }}
                      className="px-2 py-0.5 text-xs bg-transparent border-none outline-none w-32 sm:w-40 text-ink placeholder:text-ink-3"
                    />
                    <button
                      type="button"
                      onClick={handleCreateTemplate}
                      className="p-1 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                      title="Save template with current setup"
                      aria-label="Save template"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingTemplate(false);
                        setNewTemplateName('');
                      }}
                      className="p-1 rounded hover:bg-cream-2 text-ink-3 hover:text-ink transition-colors"
                      title="Cancel"
                      aria-label="Cancel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAddingTemplate(true)}
                    className="inline-flex items-center justify-center p-1.5 rounded-lg border border-dashed border-line hover:border-blue-400 bg-surface hover:bg-blue-50/50 text-ink-2 hover:text-blue-700 transition-colors"
                    title="Add new template from current setup"
                    aria-label="Add template"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* View mode toggle (Editor vs Preview) */}
              <div className="flex items-center bg-surface-2 p-0.5 rounded-lg border border-line">
                <button
                  type="button"
                  onClick={() => setViewMode('edit')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    viewMode === 'edit' ? 'bg-white shadow-2xs text-ink font-bold' : 'text-ink-2'
                  }`}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Editor
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('preview')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    viewMode === 'preview' ? 'bg-white shadow-2xs text-ink font-bold' : 'text-ink-2'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 text-blue-600" />
                  Live Preview
                </button>
              </div>
            </div>

            {/* Sender / Header fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <Field label="Sender Name" hint="Appears as 'From' display name">
                <Input
                  small
                  placeholder="e.g. Tsuchinoco Circle"
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                />
              </Field>

              <Field label="From Email" hint="Verified sender domain or onboarding@resend.dev">
                <Input
                  small
                  type="email"
                  placeholder="onboarding@resend.dev"
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                />
              </Field>

              <Field label="Reply-To (Optional)" hint="Directs customer replies to this inbox" className="sm:col-span-2">
                <Input
                  small
                  type="email"
                  placeholder="circle@gmail.com"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                />
              </Field>
            </div>

            {/* Subject Line */}
            <div className="mb-4">
              <Field label="Subject Line">
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Enter email subject line…"
                  className="font-medium text-sm"
                />
              </Field>
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-ink-2">
                <span>Insert in subject:</span>
                <button
                  type="button"
                  onClick={() => setSubject((s) => `${s} {{name}}`)}
                  className="px-1.5 py-0.5 rounded bg-cream-2 border border-line hover:border-blue-300 font-mono text-[11px]"
                >
                  + {'{{name}}'}
                </button>
                <button
                  type="button"
                  onClick={() => setSubject((s) => `${s} {{event}}`)}
                  className="px-1.5 py-0.5 rounded bg-cream-2 border border-line hover:border-blue-300 font-mono text-[11px]"
                >
                  + {'{{event}}'}
                </button>
                <button
                  type="button"
                  onClick={() => setSubject((s) => `${s} {{orderNumber}}`)}
                  className="px-1.5 py-0.5 rounded bg-cream-2 border border-line hover:border-blue-300 font-mono text-[11px]"
                >
                  + {'{{orderNumber}}'}
                </button>
              </div>
            </div>

            {/* Body Editor OR Live Preview */}
            {viewMode === 'edit' ? (
              <div className="space-y-1.5">
                <span className="label block">Email Body</span>
                <RichTextEditor value={htmlContent} onChange={setHtmlContent} />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Preview Toolbar */}
                <div className="p-2.5 rounded-lg bg-surface-2 border border-line flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">Previewing with recipient:</span>
                    <select
                      className="select select-sm text-xs py-0 h-7"
                      value={previewRecipientIndex}
                      onChange={(e) => setPreviewRecipientIndex(Number(e.target.value))}
                    >
                      {activeRecipients.length === 0 ? (
                        <option value={0}>Sample Customer</option>
                      ) : (
                        activeRecipients.map((r, i) => (
                          <option key={r.email} value={i}>
                            {r.name || r.email} ({r.email})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="flex items-center gap-1 bg-white p-0.5 rounded-md border border-line">
                    <button
                      type="button"
                      onClick={() => setPreviewDevice('desktop')}
                      className={`p-1 rounded ${
                        previewDevice === 'desktop' ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
                      }`}
                      title="Desktop view"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDevice('mobile')}
                      className={`p-1 rounded ${
                        previewDevice === 'mobile' ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
                      }`}
                      title="Mobile view"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Simulated Email Container */}
                <div
                  className={`mx-auto bg-white rounded-xl border border-line shadow-sm overflow-hidden transition-all ${
                    previewDevice === 'mobile' ? 'max-w-[380px]' : 'w-full'
                  }`}
                >
                  {/* Email header bar */}
                  <div className="p-3 bg-surface-2 border-b border-line text-xs space-y-1">
                    <div>
                      <span className="text-ink-2 font-medium">From:</span>{' '}
                      <span className="font-semibold text-ink">
                        {fromName} &lt;{fromEmail}&gt;
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-2 font-medium">To:</span>{' '}
                      <span className="text-ink font-mono text-[11px]">
                        {samplePreview.subj ? activeRecipients[previewRecipientIndex]?.email || 'customer@example.com' : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-2 font-medium">Subject:</span>{' '}
                      <span className="font-bold text-ink">{samplePreview.subj}</span>
                    </div>
                  </div>

                  {/* Rendered HTML Body */}
                  <div
                    className="p-6 prose prose-sm max-w-none tiptap-email-prose"
                    dangerouslySetInnerHTML={{ __html: samplePreview.body }}
                  />
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* Confirmation Modal before Sending */}
      {confirmModalOpen && (
        <Modal
          open={confirmModalOpen}
          onClose={() => setConfirmModalOpen(false)}
          title="Confirm Email Broadcast"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <Button variant="quiet" onClick={() => setConfirmModalOpen(false)} disabled={isSending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={executeBroadcast} disabled={isSending}>
                <Send className="w-4 h-4 mr-1.5" />
                Confirm & Send to {activeRecipients.length} Recipient{activeRecipients.length === 1 ? '' : 's'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-sm">
            <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 text-blue-900 flex items-start gap-2.5">
              <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Ready to send email broadcast</p>
                <p className="text-xs mt-0.5 text-blue-800">
                  You are about to send this email to <strong>{activeRecipients.length} recipients</strong> via Resend.
                  Each recipient will receive their personalized message with merge tags replaced.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-line bg-surface-2 space-y-1.5 text-xs">
              <div>
                <span className="text-ink-2">Subject:</span>{' '}
                <strong className="text-ink">{subject}</strong>
              </div>
              <div>
                <span className="text-ink-2">Sender:</span>{' '}
                <span className="text-ink font-mono">
                  {fromName} &lt;{fromEmail}&gt;
                </span>
              </div>
              <div>
                <span className="text-ink-2">Reply-To:</span>{' '}
                <span className="text-ink font-mono">{replyTo || '(Same as sender)'}</span>
              </div>
              <div>
                <span className="text-ink-2">Source:</span>{' '}
                <span className="font-medium text-ink">
                  {recipientTab === 'batches' ? `Event: ${activeEvent?.name}` : 'Custom / Spreadsheet List'}
                </span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Broadcast Execution & Progress Overlay Modal */}
      {isSending && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 border border-line shadow-xl w-full max-w-md text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center mx-auto animate-pulse">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-ink">Sending Email Broadcast…</h3>
              <p className="text-xs text-ink-2 mt-1">
                Please wait while your emails are dispatched through Resend.
              </p>
            </div>
            {sendProgress.total > 0 && (
              <div className="space-y-1.5">
                <div className="w-full h-2 rounded-full bg-cream-2 overflow-hidden border border-line">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300 rounded-full"
                    style={{
                      width: `${Math.round((sendProgress.current / sendProgress.total) * 100)}%`,
                    }}
                  />
                </div>
                <div className="text-xs text-ink-2 font-mono">
                  {sendProgress.current} / {sendProgress.total} sent
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Broadcast Results Summary Modal */}
      {sendSummaryModalOpen && sendResults && (
        <Modal
          open={sendSummaryModalOpen}
          onClose={() => setSendSummaryModalOpen(false)}
          title="Broadcast Report"
          footer={<Button onClick={() => setSendSummaryModalOpen(false)}>Done</Button>}
        >
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50">
                <span className="text-xs text-emerald-800 font-semibold block">Delivered / Sent</span>
                <span className="text-2xl font-bold text-emerald-700">{sendResults.sentCount}</span>
              </div>
              <div
                className={`p-3 rounded-xl border ${
                  sendResults.failedCount > 0
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-line bg-surface-2 text-ink-2'
                }`}
              >
                <span className="text-xs font-semibold block">Failed</span>
                <span className="text-2xl font-bold">{sendResults.failedCount}</span>
              </div>
            </div>

            {sendResults.failedCount > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-red-700">Failed Recipients:</span>
                <div className="max-h-[160px] overflow-y-auto border border-red-200 rounded-lg p-2 bg-red-50/50 space-y-1 text-xs">
                  {sendResults.results
                    .filter((r) => !r.success)
                    .map((r, i) => (
                      <div key={i} className="flex justify-between items-center text-xs">
                        <span className="font-mono text-ink">{r.email}</span>
                        <span className="text-red-600 italic text-[11px]">{r.error || 'Failed'}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="p-3 bg-surface-2 rounded-lg border border-line text-xs text-ink-2 space-y-1">
              <p>
                <strong>Audit Log:</strong> This broadcast has been recorded in the audit logs.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* Resend Configuration Modal */}
      {settingsModalOpen && (
        <Modal
          open={settingsModalOpen}
          onClose={() => setSettingsModalOpen(false)}
          title="Resend Settings"
          footer={
            <div className="flex justify-between w-full">
              <a
                href="https://resend.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 py-2"
              >
                Get Resend API Key <ExternalLink className="w-3 h-3" />
              </a>
              <div className="flex gap-2">
                <Button variant="quiet" onClick={() => setSettingsModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={saveApiSettings}>
                  Save Settings
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <Field
              label="Resend API Key"
              hint="Starts with re_... You can find this in your Resend Dashboard."
            >
              <Input
                type="password"
                placeholder="re_123456789..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="font-mono text-xs"
              />
            </Field>

            <Field
              label="Default Sender Email"
              hint="Use your verified domain (e.g. orders@yourdomain.com), or 'onboarding@resend.dev' for sandbox testing."
            >
              <Input
                type="email"
                placeholder="onboarding@resend.dev"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
              />
            </Field>

            <Field label="Default Sender Name" hint="Display name in recipient's inbox.">
              <Input
                placeholder="Tsuchinoco Studio"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
            </Field>

            <Field label="Default Reply-To" hint="Optional. Address customer replies will go to.">
              <Input
                type="email"
                placeholder="circle@gmail.com"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
              />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
