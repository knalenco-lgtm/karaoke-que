import { NextResponse } from 'next/server';
import { RedisNietGeconfigureerd } from './redis';
import { CatalogusOntbreekt } from './catalog';
import { QueueError } from './queue';

/** Vertaalt bekende fouten naar een nette JSON-melding voor de client. */
export function foutRespons(error: unknown): NextResponse {
  if (error instanceof QueueError) {
    return NextResponse.json({ fout: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof RedisNietGeconfigureerd || error instanceof CatalogusOntbreekt) {
    console.error(error);
    return NextResponse.json({ fout: error.message, code: 'CONFIG' }, { status: 503 });
  }

  console.error('Onverwachte fout:', error);
  return NextResponse.json({ fout: 'Er ging iets mis. Probeer het opnieuw.' }, { status: 500 });
}

/** Leest een JSON-body en geeft een leeg object bij ongeldige invoer. */
export async function leesBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function tekst(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
