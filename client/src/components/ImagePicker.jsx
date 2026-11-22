import { useRef, useState } from 'react';
import api, { imageUrl } from '../api/client';

const MAX_SIDE = 1600;            // px — plenty for a diagram on any screen
const TARGET_BYTES = 450 * 1024;  // aim for small files so a whole class loads quickly
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Shrink a picture before upload. Diagrams (PNG) stay PNG so lines stay sharp unless
 * that's too big, then WebP; photos become JPEG. Small GIFs are sent as they are.
 */
async function shrink(file) {
  if (file.type === 'image/gif' && file.size <= TARGET_BYTES) return file;
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size <= TARGET_BYTES && file.type !== 'image/gif') return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (file.type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (file.type === 'image/jpeg') return toBlob(canvas, 'image/jpeg', 0.85);
  const png = await toBlob(canvas, 'image/png');
  if (png && png.size <= TARGET_BYTES) return png;
  const webp = await toBlob(canvas, 'image/webp', 0.9);
  // Browsers without WebP encoding hand back PNG — fall back to JPEG on white
  if (webp && webp.type === 'image/webp' && webp.size < (png?.size ?? Infinity)) return webp;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return toBlob(canvas, 'image/jpeg', 0.88);
}

/**
 * "Add picture" control for a question or an option. `value` is the image key ('' for
 * none); `onChange(key)` gets the new key, or '' when removed. Pictures can be chosen,
 * dropped onto it, or pasted (Ctrl+V) while it's focused — handy for screenshots.
 */
export default function ImagePicker({ value, onChange, label = 'Add picture', compact = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dragging, setDragging] = useState(false);

  const upload = async (file) => {
    if (!file) return;
    setErr('');
    if (!ACCEPT.split(',').includes(file.type)) {
      setErr('Use a PNG, JPEG, WebP or GIF picture');
      return;
    }
    setBusy(true);
    try {
      const blob = await shrink(file);
      if (blob.size > 1.5 * 1024 * 1024) throw new Error('This picture is too large even after shrinking (max 1.5 MB)');
      const form = new FormData();
      form.append('image', blob, file.name || 'picture');
      const { data } = await api.post('/questions/images', form);
      onChange(data.key);
    } catch (e) {
      setErr(e?.response?.data?.message || e.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      upload(item.getAsFile());
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer?.files?.[0]);
  };

  return (
    <div
      className={`image-picker ${compact ? 'image-picker--compact' : ''} ${dragging ? 'is-dragging' : ''}`}
      tabIndex={0}
      onPaste={onPaste}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {value ? (
        <div className="image-picker-preview">
          <img src={imageUrl(value)} alt="" />
          <div className="image-picker-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? 'Uploading…' : 'Replace'}
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => onChange('')} disabled={busy}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="image-picker-add" onClick={() => inputRef.current?.click()} disabled={busy}>
          <span aria-hidden="true">🖼️</span> {busy ? 'Uploading…' : label}
          {!compact && <small>or drop / paste a picture here</small>}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {err && <div className="image-picker-error">{err}</div>}
    </div>
  );
}
