'use client';
import { useState } from 'react';
import { useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain } from 'wagmi';
import { Wallet, ArrowUpRight, LogOut, Shield } from 'lucide-react';
import { chain } from '@/lib/config';
import { ForgeModal, ForgeAddress } from './ui';

export function WalletButton() {
  const [open, setOpen] = useState(false);
  const { address, chainId, isConnected } = useConnection();
  const { mutate: connect, isPending, error } = useConnect();
  const connectors = useConnectors();
  const { mutate: disconnect } = useDisconnect();
  const { mutate: switchChain, error: switchError } = useSwitchChain();
  const wrong = isConnected && chainId !== chain.id;

  return (
    <>
      <button
        type="button"
        className={`button button-wallet ${isConnected ? 'wallet-connected' : 'wallet-disconnected'}`}
        onClick={() => (wrong ? switchChain({ chainId: chain.id }) : setOpen(true))}
      >
        <Wallet size={16} aria-hidden />
        <span>
          {wrong
            ? 'Switch network'
            : address
              ? `${address.slice(0, 6)}…${address.slice(-4)}`
              : 'Connect'}
        </span>
      </button>

      {switchError && (
        <span className="sr-only" role="alert">
          {switchError.message}
        </span>
      )}

      <ForgeModal
        title={isConnected ? 'Connected Wallet' : 'Connect Wallet'}
        description={
          isConnected
            ? `Active on ${chain.name}`
            : 'Select an available provider to interact with FORGE.'
        }
        open={open}
        onOpenChange={setOpen}
      >
        {isConnected ? (
          <div className="wallet-modal-connected">
            <div className="connected-address-card">
              <span className="muted text-xs">CONNECTED ACCOUNT</span>
              <div className="mt-1">
                <ForgeAddress value={address} />
              </div>
            </div>

            <div className="connected-network-info">
              <div className="network-indicator-dot" />
              <span>{chain.name} ({chain.id})</span>
            </div>

            <button
              type="button"
              className="button button-secondary full"
              onClick={() => {
                disconnect({});
                setOpen(false);
              }}
            >
              <LogOut size={16} />
              <span>Disconnect Wallet</span>
            </button>
          </div>
        ) : (
          <div className="wallet-modal-connect">
            <div className="wallet-providers-list">
              {connectors.map((c) => (
                <button
                  type="button"
                  className="button button-provider full"
                  key={c.uid}
                  disabled={isPending}
                  onClick={() => connect({ connector: c }, { onSuccess: () => setOpen(false) })}
                >
                  <span>{isPending ? 'Connecting…' : c.name}</span>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>

            <div className="wallet-security-note">
              <Shield size={16} />
              <p>
                Self-custodial connection. FORGE never asks for your private keys or seed phrase.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="error-box mt-4">
            {error.message}
          </div>
        )}
      </ForgeModal>
    </>
  );
}
