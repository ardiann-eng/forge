import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyMessage, isAddress, type Hex } from 'viem';
import { dataDir } from './storage';
function secret() {
  const s = process.env.UPLOAD_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('Upload authentication is not configured.');
  return s;
}
function allowedOrigins(): string[] {
  const raw = process.env.APP_ORIGIN || 'http://localhost:3000';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
}
export function checkOrigin(request: Request) {
  const origin = (request.headers.get('origin') || '').replace(/\/+$/, '').toLowerCase();
  if (!origin || !allowedOrigins().includes(origin))
    throw new Error('Request origin is not allowed.');
}
export function issueChallenge() {
  const payload = Buffer.from(
    JSON.stringify({ nonce: randomBytes(24).toString('hex'), expires: Date.now() + 300_000 }),
  ).toString('base64url');
  return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function challengeMessage(token: string) {
  return `FORGE metadata upload\nOrigin: ${process.env.APP_ORIGIN || 'http://localhost:3000'}\nThis signature authorizes one metadata upload. It does not move funds.\nChallenge: ${token}`;
}
export async function authorizeUpload(token: string, address: string, signature: Hex) {
  if (!isAddress(address)) throw new Error('A connected wallet is required.');
  const [payload, mac] = token.split('.');
  if (!payload || !mac) throw new Error('Invalid upload challenge.');
  const expected = createHmac('sha256', secret()).update(payload).digest();
  const actual = Buffer.from(mac, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error('Invalid upload challenge.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (claims.expires < Date.now()) throw new Error('Upload challenge expired. Please try again.');
  if (!(await verifyMessage({ address, message: challengeMessage(token), signature })))
    throw new Error('Wallet signature could not be verified.');
  const dir = path.join(dataDir, 'upload-usage');
  await mkdir(dir, { recursive: true });
  // Atomic exclusive writes make challenge consumption and per-wallet quotas cross-process safe.
  const hash = createHash('sha256').update(token).digest('hex');
  try {
    await writeFile(path.join(dir, hash), String(Date.now()), { flag: 'wx' });
  } catch {
    throw new Error('Upload challenge already used.');
  }
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 10; i++) {
    try {
      await writeFile(path.join(dir, `${day}-${address.toLowerCase()}-${i}`), '1', { flag: 'wx' });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Daily upload limit reached. Try again tomorrow.');
}
