import React from 'react';

export default function PracticeBanner({ children, variant = 'warning' }) {
  const cls = `practice-banner practice-banner--${variant}`;
  return (
    <div className={cls} role="status">
      {children}
    </div>
  );
}
