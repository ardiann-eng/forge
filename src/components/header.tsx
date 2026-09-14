'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, ArrowUpRight } from 'lucide-react';
import { WalletButton } from './wallet';
import { ForgeDrawer } from './ui';
import { chain } from '@/lib/config';

export const nav = [
  ['Live', '/#live'],
  ['How it works', '/#how-it-works'],
  ['Flows', '/flows'],
  ['Activity', '/activity'],
] as const;

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="header-floating-container">
      <header className="header">
        <div className="header-brand-wrap">
          <Link href="/" className="wordmark" aria-label="FORGE home">
            <img
              src="/logo.png"
              alt="FORGE Logo"
              className="forge-logo-mark"
              width={34}
              height={34}
            />
            <span className="forge-brand-name">
              FORGE<span className="wordmark-dot">®</span>
            </span>
          </Link>
          {chain.testnet && (
            <span className="network-pill" title={`Connected to ${chain.name}`}>
              <span className="network-dot" />
              {chain.name.toUpperCase().replace('CHAIN', '').trim()} TESTNET
            </span>
          )}
        </div>

        <nav className="desktop-nav" aria-label="Main navigation">
          {nav.map(([name, href]) => {
            const isActive = path === href;
            return (
              <Link
                key={name}
                href={href}
                className={`nav-link ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {name}
              </Link>
            );
          })}
        </nav>

        <div className="header-actions">
          <Link className="button button-launch" href="/launch">
            <span>Launch</span>
            <ArrowUpRight size={15} />
          </Link>
          <WalletButton />
          <button
            type="button"
            className="icon-button mobile-menu"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <Menu size={20} />
          </button>
        </div>

        <ForgeDrawer title="Explore FORGE" open={open} onOpenChange={setOpen}>
          <nav className="mobile-links">
            {nav.map(([name, href]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                <span>{name}</span>
                <ArrowUpRight size={18} />
              </Link>
            ))}
            <Link href="/launch" className="mobile-launch-cta" onClick={() => setOpen(false)}>
              <span>Launch Token</span>
              <ArrowUpRight size={18} />
            </Link>
          </nav>
        </ForgeDrawer>
      </header>
    </div>
  );
}
