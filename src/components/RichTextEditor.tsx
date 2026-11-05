import { useEffect, useRef } from 'react';
import { countWords, cx } from '../lib/utils';

const TOOLS: { cmd: string; arg?: string; label: string; title: string; cls?: string }[] = [
  { cmd: 'bold', label: 'B', title: 'Bold (Ctrl+B)', cls: 'font-bold' },
  { cmd: 'italic', label: 'I', title: 'Italic (Ctrl+I)', cls: 'italic' },
  { cmd: 'underline', label: 'U', title: 'Underline (Ctrl+U)', cls: 'underline' },
  { cmd: 'formatBlock', arg: 'H2', label: 'H2', title: 'Heading' },
  { cmd: 'formatBlock', arg: 'H3', label: 'H3', title: 'Subheading' },
  { cmd: 'formatBlock', arg: 'P', label: '¶', title: 'Paragraph' },
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bulleted list' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
  { cmd: 'formatBlock', arg: 'BLOCKQUOTE', label: '❝', title: 'Quote' },
  { cmd: 'removeFormat', label: 'Clear', title: 'Clear formatting' },
];

/**
 * Lightweight contentEditable rich-text editor. Uncontrolled after mount:
 * `value` seeds the content; changes are reported via onChange(html, words).
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  readOnly,
  minHeight = 320,
}: {
  value: string;
  onChange?: (html: string, words: number) => void;
  placeholder?: string;
  readOnly?: boolean;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (ref.current && (!seeded.current || readOnly)) {
      ref.current.innerHTML = value;
      seeded.current = true;
    }
  }, [value, readOnly]);

  const emit = () => {
    const el = ref.current;
    if (!el || !onChange) return;
    onChange(el.innerHTML, countWords(el.innerText));
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
      {!readOnly && (
        <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800">
          {TOOLS.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.title}
              className={cx('btn-ghost btn-sm min-w-[2rem]', t.cls)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(t.cmd, t.arg)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div
        ref={ref}
        className="editor prose prose-slate max-w-none px-4 py-3 text-[15px] leading-relaxed focus:outline-none dark:prose-invert"
        style={{ minHeight }}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => {
          // paste as plain text to keep formatting clean
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
}
