'use client';

import { useEffect } from 'react';

export function SplashRemover() {
  useEffect(() => {
    const el = document.getElementById('pwa-splash');
    if (el) {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }
  }, []);

  return null;
}
