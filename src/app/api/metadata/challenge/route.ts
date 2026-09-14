import { NextResponse } from 'next/server';
import { issueChallenge, challengeMessage } from '@/lib/server/upload-auth';
export const runtime = 'nodejs';
export async function GET() {
  try {
    if (!process.env.PINATA_JWT) throw new Error('IPFS storage is not configured.');
    const token = issueChallenge();
    return NextResponse.json(
      { token, message: challengeMessage(token) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
