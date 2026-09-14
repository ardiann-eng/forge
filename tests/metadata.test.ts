import { it, expect } from 'vitest';
import { boundedBody, tokenMetadataSchema, validCid } from '../src/lib/server/metadata';
it('rejects javascript social links', () => {
  expect(
    tokenMetadataSchema.safeParse({
      name: 'Test',
      ticker: 'TEST',
      description: '',
      twitter: 'javascript:alert(1)',
      telegram: '',
    }).success,
  ).toBe(false);
});
it('rejects fabricated and malformed CIDs', () => {
  expect(validCid('fake-ipfs-cid')).toBe(false);
  expect(validCid('')).toBe(false);
  expect(validCid('Qm' + '1'.repeat(44))).toBe(true);
});
it('enforces streaming upload limits without trusting content-length', async () => {
  const request = new Request('http://localhost', { method: 'POST', body: 'a'.repeat(100) });
  await expect(boundedBody(request, 10)).rejects.toThrow('limit');
});
