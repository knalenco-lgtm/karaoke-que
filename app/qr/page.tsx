'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Toont een QR-code van de eigen URL. Client-side, want de juiste URL is pas
 * bekend in de browser (lokaal, preview of productie).
 */
export default function QrPagina() {
  const [url, setUrl] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    const origin = window.location.origin;
    // De juiste URL is pas in de browser bekend.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(origin);
    QRCode.toDataURL(origin, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0a0510ff', light: '#ffffffff' },
    })
      .then(setDataUrl)
      .catch(() => setFout('QR-code genereren mislukt.'));
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-10 text-center">
      <h1 className="text-3xl font-black tracking-tight">
        Scan &amp; zing<span className="text-neon">.</span>
      </h1>
      <p className="mt-2 text-fuchsia-100/70">Richt je camera op de code om een nummer aan te vragen.</p>

      <div className="mt-7 rounded-3xl bg-white p-4">
        {dataUrl ? (
          // Data-URL van een canvas: next/image voegt hier niets toe.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt={`QR-code naar ${url}`} className="block h-64 w-64" />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center text-sm text-black/50">
            {fout ?? 'QR-code maken…'}
          </div>
        )}
      </div>

      <p className="mt-5 font-mono text-sm break-all text-fuchsia-200/70">{url}</p>

      {dataUrl && (
        <a
          href={dataUrl}
          download="karaoke-qr.png"
          className="mt-6 min-h-12 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold
                     text-fuchsia-100/80 active:bg-white/10"
        >
          Download PNG
        </a>
      )}
    </main>
  );
}
