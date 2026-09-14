'use client';
import { useState } from 'react';
import { type Address } from 'viem';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { explorer } from '@/lib/config';

export function CaBadge({
  address,
  short = true,
  className = '',
}: {
  address: Address;
  short?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const display = short
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;

  return (
    <div className={`ca-badge-container ${className}`}>
      <span className="ca-prefix font-mono text-xs">CA</span>
      <a
        href={explorer('address', address)}
        target="_blank"
        rel="noreferrer"
        className="ca-address-link font-mono"
        title={address}
        onClick={(e) => e.stopPropagation()}
      >
        <span>{display}</span>
        <ExternalLink size={11} className="ca-ext-icon" />
      </a>
      <button
        type="button"
        onClick={copy}
        className={`ca-copy-btn ${copied ? 'is-copied' : ''}`}
        title={copied ? 'Copied to clipboard' : 'Copy contract address'}
        aria-label="Copy contract address"
      >
        {copied ? (
          <span className="ca-copied-label">
            <Check size={11} /> COPIED
          </span>
        ) : (
          <Copy size={12} />
        )}
      </button>
    </div>
  );
}
