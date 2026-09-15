'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useConnection, useWalletClient, useSignMessage } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEther, isAddress, parseEther, toHex, type Address, type Hex } from 'viem';
import forwarder from '@/lib/pons/forwarder.json';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  LockKeyhole,
  Check,
  ChevronDown,
  Fuel,
} from 'lucide-react';
import {
  ForgeAddress,
  ForgeFileUpload,
  ForgeInput,
  ForgeModal,
  ForgeNumberInput,
  ForgeSelect,
  ForgeStatus,
  ForgeStepper,
  ForgeTextarea,
  ForgeTokenPreview,
  ForgeTransactionModal,
  type TransactionState,
} from './ui';
import { WalletButton } from './wallet';
import { useSystemStatus } from './data';
import {
  chain,
  forgeAutomationExecutor,
  forgeFactory,
  forgeFactoryV2,
  writesEnabled,
} from '@/lib/config';
import { destinationLabel, validateFlow, type Flow } from '@/lib/flow';
import { defaultStrategies, validateStrategies, strategyArgs } from '@/lib/strategies';
import { StrategyReview } from './strategy-editor';
import { FeeDirector } from './fee-director';
import { getLaunchConfig, prepareLaunch, launchToken } from '@/lib/pons/adapter';
import { ponsAddress } from '@/lib/pons/config';
import { tokenFromReceipt } from '@/lib/pons/events';
import {
  createRouter,
  v2Abi,
  requireFactoryV2,
  bindToken,
  factoryAbi,
  routerFromReceipt,
  getCreatorRouters,
} from '@/lib/forge/factory';
import { getRouter } from '@/lib/forge/router';
import { publicClient } from '@/lib/client';
import {
  flowNeedsAutomation,
  fundAutomation,
  getAutomationBalance,
} from '@/lib/forge/automation';

type Details = {
  name: string;
  ticker: string;
  description: string;
  twitter: string;
  telegram: string;
  developerBuy: string;
};
type StoredMetadata = { metadataURI: string; imageURI: string };
type Journal = {
  router?: Address;
  routerHash?: Hex;
  launchHash?: Hex;
  token?: Address;
  bindHash?: Hex;
  automationHash?: Hex;
};
const empty: Details = {
  name: '',
  ticker: '',
  description: '',
  twitter: '',
  telegram: '',
  developerBuy: '0',
};

export function Launch() {
  const { address, chainId } = useConnection();
  const { data: wallet } = useWalletClient();
  const { mutateAsync: signMessageAsync } = useSignMessage();
  const { data: system } = useSystemStatus();
  const queryClient = useQueryClient();
  const configs = useQuery({
    queryKey: ['pons-config'],
    queryFn: getLaunchConfig,
    staleTime: 30000,
  });
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<Details>(empty);
  const [strategies, setStrategies] = useState(defaultStrategies);
  const [flow, setFlow] = useState<Flow>([]);
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState('');
  const [metadata, setMetadata] = useState<StoredMetadata | null>(null);
  const [progress, setProgress] = useState<number>();
  const [configId, setConfigId] = useState('');
  const [journal, setJournal] = useState<Journal>({});
  const [salt, setSalt] = useState<Hex>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tx, setTx] = useState<TransactionState>({ status: 'idle' });
  const [txOpen, setTxOpen] = useState(false);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareLaunch>> | null>(null);
  const [routerReview, setRouterReview] = useState<{ gas: bigint } | null>(null);
  const [bindingReview, setBindingReview] = useState<bigint | null>(null);
  const [recovery, setRecovery] = useState<Address[]>([]);
  const [selectedRecovery, setSelectedRecovery] = useState('');
  const [automationDeposit, setAutomationDeposit] = useState('0.01');
  const [automationBalance, setAutomationBalance] = useState(0n);
  const [pipelineStep, setPipelineStep] = useState<number | null>(null);
  const [pipelineText, setPipelineText] = useState<string>('');
  const [showAdvancedManual, setShowAdvancedManual] = useState(false);

  const key = address ? `forge-launch-v2:${chain.id}:${address.toLowerCase()}` : null;

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setImage(url);
      return () => URL.revokeObjectURL(url);
    }
    setImage('');
  }, [file]);

  useEffect(() => {
    setJournal({});
    setMetadata(null);
    setPrepared(null);
    setStep(0);
    setRecovery([]);
    setFlow([]);
    if (!key) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const s = JSON.parse(saved);
        setDetails(s.details || empty);
        setFlow(s.flow || []);
        setStrategies(s.strategies || defaultStrategies());
        setMetadata(s.metadata || null);
        setSalt(s.salt);
        setConfigId(s.configId || '');
        setJournal(s.journal || {});
      }
    } catch {
      setError('Saved draft could not be restored.');
    }
  }, [key, address]);

  useEffect(() => {
    let active = true;
    if (!journal.router) {
      setAutomationBalance(0n);
      return;
    }
    getAutomationBalance(journal.router)
      .then((balance) => {
        if (active) setAutomationBalance(balance);
      })
      .catch(() => {
        if (active) setAutomationBalance(0n);
      });
    return () => {
      active = false;
    };
  }, [journal.router, journal.automationHash]);

  function save(
    j: Journal = journal,
    m: StoredMetadata | null = metadata,
    s: Hex | undefined = salt,
  ) {
    if (key)
      localStorage.setItem(
        key,
        JSON.stringify({ details, flow, strategies, metadata: m, salt: s, configId, journal: j }),
      );
  }

  function updateJournal(next: Journal) {
    setJournal(next);
    save(next);
  }

  const locked = !!journal.router || !!journal.routerHash;
  const resolvedFlow = flow.map((d) => {
    if (d.kind === 0) return { ...d, recipient: address || '' };
    if (d.kind >= 3 && !d.recipient) return { ...d, recipient: '0x0000000000000000000000000000000000000000' };
    return d;
  });
  const flowErrors = [...validateFlow(resolvedFlow, address),...validateStrategies(strategies,resolvedFlow)];
  const selectedId = configId || (configs.data?.configs[0]?.id.toString() ?? '');

  function field(k: keyof Details, value: string) {
    setDetails((d) => ({ ...d, [k]: value }));
    setMetadata(null);
    setPrepared(null);
  }

  async function run(title: string, action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Action failed.';
      setError(message);
      setTx((t) => ({ ...t, title, status: 'failed', error: message }));
    } finally {
      setBusy(false);
    }
  }

  function submitted(title: string, hash: string) {
    setTx({ title, status: 'confirming', hash });
  }

  async function upload() {
    await run('Store token metadata', async () => {
      if (!file || !address) throw new Error('Choose an image and connect your wallet.');
      const r = await fetch('/api/metadata/challenge');
      const challenge = await r.json();
      if (!r.ok) throw new Error(challenge.error);
      const signature = await signMessageAsync({ message: challenge.message });
      const form = new FormData();
      Object.entries(details).forEach(([k, v]) => form.set(k, v));
      form.set('image', file);
      form.set('challenge', challenge.token);
      form.set('signature', signature);
      form.set('address', address);
      setProgress(0);
      const result = await new Promise<StoredMetadata>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/metadata');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.min(95, Math.round((e.loaded / e.total) * 95)));
        };
        xhr.onload = () => {
          try {
            const body = JSON.parse(xhr.responseText);
            if (xhr.status !== 200) reject(new Error(body.error || 'Upload failed.'));
            else resolve(body);
          } catch {
            reject(new Error('Storage returned an invalid response.'));
          }
        };
        xhr.onerror = () => reject(new Error('Upload network error.'));
        xhr.send(form);
      });
      setMetadata(result);
      setProgress(100);
      save(journal, result);
    });
  }

  async function reviewRouter() {
    await run('Review router deployment', async () => {
      if (!wallet || !address || !metadata)
        throw new Error('Connect your wallet and store metadata first.');
      if (!system?.ready || flowErrors.length)
        throw new Error('Resolve configuration and allocation issues before deploying a router.');
      const request = {
        address: requireFactoryV2(),
        abi: v2Abi,
        functionName: 'createRouter' as const,
        args: [
          resolvedFlow.map((d) => ({ ...d, recipient: d.recipient as Address })),
          metadata.metadataURI,
          strategyArgs(strategies),
        ] as const,
        account: address,
      };
      await publicClient.simulateContract(request);
      const gas = await publicClient.estimateContractGas(request);
      setRouterReview({ gas });
    });
  }

  async function deployRouter() {
    setRouterReview(null);
    await run('Create fee router', async () => {
      if (!wallet || !address || !metadata) throw new Error('Wallet or metadata missing.');
      setTxOpen(true);
      setTx({ title: 'Create fee router', status: 'awaiting signature' });
      let next = { ...journal };
      const router = await createRouter(
        wallet,
        address,
        resolvedFlow,
        metadata.metadataURI,
        (hash) => {
          next = { ...next, routerHash: hash as Hex };
          updateJournal(next);
          submitted('Create fee router', hash);
        },
        strategies,
      );
      next = { ...next, router };
      updateJournal(next);
      setTx((t) => ({ ...t, status: 'confirmed' }));
    });
  }

  async function recover() {
    await run('Recover confirmed state', async () => {
      if (!address) throw new Error('Connect your wallet.');
      const next = { ...journal };
      if (next.routerHash) {
        const receipt = await publicClient.getTransactionReceipt({ hash: next.routerHash });
        if (receipt.status === 'reverted') {
          updateJournal({});
          throw new Error('Router deployment reverted. You can prepare it again.');
        }
        next.router = routerFromReceipt(receipt, address);
      }
      if (!next.router && selectedRecovery && isAddress(selectedRecovery))
        next.router = selectedRecovery;
      if (!next.router) throw new Error('Select a router or wait for its deployment receipt.');
      const router = await getRouter(next.router, address);
      if (router.creator.toLowerCase() !== address.toLowerCase())
        throw new Error('This router belongs to another wallet.');
      if (metadata && router.metadataURI !== metadata.metadataURI)
        throw new Error('Saved metadata differs from this router.');
      setFlow(router.flow.map((d) => ({ ...d })));
      if(router.strategies) setStrategies(router.strategies);
      let recoveredMetadata = metadata;
      if (!metadata) {
        const cid = /^ipfs:\/\/([a-zA-Z0-9]{20,120})$/.exec(router.metadataURI)?.[1];
        if (!cid) throw new Error('Router metadata URI is invalid.');
        const response = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`);
        if (!response.ok) throw new Error('Canonical IPFS metadata is temporarily unavailable.');
        const content = await response.json();
        if (
          typeof content.name !== 'string' ||
          typeof content.symbol !== 'string' ||
          typeof content.image !== 'string'
        )
          throw new Error('Canonical metadata has an invalid shape.');
        recoveredMetadata = { metadataURI: router.metadataURI, imageURI: content.image };
        setMetadata(recoveredMetadata);
        setDetails({
          name: content.name,
          ticker: content.symbol,
          description: content.description || '',
          twitter: content.properties?.twitter || '',
          telegram: content.properties?.telegram || '',
          developerBuy: '0',
        });
      }
      if (!next.launchHash) {
        const response = await fetch(`/api/recovery?router=${next.router}`);
        if (response.ok) {
          const recovered = await response.json();
          if (recovered.launch?.hash) next.launchHash = recovered.launch.hash;
        }
      }
      if (next.launchHash) {
        const receipt = await publicClient.getTransactionReceipt({ hash: next.launchHash });
        if (receipt.status === 'reverted') {
          next.launchHash = undefined;
          next.token = undefined;
          updateJournal(next);
          throw new Error('Launch reverted. Review and prepare it again.');
        }
        next.token = tokenFromReceipt(receipt, address);
      }
      if (router.token !== '0x0000000000000000000000000000000000000000') {
        next.token = router.token;
        setStep(3);
      }
      updateJournal(next);
      if (recoveredMetadata) save(next, recoveredMetadata);
    });
  }

  async function prepare() {
    await run('Prepare token launch', async () => {
      if (!wallet || !address || !metadata || !journal.router)
        throw new Error('Metadata and confirmed router are required.');
      const r = await getRouter(journal.router, address);
      if (
        r.creator.toLowerCase() !== address.toLowerCase() ||
        r.metadataURI !== metadata.metadataURI
      )
        throw new Error('Router ownership or metadata mismatch.');
      const saltValue = salt || toHex(crypto.getRandomValues(new Uint8Array(32)));
      setSalt(saltValue);
      save(journal, metadata, saltValue);
      setPrepared(
        await prepareLaunch(
          {
            ...details,
            ...metadata,
            router: journal.router,
            configId: BigInt(selectedId),
            salt: saltValue,
          },
          address,
        ),
      );
    });
  }

  async function fundAutomationGas() {
    await run('Fund automation gas', async () => {
      if (!wallet || !address || !journal.router)
        throw new Error('Create the dedicated router before funding automation.');
      if (!forgeAutomationExecutor)
        throw new Error('FORGE automation executor is not configured.');
      let amount: bigint;
      try {
        amount = parseEther(automationDeposit);
      } catch {
        throw new Error('Enter a valid automation gas deposit.');
      }
      if (amount <= 0n || amount > parseEther('1'))
        throw new Error('Automation gas deposit must be between 0 and 1 ETH.');
      setTxOpen(true);
      setTx({ title: 'Fund automation gas', status: 'awaiting signature' });
      await fundAutomation(wallet, address, journal.router, amount, (hash) => {
        updateJournal({ ...journal, automationHash: hash as Hex });
        submitted('Fund automation gas', hash);
      });
      setAutomationBalance(await getAutomationBalance(journal.router));
      setTx((current) => ({ ...current, status: 'confirmed' }));
    });
  }

  async function launch() {
    await run('Launch token', async () => {
      if (!wallet || !address || !prepared) throw new Error('Prepare and review the launch first.');
      setTxOpen(true);
      setTx({ title: 'Launch token', status: 'awaiting signature' });
      const hash = await launchToken(wallet, prepared);
      let next = { ...journal, launchHash: hash };
      updateJournal(next);
      submitted('Launch token', hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
      const token = tokenFromReceipt(receipt, address);
      next = { ...next, token };
      updateJournal(next);
      setPrepared(null);
      setTx((t) => ({ ...t, status: 'confirmed' }));
    });
  }

  async function bind() {
    await run('Review token binding', async () => {
      if (!address || !journal.router || !journal.token)
        throw new Error('Confirmed launch required.');
      const request = {
        address: await publicClient.readContract({address:journal.router,abi:[{type:'function',name:'factory',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}] as const,functionName:'factory'}),
        abi: factoryAbi,
        functionName: 'bindToken' as const,
        args: [journal.router, journal.token] as const,
        account: address,
      };
      await publicClient.simulateContract(request);
      setBindingReview(await publicClient.estimateContractGas(request));
    });
  }

  async function executeBinding() {
    setBindingReview(null);
    await run('Register token flow', async () => {
      if (!wallet || !address || !journal.router || !journal.token)
        throw new Error('Confirmed launch required.');
      setTxOpen(true);
      setTx({ title: 'Register token flow', status: 'awaiting signature' });
      await bindToken(wallet, address, journal.router, journal.token, (hash) => {
        updateJournal({ ...journal, bindHash: hash as Hex });
        submitted('Register token flow', hash);
      });
      setStep(3);
      setTx((t) => ({ ...t, status: 'confirmed' }));
      // Trigger immediate indexer sync and invalidate React Query caches
      try {
        await fetch('/api/state?refresh=1').catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['forge-state'] });
        queryClient.invalidateQueries({ queryKey: ['market-tokens-list'] });
      } catch {}
    });
  }

  async function startAutoLaunch() {
    if (!wallet || !address) throw new Error('Connect your wallet.');
    if (!file && !metadata) throw new Error('Choose an image for your token.');
    if (flowErrors.length) throw new Error(flowErrors.join(' '));

    setBusy(true);
    setError('');

    try {
      let curMetadata = metadata;
      let curJournal = { ...journal };

      // Step 1: Upload metadata if not done
      if (!curMetadata) {
        setPipelineStep(1);
        setPipelineText('1/4: Storing metadata & image on IPFS…');
        setTxOpen(true);
        setTx({ title: 'Store Token Metadata', status: 'awaiting signature' });

        const r = await fetch('/api/metadata/challenge');
        const challenge = await r.json();
        if (!r.ok) throw new Error(challenge.error || 'Failed to request upload signature.');
        const signature = await signMessageAsync({ message: challenge.message });

        const form = new FormData();
        Object.entries(details).forEach(([k, v]) => form.set(k, v));
        form.set('image', file!);
        form.set('challenge', challenge.token);
        form.set('signature', signature);
        form.set('address', address);

        setProgress(0);
        const uploadResult = await new Promise<StoredMetadata>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/metadata');
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.min(95, Math.round((e.loaded / e.total) * 95)));
          };
          xhr.onload = () => {
            try {
              const body = JSON.parse(xhr.responseText);
              if (xhr.status !== 200) reject(new Error(body.error || 'Upload failed.'));
              else resolve(body);
            } catch {
              reject(new Error('Storage returned an invalid response.'));
            }
          };
          xhr.onerror = () => reject(new Error('Upload network error.'));
          xhr.send(form);
        });

        curMetadata = uploadResult;
        setMetadata(curMetadata);
        setProgress(100);
        save(curJournal, curMetadata);
      }

      // Step 2: Deploy Fee Router if not deployed
      if (!curJournal.router) {
        setPipelineStep(2);
        setPipelineText('2/4: Deploying dedicated fee router (approve in wallet)…');
        setTxOpen(true);
        setTx({ title: 'Create Fee Router', status: 'awaiting signature' });

        const router = await createRouter(
          wallet,
          address,
          resolvedFlow,
          curMetadata.metadataURI,
          (hash) => {
            curJournal = { ...curJournal, routerHash: hash as Hex };
            updateJournal(curJournal);
            submitted('Create Fee Router', hash);
          },
          strategies,
        );

        curJournal = { ...curJournal, router };
        updateJournal(curJournal);
        save(curJournal, curMetadata);
      }

      // Step 3: Launch Token on PONS if not launched
      if (!curJournal.token) {
        setPipelineStep(3);
        setPipelineText('3/4: Launching token on PONS (approve in wallet)…');
        setTxOpen(true);
        setTx({ title: 'Launch Token', status: 'awaiting signature' });

        const saltValue = salt || toHex(crypto.getRandomValues(new Uint8Array(32)));
        setSalt(saltValue);

        const prep = await prepareLaunch(
          {
            ...details,
            ...curMetadata,
            router: curJournal.router!,
            configId: BigInt(selectedId),
            salt: saltValue,
          },
          address,
        );

        const hash = await launchToken(wallet, prep);
        curJournal = { ...curJournal, launchHash: hash };
        updateJournal(curJournal);
        submitted('Launch Token', hash);

        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
        const token = tokenFromReceipt(receipt, address);
        curJournal = { ...curJournal, token };
        updateJournal(curJournal);
        save(curJournal, curMetadata, saltValue);
      }

      // Step 4: Bind Token to Router
      setPipelineStep(4);
      setPipelineText('4/4: Binding token to fee flow (approve in wallet)…');
      setTxOpen(true);
      setTx({ title: 'Register Token Flow', status: 'awaiting signature' });

      await bindToken(wallet, address, curJournal.router!, curJournal.token!, (hash) => {
        curJournal = { ...curJournal, bindHash: hash as Hex };
        updateJournal(curJournal);
        submitted('Register Token Flow', hash);
      });

      setStep(3);
      setTx({ title: 'Token Live', status: 'confirmed' });

      try {
        await fetch('/api/state?refresh=1').catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['forge-state'] });
        queryClient.invalidateQueries({ queryKey: ['market-tokens-list'] });
      } catch {}
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Launch pipeline interrupted.';
      setError(message);
      setTx((t) => ({ ...t, status: 'failed', error: message }));
    } finally {
      setBusy(false);
      setPipelineStep(null);
      setPipelineText('');
    }
  }

  const canWrite = !!wallet && chainId === chain.id && writesEnabled && !busy;
  const needsAutomation = flowNeedsAutomation(resolvedFlow);
  const automationReady = !needsAutomation || automationBalance > 0n;

  return (
    <div className="launch-page-container">
      <div className="launch-top-nav">
        <Link className="back-link" href="/">
          <ArrowLeft size={16} />
          <span>Back to FORGE</span>
        </Link>
      </div>

      <div className="launch-heading-block">
        <div className="launch-eyebrow">
          <span className="lime-dot" />
          <span>{step === 3 ? 'DEPLOYMENT COMPLETED' : 'TOKEN CONFIGURATOR'}</span>
        </div>
        <h1 className="launch-title">
          {step === 3 ? 'TOKEN LIVE.' : 'FORGE SOMETHING.'}
        </h1>
        <p className="launch-subtitle">
          {step === 0 && 'Enter token parameters and visual identity to start.'}
          {step === 1 && 'Choose what every creator-fee dollar should do.'}
          {step === 2 && 'Review transactions and sign on Robinhood Chain.'}
          {step === 3 && 'Your token and fee flow are confirmed and active on-chain.'}
        </p>
      </div>

      <ForgeStepper step={step} onStepClick={(s) => s < step && setStep(s)} />

      <div className="launch-workspace-grid">
        {/* LEFT MAIN FORM PANEL */}
        <div className="launch-main-panel">
          {/* STEP 0: TOKEN DETAILS */}
          {step === 0 && (
            <form
              className="launch-form-step"
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                save();
                setStep(1);
              }}
            >
              <div className="form-step-header">
                <div>
                  <span className="step-tag">STAGE 01</span>
                  <h2>Token Details</h2>
                </div>
                <span className="step-stage-indicator">1 OF 3</span>
              </div>

              <fieldset disabled={locked || busy} className="form-fields-group">
                <ForgeFileUpload
                  file={file}
                  onChange={(f) => {
                    setFile(f);
                    setMetadata(null);
                  }}
                  progress={progress}
                />

                <div className="two-col-fields">
                  <ForgeInput
                    label="Token name"
                    placeholder="e.g. Hood Cat"
                    value={details.name}
                    onChange={(e) => field('name', e.target.value)}
                    required
                    maxLength={64}
                  />
                  <ForgeInput
                    label="Ticker"
                    prefix="$"
                    placeholder="HOOD"
                    value={details.ticker}
                    counter={`${details.ticker.length} / 10`}
                    onChange={(e) => field('ticker', e.target.value.toUpperCase())}
                    required
                    pattern="[A-Za-z0-9]+"
                    maxLength={10}
                  />
                </div>

                <ForgeTextarea
                  label="Description"
                  placeholder="Describe your project, utility, and fee strategy…"
                  rows={4}
                  value={details.description}
                  maxLength={1000}
                  onChange={(e) => field('description', e.target.value)}
                />

                <div className="two-col-fields">
                  <ForgeInput
                    label="X / Twitter (optional)"
                    prefix="x.com/"
                    placeholder="handle"
                    value={details.twitter.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//, '')}
                    onChange={(e) => {
                      const val = e.target.value.replace(/^@/, '');
                      field('twitter', val ? `https://x.com/${val}` : '');
                    }}
                  />
                  <ForgeInput
                    label="Telegram (optional)"
                    prefix="t.me/"
                    placeholder="group"
                    value={details.telegram.replace(/^https?:\/\/(www\.)?t\.me\//, '')}
                    onChange={(e) => {
                      const val = e.target.value.replace(/^@/, '');
                      field('telegram', val ? `https://t.me/${val}` : '');
                    }}
                  />
                </div>

                <ForgeNumberInput
                  label="Developer buy"
                  value={details.developerBuy}
                  onChange={(e) => field('developerBuy', e.target.value)}
                  min="0"
                  step="any"
                  quickAmounts={['0', '0.01', '0.05', '0.1']}
                  onQuickSelect={(amt) => field('developerBuy', amt)}
                  hint="Initial ETH purchase executed atomically in the launch transaction."
                />

                <details className="advanced-settings-drawer">
                  <summary className="advanced-summary">
                    <span>Advanced Launch Settings</span>
                    <ChevronDown size={18} className="advanced-chevron" />
                  </summary>
                  <div className="advanced-content">
                    <p className="advanced-desc">
                      Native ETH quote asset. No added creator tax. PONS buyback-and-lock is off.
                      Configurations come verified from PONS.
                    </p>
                    <ForgeSelect
                      label="Protocol launch configuration"
                      value={selectedId}
                      onChange={setConfigId}
                      options={(configs.data?.configs || []).map((c) => ({
                        value: c.id.toString(),
                        label: `Configuration ${c.id}`,
                        description: `Curve fee ${Number(c.curveFeeBps) / 100}% · threshold ${formatEther(c.graduationThreshold)} ETH`,
                      }))}
                    />
                    {configs.error && (
                      <p className="error">Launch configurations could not be read.</p>
                    )}
                  </div>
                </details>
              </fieldset>

              <div className="form-action-bar">
                <span className="form-action-note muted">Stage 1 of 3: Token Details</span>
                <button
                  type="submit"
                  className="button button-lime button-stage-next"
                  aria-label="Set your fee flow"
                >
                  <span>PROGRAM THE FLOW</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}

          {/* STEP 1: ALL-DESTINATIONS VISIBLE MODERN FEE DIRECTOR */}
          {step === 1 && (
            <div className="launch-form-step">
              <FeeDirector
                strategies={strategies}
                onStrategiesChange={setStrategies}
                creatorAddress={address}
                initialFlow={flow}
                onConfirmFlow={(newFlow) => {
                  setFlow(newFlow);
                  save(journal, metadata, salt);
                  setStep(2);
                }}
                onChangeFlow={setFlow}
                onBack={() => setStep(0)}
              />
            </div>
          )}

          {/* STEP 2: REVIEW & SIGN */}
          {step === 2 && (
            <div className="launch-form-step">
              <div className="form-step-header">
                <div>
                  <span className="step-tag">STAGE 03</span>
                  <h2>Ready to Forge</h2>
                </div>
                <span className="step-stage-indicator">3 OF 3</span>
              </div>

              <p className="configurator-sub-copy">
                Review all transaction parameters before signing. Each on-chain step is independent
                and permanent.
              </p>

              <div className="review-token-banner">
                <ForgeTokenPreview name={details.name} ticker={details.ticker} image={image} />
              </div>

              <div className="review-spec-card">
                <h3 className="review-spec-title">Deployment Specifications</h3>
                <dl className="review-spec-dl">
                  <div className="spec-row">
                    <dt>Network</dt>
                    <dd>{chain.name} ({chain.id})</dd>
                  </div>
                  <div className="spec-row">
                    <dt>Metadata URI</dt>
                    <dd className="font-mono text-xs">{metadata?.metadataURI || 'Upload to IPFS required'}</dd>
                  </div>
                  <div className="spec-row">
                    <dt>Developer Buy</dt>
                    <dd>{details.developerBuy || '0'} ETH</dd>
                  </div>
                  <div className="spec-row">
                    <dt>FORGE Factory</dt>
                    <dd><ForgeAddress value={forgeFactoryV2} short /></dd>
                  </div>
                  <div className="spec-row">
                    <dt>Fee Receiver / Router</dt>
                    <dd><ForgeAddress value={journal.router} short /></dd>
                  </div>
                  <div className="spec-row">
                    <dt>PONS Launch Contract</dt>
                    <dd>
                      <ForgeAddress
                        value={
                          prepared?.to ||
                          (Number(details.developerBuy) > 0 ? forwarder.address : ponsAddress)
                        }
                        short
                      />
                    </dd>
                  </div>
                  <div className="spec-row">
                    <dt>Launch Value</dt>
                    <dd className="font-semibold">
                      {prepared
                        ? `${formatEther(prepared.value)} ETH`
                        : configs.data
                          ? `${formatEther(configs.data.fee)} ETH (Protocol fee)`
                          : 'Not available'}
                    </dd>
                  </div>
                  <div className="spec-row">
                    <dt>Estimated Gas</dt>
                    <dd>
                      {prepared ? `${prepared.gas.toString()} gas units` : 'Simulated on preparation'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Programmed Routes Summary */}
              <div className="review-routes-card">
                <h3 className="review-spec-title">Programmed Fee Distribution</h3>
                <div className="review-routes-grid">
                  {resolvedFlow.map((d, i) => (
                    <div key={i} className="review-route-item">
                      <div className="review-route-left">
                        <span className="route-kind-badge">
                          {({label: destinationLabel(d.kind)})?.label}
                        </span>
                        <ForgeAddress value={d.recipient} short />
                      </div>
                      <strong className="route-bps-val">{d.bps / 100}%</strong>
                    </div>
                  ))}
                </div>
              </div>

              {needsAutomation && (
                <section className={`automation-gas-card ${automationReady ? 'is-funded' : ''}`}>
                  <div className="automation-gas-head">
                    <div className="automation-gas-icon" aria-hidden="true">
                      <Fuel size={19} />
                    </div>
                    <div>
                      <span className="step-tag">AUTOMATION GAS</span>
                      <h3>Fund this token&apos;s 5-minute engine</h3>
                    </div>
                    <ForgeStatus tone={automationReady ? 'success' : 'warning'}>
                      {automationReady ? 'FUNDED' : 'REQUIRED'}
                    </ForgeStatus>
                  </div>
                  <p className="automation-gas-copy">
                    The shared FORGE keeper submits scheduled transactions. Its actual gas cost is
                    reimbursed only from this router&apos;s balance after a successful action.
                  </p>
                  <div className="automation-gas-metrics">
                    <div>
                      <span>CURRENT BALANCE</span>
                      <strong>{formatEther(automationBalance)} ETH</strong>
                    </div>
                    <div>
                      <span>EXECUTION WINDOW</span>
                      <strong>EVERY 5 MIN</strong>
                    </div>
                    <div>
                      <span>SAFETY CAP</span>
                      <strong>0.01 ETH / ACTION</strong>
                    </div>
                  </div>
                  {journal.router && (
                    <div className="automation-fund-row">
                      <ForgeNumberInput
                        label="Initial gas deposit"
                        value={automationDeposit}
                        onChange={(event) => setAutomationDeposit(event.target.value)}
                        min="0.000001"
                        max="1"
                        step="0.001"
                        hint="ETH reserved only for this router's successful automation calls."
                        quickAmounts={['0.005', '0.01', '0.025']}
                        onQuickSelect={setAutomationDeposit}
                      />
                      <button
                        type="button"
                        className="button button-dark automation-fund-button"
                        disabled={!canWrite}
                        onClick={fundAutomationGas}
                      >
                        {automationReady ? 'TOP UP GAS' : 'FUND AUTOMATION'}
                      </button>
                    </div>
                  )}
                  <p className="automation-gas-footnote">
                    You keep control of unused funds and can pause or withdraw them from the token
                    controls. Failed actions receive no reimbursement.
                  </p>
                </section>
              )}

              {/* 1-CLICK UNIFIED AUTO PIPELINE */}
              <div className="unified-launch-pipeline-card">
                <div className="pipeline-header">
                  <div className="pipeline-header-title">
                    <span className="lime-dot" />
                    <strong>AUTONOMOUS LAUNCH PIPELINE</strong>
                  </div>
                  <span className="pipeline-badge">
                    {journal.token
                      ? 'Step 4 of 4'
                      : journal.router
                        ? 'Step 3 of 4'
                        : metadata
                          ? 'Step 2 of 4'
                          : 'Ready'}
                  </span>
                </div>

                <div className="pipeline-steps-grid">
                  <div
                    className={`pipeline-step-item ${metadata ? 'is-done' : busy && pipelineStep === 1 ? 'is-active' : ''}`}
                  >
                    <span className="step-num">{metadata ? '✓' : '1'}</span>
                    <div className="step-info">
                      <span className="step-title">Metadata</span>
                      <span className="step-status-sub">
                        {metadata ? 'Uploaded IPFS' : 'Sign & upload'}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`pipeline-step-item ${journal.router ? 'is-done' : busy && pipelineStep === 2 ? 'is-active' : ''}`}
                  >
                    <span className="step-num">{journal.router ? '✓' : '2'}</span>
                    <div className="step-info">
                      <span className="step-title">Fee Router</span>
                      <span className="step-status-sub">
                        {journal.router ? 'Deployed' : 'Deploy contract'}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`pipeline-step-item ${journal.token ? 'is-done' : busy && pipelineStep === 3 ? 'is-active' : ''}`}
                  >
                    <span className="step-num">{journal.token ? '✓' : '3'}</span>
                    <div className="step-info">
                      <span className="step-title">PONS Token</span>
                      <span className="step-status-sub">
                        {journal.token ? 'Launched' : 'Launch curve'}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`pipeline-step-item ${journal.bindHash ? 'is-done' : busy && pipelineStep === 4 ? 'is-active' : ''}`}
                  >
                    <span className="step-num">{journal.bindHash ? '✓' : '4'}</span>
                    <div className="step-info">
                      <span className="step-title">Routing Flow</span>
                      <span className="step-status-sub">
                        {journal.bindHash ? 'Active' : 'Register binding'}
                      </span>
                    </div>
                  </div>
                </div>

                {pipelineText && (
                  <div className="pipeline-live-status">
                    <span className="loading-dot" />
                    <span>{pipelineText}</span>
                  </div>
                )}

                <button
                  type="button"
                  className="button button-lime full pipeline-main-launch-btn"
                  disabled={!address || (!file && !metadata) || busy || (!canWrite && !writesEnabled)}
                  onClick={startAutoLaunch}
                >
                  <span>
                    {busy
                      ? pipelineText || 'PROCESSING NEXT ON-CHAIN STEP…'
                      : journal.token
                        ? 'FINALIZE TOKEN BINDING'
                        : journal.router
                          ? 'CONTINUE TOKEN LAUNCH'
                          : metadata
                            ? 'CONTINUE TO ROUTER & LAUNCH'
                            : 'LAUNCH & FORGE TOKEN'}
                  </span>
                  <ArrowUpRight size={18} />
                </button>

                <div className="pipeline-footer-toggle">
                  <button
                    type="button"
                    className="text-link-small text-xs muted"
                    onClick={() => setShowAdvancedManual(!showAdvancedManual)}
                  >
                    {showAdvancedManual ? 'Hide advanced controls ▲' : 'Advanced step controls & recovery ▼'}
                  </button>
                </div>

                {showAdvancedManual && (
                  <div className="advanced-manual-box">
                    <p className="text-xs muted">
                      Perform individual steps manually or recover an unconfirmed state:
                    </p>
                    <div className="manual-actions-grid">
                      {!metadata && (
                        <button
                          type="button"
                          className="button button-dark"
                          disabled={!address || !file || !system?.storage || busy}
                          onClick={upload}
                        >
                          <span>Store Metadata</span>
                        </button>
                      )}
                      {metadata && !journal.router && (
                        <button
                          type="button"
                          className="button button-lime"
                          disabled={!canWrite || !metadata || !system?.ready || busy}
                          onClick={reviewRouter}
                        >
                          <span>Deploy Router Only</span>
                        </button>
                      )}
                      {journal.router && !journal.token && (
                        <button
                          type="button"
                          className="button button-lime"
                          disabled={!canWrite || !metadata || !system?.ready || busy}
                          onClick={launch}
                        >
                          <span>Launch Token Only</span>
                        </button>
                      )}
                      {journal.token && (
                        <button
                          type="button"
                          className="button button-lime"
                          disabled={!canWrite || busy}
                          onClick={bind}
                        >
                          <span>Bind Flow Only</span>
                        </button>
                      )}
                      {(journal.routerHash || journal.launchHash) && (
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={busy}
                          onClick={recover}
                        >
                          <span>Recover Pending Hashes</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="immutable-notice-row">
                <LockKeyhole size={18} />
                <p>
                  Allocations are permanent and immutable once deployed. One transaction failure
                  does not impact already confirmed state.
                </p>
              </div>

              {system?.blockers.length !== 0 && (
                <div className="system-blockers-box" role="alert">
                  <strong>System Action Required:</strong>
                  <ul>
                    {system?.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <Link href="/status" className="small">
                    Check system status ↗
                  </Link>
                </div>
              )}

              <div className="form-action-bar">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setStep(1)}
                >
                  <ArrowLeft size={16} />
                  <span>REVIEW ALLOCATIONS</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: TOKEN LIVE */}
          {step === 3 && (
            <div className="launch-form-step step-live-complete">
              <div className="live-success-icon">
                <Check size={40} strokeWidth={3} />
              </div>
              <ForgeStatus tone="success">CONFIRMED ON-CHAIN</ForgeStatus>
              <h2 className="live-complete-title">THE FLOW IS LIVE.</h2>
              <p className="live-complete-desc">
                Your token has been deployed and its creator fees are now permanently programmed.
              </p>

              <dl className="live-summary-dl">
                <div className="spec-row">
                  <dt>Token Contract</dt>
                  <dd><ForgeAddress value={journal.token} /></dd>
                </div>
                <div className="spec-row">
                  <dt>Dedicated Router</dt>
                  <dd><ForgeAddress value={journal.router} /></dd>
                </div>
                {needsAutomation && (
                  <div className="spec-row">
                    <dt>Automation Gas</dt>
                    <dd>{formatEther(automationBalance)} ETH</dd>
                  </div>
                )}
                <div className="spec-row">
                  <dt>Launch Tx</dt>
                  <dd><ForgeAddress value={journal.launchHash} kind="tx" short /></dd>
                </div>
                <div className="spec-row">
                  <dt>Network</dt>
                  <dd>{chain.name}</dd>
                </div>
              </dl>

              <div className="live-complete-actions">
                <Link className="button button-lime full" href={`/token/${journal.token}`}>
                  <span>OPEN TOKEN PAGE</span>
                  <ArrowUpRight size={18} />
                </Link>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="error-box mt-4">
              {error}
            </div>
          )}
        </div>

        {step === 2 && <StrategyReview value={strategies} flow={resolvedFlow} />}

        {/* RIGHT SIDEBAR: STICKY TOKEN PREVIEW & LIVE ALLOCATION PREVIEW */}
        <aside className="launch-preview-sidebar">
          <div className="sidebar-sticky-wrap">
            <div className="sidebar-card">
              <div className="sidebar-card-top">
                <span className="sidebar-label">LIVE TOKEN PREVIEW</span>
                <ForgeStatus tone="neutral">DRAFT</ForgeStatus>
              </div>

              <div className="sidebar-token-card">
                <ForgeTokenPreview
                  name={details.name}
                  ticker={details.ticker}
                  image={image}
                  description={details.description}
                />
                <div className="sidebar-token-specs">
                  <div className="spec-item">
                    <span>NETWORK</span>
                    <strong>{chain.name}</strong>
                  </div>
                  <div className="spec-item">
                    <span>DEV BUY</span>
                    <strong>{details.developerBuy || '0'} ETH</strong>
                  </div>
                </div>
              </div>

              {/* ALLOCATION PREVIEW (NO "SIMULATION" TERMINOLOGY) */}
              <div className="sidebar-allocation-preview">
                <div className="alloc-header">
                  <span className="alloc-label">FLOW PREVIEW</span>
                  <span className="alloc-basis">FOR EVERY 1 ETH</span>
                </div>
                <div className="alloc-breakdown">
                  {flow.map((d, i) => (
                    <div key={i} className="alloc-breakdown-row">
                      <span className="alloc-dest-name">
                        {({label: destinationLabel(d.kind)})?.label || 'Destination'}
                      </span>
                      <strong className="alloc-dest-amount font-mono">
                        {(d.bps / 10000).toFixed(4)} <small>ETH</small>
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="alloc-disclaimer">
                  Allocation preview only. Mathematical calculation on 1 ETH creator-fee revenue.
                </p>
              </div>

              {!address && (
                <div className="sidebar-wallet-block">
                  <p className="small muted">Connect your wallet to launch and forge.</p>
                  <WalletButton />
                </div>
              )}

              {/* RECOVERY DRAWER */}
              <details className="sidebar-recovery-drawer">
                <summary className="recovery-summary">Resume an existing launch</summary>
                <div className="recovery-body">
                  <p className="small muted">
                    Find routers created by your connected wallet to continue a interrupted launch.
                  </p>
                  <button
                    type="button"
                    className="button button-secondary full"
                    disabled={!address || !forgeFactory || busy}
                    onClick={() =>
                      run('Read creator registry', async () => {
                        setRecovery([...(await getCreatorRouters(address!))]);
                      })
                    }
                  >
                    Find my routers
                  </button>
                  {recovery.length > 0 && (
                    <ForgeSelect
                      label="Your registered routers"
                      value={selectedRecovery}
                      onChange={setSelectedRecovery}
                      options={recovery.map((r) => ({
                        value: r,
                        label: `${r.slice(0, 8)}…${r.slice(-4)}`,
                      }))}
                    />
                  )}
                  <button
                    type="button"
                    className="button button-secondary full"
                    disabled={!address || busy}
                    onClick={recover}
                  >
                    Recover confirmed state
                  </button>
                </div>
              </details>
            </div>
          </div>
        </aside>
      </div>

      {/* MODALS */}
      <ForgeTransactionModal state={tx} open={txOpen} onClose={() => setTxOpen(false)} />

      <ForgeModal
        title="Deploy Dedicated Fee Router"
        open={!!routerReview}
        onOpenChange={(v) => {
          if (!v) setRouterReview(null);
        }}
      >
        <StrategyReview value={strategies} flow={resolvedFlow} />
        <p>V2 factory: {forgeFactoryV2 || "Not deployed"} - Network: {chain.name}</p>
        <p className="modal-lead">
          Deploy an immutable FORGE fee router for your token. This is an independent on-chain
          transaction.
        </p>
        <dl className="review-spec-dl">
          <div className="spec-row">
            <dt>Network</dt>
            <dd>{chain.name} ({chain.id})</dd>
          </div>
          <div className="spec-row">
            <dt>Destination Factory</dt>
            <dd><ForgeAddress value={forgeFactoryV2} short /></dd>
          </div>
          <div className="spec-row">
            <dt>Transaction Value</dt>
            <dd>0 ETH</dd>
          </div>
          <div className="spec-row">
            <dt>Estimated Gas</dt>
            <dd>{routerReview?.gas.toString()} gas units</dd>
          </div>
        </dl>
        <button
          type="button"
          className="button button-lime full"
          disabled={!canWrite}
          onClick={deployRouter}
        >
          Confirm router deployment
        </button>
      </ForgeModal>

      <ForgeModal
        title="Register Confirmed Token"
        open={bindingReview !== null}
        onOpenChange={(v) => {
          if (!v) setBindingReview(null);
        }}
      >
        <p className="modal-lead">
          Bind the token created by PONS to its dedicated ForgeRouter to finalize routing.
        </p>
        <dl className="review-spec-dl">
          <div className="spec-row">
            <dt>Network</dt>
            <dd>{chain.name} ({chain.id})</dd>
          </div>
          <div className="spec-row">
            <dt>Token Address</dt>
            <dd><ForgeAddress value={journal.token} short /></dd>
          </div>
          <div className="spec-row">
            <dt>Fee Router</dt>
            <dd><ForgeAddress value={journal.router} short /></dd>
          </div>
          <div className="spec-row">
            <dt>Estimated Gas</dt>
            <dd>{bindingReview?.toString()} gas units</dd>
          </div>
        </dl>
        <button
          type="button"
          className="button button-lime full"
          disabled={!canWrite}
          onClick={executeBinding}
        >
          Confirm token binding
        </button>
      </ForgeModal>
    </div>
  );
}
