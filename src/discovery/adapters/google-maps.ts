import { config } from '../../config.ts';
import { normalizePhone } from '../../enrich/phone.ts';
import type { Candidate } from '../../types.ts';

type Place = {
  id?: string;
  displayName?: { text?: string };
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  formattedAddress?: string;
  primaryTypeDisplayName?: { text?: string };
};

export async function searchPlaces(textQuery: string, maxResults = 20): Promise<Candidate[]> {
  if (!config.googleMapsKey) return [];
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': config.googleMapsKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.formattedAddress,places.primaryTypeDisplayName',
    },
    body: JSON.stringify({
      textQuery,
      languageCode: config.language,
      regionCode: config.region,
      maxResultCount: maxResults,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`places ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { places?: Place[] };

  return (json.places ?? []).map((p) => {
    const rawPhone = p.internationalPhoneNumber || p.nationalPhoneNumber || '';
    return {
      source: 'google-maps' as const,
      handle: p.id,
      name: p.displayName?.text ?? '',
      city: p.formattedAddress,
      website: p.websiteUri,
      phone: rawPhone ? normalizePhone(rawPhone) ?? undefined : undefined,
      rawPhone: rawPhone || undefined,
      url: p.websiteUri ?? `https://www.google.com/maps/place/?q=place_id:${p.id}`,
      meta: { primaryType: p.primaryTypeDisplayName?.text },
    };
  });
}
