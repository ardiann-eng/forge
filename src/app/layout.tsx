import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import '@fontsource-variable/dm-sans';
import './globals.css';
import { Providers } from '@/components/providers';
import { Header } from '@/components/header';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { default: 'FORGE — Your fees. Your rules.', template: '%s · FORGE' },
  description:
    'Launch a token and program where its creator fees go. Immutable fee flows, real transactions, your rules.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <Providers>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <div className="site-shell">
            <Header />
            <main id="main">{children}</main>
            <footer className="footer">
              <div className="footer-brand-col">
                <Link className="wordmark" href="/">
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
                <p className="footer-tagline">YOUR FEES. YOUR RULES.</p>
              </div>

              <div className="footer-links-col">
                <Link href="/#live">LIVE</Link>
                <Link href="/#how-it-works">HOW IT WORKS</Link>
                <Link href="/flows">FLOWS</Link>
                <Link href="/activity">ACTIVITY</Link>
                <Link href="/launch">LAUNCH</Link>
                <Link href="/status">STATUS</Link>
              </div>

              <div className="footer-chain-col">
                <span className="footer-chain-note">Built for Robinhood Chain</span>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
