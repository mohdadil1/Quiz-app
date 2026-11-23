import { useEffect, useState } from 'react';
import { imageUrl } from '../api/client';

/**
 * A question / option picture. With `zoomable`, tapping it opens it full-screen
 * (diagrams often have small labels); tapping again closes it.
 */
export default function Picture({ imageKey, className = '', zoomable = false, alt = 'Question picture' }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); setOpen(false); }, [imageKey]);

  if (!imageKey) return null;
  if (failed) return <div className={`picture-missing ${className}`}>Picture could not be loaded</div>;

  const img = (
    <img
      src={imageUrl(imageKey)}
      alt={alt}
      className={`picture ${className}`}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
  if (!zoomable) return img;

  return (
    <>
      <button
        type="button"
        className="picture-zoom-btn"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label="Enlarge picture"
      >
        {img}
        <span className="picture-zoom-hint" aria-hidden="true">⤢</span>
      </button>
      {open && (
        <div
          className="picture-lightbox"
          role="dialog"
          aria-label="Enlarged picture"
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
        >
          <img src={imageUrl(imageKey)} alt={alt} draggable={false} />
          <span className="picture-lightbox-close">Tap anywhere to close</span>
        </div>
      )}
    </>
  );
}
