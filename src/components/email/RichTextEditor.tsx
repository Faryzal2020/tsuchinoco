'use client';

import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Quote,
  Link2,
  Unlink,
  Minus,
  RotateCcw,
  RotateCw,
  RemoveFormatting,
  Code,
  Tag,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { Modal } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const MERGE_TAGS = [
  { label: 'Customer Name', tag: '{{name}}', hint: 'e.g. Alice' },
  { label: 'Customer Email', tag: '{{email}}', hint: 'e.g. alice@example.com' },
  { label: 'Event Name', tag: '{{event}}', hint: 'e.g. Comic Frontier 19' },
  { label: 'Batch Name', tag: '{{batch}}', hint: 'e.g. Batch 1' },
  { label: 'Order / ID', tag: '{{orderNumber}}', hint: 'e.g. CF19_B1_001' },
];

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Draft your email body here…',
  disabled = false,
}: RichTextEditorProps) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-blue-600 underline font-medium hover:text-blue-800',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Keep editor content in sync if value changed externally
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  if (!editor) return null;

  const insertTag = (tag: string) => {
    editor.chain().focus().insertContent(tag).run();
  };

  const openLinkModal = () => {
    const previousUrl = editor.getAttributes('link').href || '';
    setLinkUrl(previousUrl);
    setLinkModalOpen(true);
  };

  const applyLink = () => {
    if (!linkUrl.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const href = linkUrl.startsWith('http://') || linkUrl.startsWith('https://') || linkUrl.startsWith('mailto:')
        ? linkUrl
        : `https://${linkUrl}`;
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setLinkModalOpen(false);
    setLinkUrl('');
  };

  const removeLink = () => {
    editor.chain().focus().unsetLink().run();
    setLinkModalOpen(false);
    setLinkUrl('');
  };

  return (
    <div className="border border-line rounded-xl overflow-hidden bg-white shadow-2xs focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
      {/* Sticky Formatting Toolbar */}
      <div className="p-2 border-b border-line bg-surface-2/60 flex flex-wrap items-center gap-1">
        {/* Headings */}
        <select
          className="select select-sm text-xs w-[120px] h-8 py-0 px-2 font-medium bg-white"
          value={
            editor.isActive('heading', { level: 1 })
              ? 'h1'
              : editor.isActive('heading', { level: 2 })
              ? 'h2'
              : editor.isActive('heading', { level: 3 })
              ? 'h3'
              : 'p'
          }
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'p') editor.chain().focus().setParagraph().run();
            if (v === 'h1') editor.chain().focus().toggleHeading({ level: 1 }).run();
            if (v === 'h2') editor.chain().focus().toggleHeading({ level: 2 }).run();
            if (v === 'h3') editor.chain().focus().toggleHeading({ level: 3 }).run();
          }}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <div className="w-[1px] h-5 bg-line mx-0.5" />

        {/* Text styling */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('bold') ? 'bg-cream-2 text-blue-700 font-bold' : 'text-ink-2'
          }`}
          title="Bold (Ctrl+B)"
        >
          <Bold className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('italic') ? 'bg-cream-2 text-blue-700 font-bold' : 'text-ink-2'
          }`}
          title="Italic (Ctrl+I)"
        >
          <Italic className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('underline') ? 'bg-cream-2 text-blue-700 font-bold' : 'text-ink-2'
          }`}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('strike') ? 'bg-cream-2 text-blue-700 font-bold' : 'text-ink-2'
          }`}
          title="Strikethrough"
        >
          <Strikethrough className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('code') ? 'bg-cream-2 text-blue-700 font-bold' : 'text-ink-2'
          }`}
          title="Code format"
        >
          <Code className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-line mx-0.5" />

        {/* Alignment */}
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive({ textAlign: 'left' }) ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
          }`}
          title="Align Left"
        >
          <AlignLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive({ textAlign: 'center' }) ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
          }`}
          title="Align Center"
        >
          <AlignCenter className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive({ textAlign: 'right' }) ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
          }`}
          title="Align Right"
        >
          <AlignRight className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-line mx-0.5" />

        {/* Lists & Quotes */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('bulletList') ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
          }`}
          title="Bullet List"
        >
          <List className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('orderedList') ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
          }`}
          title="Numbered List"
        >
          <ListOrdered className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('blockquote') ? 'bg-cream-2 text-blue-700' : 'text-ink-2'
          }`}
          title="Blockquote"
        >
          <Quote className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="p-1.5 rounded hover:bg-cream-2 text-ink-2 transition-colors"
          title="Divider Line"
        >
          <Minus className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-line mx-0.5" />

        {/* Links */}
        <button
          type="button"
          onClick={openLinkModal}
          className={`p-1.5 rounded hover:bg-cream-2 transition-colors ${
            editor.isActive('link') ? 'bg-blue-100 text-blue-700' : 'text-ink-2'
          }`}
          title="Insert Link"
        >
          <Link2 className="w-4 h-4" />
        </button>

        {editor.isActive('link') && (
          <button
            type="button"
            onClick={removeLink}
            className="p-1.5 rounded hover:bg-red-50 text-red-600 transition-colors"
            title="Remove Link"
          >
            <Unlink className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          className="p-1.5 rounded hover:bg-cream-2 text-ink-2 transition-colors"
          title="Clear Formatting"
        >
          <RemoveFormatting className="w-4 h-4" />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
            className="p-1.5 rounded hover:bg-cream-2 text-ink-2 disabled:opacity-30 transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
            className="p-1.5 rounded hover:bg-cream-2 text-ink-2 disabled:opacity-30 transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Dynamic Personalization Tags Bar */}
      <div className="px-3 py-2 bg-cream-2/50 border-b border-line flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-ink-2 font-semibold flex items-center gap-1 mr-1">
          <Tag className="w-3.5 h-3.5 text-blue-600" />
          Insert Variable:
        </span>
        {MERGE_TAGS.map((mt) => (
          <button
            key={mt.tag}
            type="button"
            onClick={() => insertTag(mt.tag)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-line text-ink hover:border-blue-400 hover:bg-blue-50/60 transition-colors cursor-pointer text-xs font-mono font-medium"
            title={mt.hint}
          >
            <span>+</span>
            <span>{mt.tag}</span>
          </button>
        ))}
      </div>

      {/* Editor Content Area */}
      <div className="p-4 min-h-[320px] max-h-[550px] overflow-y-auto">
        <EditorContent editor={editor} className="tiptap-email-prose" />
      </div>

      {/* Link Modal */}
      {linkModalOpen && (
        <Modal
          open={linkModalOpen}
          onClose={() => setLinkModalOpen(false)}
          title={editor.isActive('link') ? 'Edit Link' : 'Insert Link'}
          footer={
            <div className="flex justify-between w-full">
              {editor.isActive('link') ? (
                <Button variant="danger" size="sm" onClick={removeLink}>
                  Remove Link
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="quiet" size="sm" onClick={() => setLinkModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={applyLink}>
                  Save Link
                </Button>
              </div>
            </div>
          }
        >
          <Field label="URL Address" hint="e.g. https://instagram.com/yourcircle or https://yourlink.com">
            <Input
              autoFocus
              type="url"
              placeholder="https://..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
              }}
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}
