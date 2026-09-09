import { useEffect, useRef } from 'react';

const allowedTags = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'H1', 'H2', 'H3', 'P', 'BR', 'DIV']);

export function sanitizeRichText(value = '') {
  if (typeof document === 'undefined') return value;

  const source = String(value);
  const container = document.createElement('div');
  container.innerHTML = source.includes('<') ? source : source.replace(/\n/g, '<br>');
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  const elements = [];

  while (walker.nextNode()) elements.push(walker.currentNode);
  elements.forEach((element) => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
  });

  return container.innerHTML;
}

export default function RichTextEditor({ value, onChange, rows = 4 }) {
  const editorRef = useRef(null);

  useEffect(() => {
    if (!editorRef.current || editorRef.current === document.activeElement) return;
    const nextValue = sanitizeRichText(value);
    if (editorRef.current.innerHTML !== nextValue) editorRef.current.innerHTML = nextValue;
  }, [value]);

  const runCommand = (command, commandValue = null) => {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    onChange(editorRef.current?.innerHTML || '');
  };

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar" role="toolbar" aria-label="Question formatting">
        <button type="button" className="rich-text-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('bold')} aria-label="Bold">
          <strong>B</strong>
        </button>
        <button type="button" className="rich-text-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('italic')} aria-label="Italic">
          <em>I</em>
        </button>
        <button type="button" className="rich-text-tool" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand('underline')} aria-label="Underline">
          <u>U</u>
        </button>
        <select className="rich-text-heading" defaultValue="p" onChange={(event) => runCommand('formatBlock', event.target.value)} aria-label="Text style">
          <option value="p">Normal</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
      </div>
      <div
        ref={editorRef}
        className="form-control rich-text-content"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-min-rows={rows}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        suppressContentEditableWarning
      />
    </div>
  );
}

export function RichText({ value, className = '' }) {
  const html = sanitizeRichText(value);
  return <span className={`rich-text-output ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
