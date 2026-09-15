import { z } from 'zod';
export const tokenMetadataSchema = z.object({
  name: z.string().trim().min(1).max(64),
  ticker: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z0-9]+$/),
  description: z.string().max(1000),
  twitter: z
    .string()
    .max(256)
    .refine((v) => !v || /^https:\/\/(www\.)?(x\.com|twitter\.com)\//.test(v), 'Use a full X URL.'),
  telegram: z
    .string()
    .max(256)
    .refine((v) => !v || /^https:\/\/t\.me\//.test(v), 'Use a full Telegram URL.'),
  website: z
    .string()
    .max(256)
    .refine((v) => !v || /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v), 'Use a full website URL.'),
});
export async function boundedBody(request: Request, limit = 6 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Upload is empty.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Upload exceeds 6 MB request limit.');
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { 'content-type': request.headers.get('content-type') || '' },
  }).formData();
}
export function validCid(cid: unknown): cid is string {
  return (
    typeof cid === 'string' &&
    (/^[Q][m][1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^b[a-z2-7]{20,120}$/.test(cid))
  );
}
export async function pin(endpoint: string, body: FormData | string) {
  const response = await fetch(`https://api.pinata.cloud/pinning/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PINATA_JWT}`,
      ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error('IPFS storage rejected the upload. Please retry.');
  const result = await response.json();
  if (!validCid(result.IpfsHash)) throw new Error('Storage provider returned an invalid CID.');
  return `ipfs://${result.IpfsHash}`;
}
