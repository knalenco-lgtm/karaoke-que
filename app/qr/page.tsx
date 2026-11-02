'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { gastenLink, getShow } from '@/lib/client';
import { Merk } from '@/components/Merk';

/**
 * Toont een QR-code van de eigen URL. Client-side, want de juiste URL is pas
 * bekend in de browser (lokaal, preview of productie).
 */
export default function QrPagina() {
  const [url, setUrl] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  const [fout, setFout] = useState<string | null>(null);

  const [code, setCode] = useState('');

  useEffect(() => {
    // Fase 13: de QR-code wijst naar de gastenpagina van deze show (`?s=`).
    const show = getShow();
    if (!show) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFout('Geen show gekozen. Open de QR-code vanaf de hostpagina.');
      return;
    }
    const doel = gastenLink(show);
    // De juiste URL is pas in de browser bekend.
    setCode(show);
    setUrl(doel);
    QRCode.toDataURL(doel, {
      width: 1024,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#120e18ff', light: '#ffffffff' },
    })
      .then(setDataUrl)
      .catch(() => setFout('QR-code genereren mislukt.'));
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-10 text-center">
      <Merk titel="Scan en zing" groot />
      <p className="mt-2 text-tekst/70">Richt je camera op de code om een nummer aan te vragen.</p>

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

      {code && <p className="kop verlooptekst mt-5 text-5xl tracking-[0.25em]">{code}</p>}
      <p className="mt-2 font-mono text-sm break-all text-tekst/70">{url}</p>

      {dataUrl && (
        <a
          href={dataUrl}
          download={`karaoke-qr-${code}.png`}
          className="mt-6 min-h-12 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold
                     text-tekst/80 active:bg-white/10"
        >
          Download PNG
        </a>
      )}
    </main>
  );
}
