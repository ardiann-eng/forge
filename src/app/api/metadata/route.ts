import { NextResponse } from 'next/server';
import sharp from 'sharp';
import type { Hex } from 'viem';
import { checkOrigin, authorizeUpload } from '@/lib/server/upload-auth';
import { boundedBody, tokenMetadataSchema, pin } from '@/lib/server/metadata';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    if (!process.env.PINATA_JWT)
      return NextResponse.json({ error: 'IPFS storage is not configured.' }, { status: 503 });
    checkOrigin(request);
    const form = await boundedBody(request);
    const metadata = tokenMetadataSchema.parse(
      Object.fromEntries(
        ['name', 'ticker', 'description', 'twitter', 'telegram', 'website'].map((k) => [k, form.get(k) || '']),
      ),
    );
    const image = form.get('image');
    if (
      !(image instanceof File) ||
      image.size === 0 ||
      image.size > 5 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(image.type)
    )
      throw new Error('Use a PNG, JPG or WEBP image up to 5 MB.');
    await authorizeUpload(
      String(form.get('challenge') || ''),
      String(form.get('address') || ''),
      String(form.get('signature') || '') as Hex,
    );
    const bytes = await sharp(Buffer.from(await image.arrayBuffer()), {
      limitInputPixels: 16_000_000,
      animated: false,
    })
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer();
    const upload = new FormData();
    upload.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/webp' }), 'token.webp');
    upload.set('pinataMetadata', JSON.stringify({ name: `FORGE ${metadata.ticker}` }));
    const imageURI = await pin('pinFileToIPFS', upload);
    const metadataURI = await pin(
      'pinJSONToIPFS',
      JSON.stringify({
        pinataContent: {
          name: metadata.name,
          symbol: metadata.ticker,
          description: metadata.description,
          image: imageURI,
          external_url: metadata.twitter,
          properties: { twitter: metadata.twitter, telegram: metadata.telegram, website: metadata.website },
        },
        pinataMetadata: { name: `FORGE ${metadata.ticker} metadata` },
      }),
    );
    return NextResponse.json(
      { metadataURI, imageURI },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed.' },
      { status: 400 },
    );
  }
}
