'use client';
import {
  useId,
  useRef,
  useState,
  useEffect,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Slider from '@radix-ui/react-slider';
import * as Switch from '@radix-ui/react-switch';
import * as Radio from '@radix-ui/react-radio-group';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Search,
  Upload,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { explorer } from '@/lib/config';

export function ForgeInput({
  label,
  error,
  hint,
  prefix,
  counter,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  prefix?: string;
  counter?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <div className="field-header">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {counter && <span className="field-counter font-mono">{counter}</span>}
      </div>
      <div className={`input-wrapper ${prefix ? 'has-prefix' : ''} ${error ? 'is-error' : ''}`}>
        {prefix && <span className="input-prefix font-mono">{prefix}</span>}
        <input
          id={id}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-help` : undefined}
          {...props}
        />
      </div>
      {(error || hint) && (
        <small id={`${id}-help`} className={error ? 'error' : 'hint'}>
          {error || hint}
        </small>
      )}
    </div>
  );
}

export function ForgeTextarea({
  label,
  error,
  hint,
  value,
  maxLength,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const currentLength = typeof value === 'string' ? value.length : 0;
  return (
    <div className={`field ${className}`}>
      <div className="field-header">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {maxLength && (
          <span className="field-counter font-mono">
            {currentLength} / {maxLength}
          </span>
        )}
      </div>
      <div className={`textarea-wrapper ${error ? 'is-error' : ''}`}>
        <textarea
          id={id}
          value={value}
          maxLength={maxLength}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-help` : undefined}
          {...props}
        />
      </div>
      {(error || hint) && (
        <small id={`${id}-help`} className={error ? 'error' : 'hint'}>
          {error || hint}
        </small>
      )}
    </div>
  );
}

export function ForgeNumberInput({
  quickAmounts,
  onQuickSelect,
  ...props
}: Parameters<typeof ForgeInput>[0] & {
  quickAmounts?: (string | number)[];
  onQuickSelect?: (amount: string) => void;
}) {
  return (
    <div className="number-input-block">
      <ForgeInput {...props} type="number" inputMode="decimal" />
      {quickAmounts && quickAmounts.length > 0 && (
        <div className="quick-amounts-bar" role="group" aria-label="Quick amount selection">
          <span className="quick-label">QUICK:</span>
          {quickAmounts.map((amt) => (
            <button
              key={String(amt)}
              type="button"
              className={`quick-pill ${String(props.value) === String(amt) ? 'active' : ''}`}
              onClick={() => onQuickSelect?.(String(amt))}
            >
              {amt} {props.prefix ? '' : 'ETH'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ForgePercentageInput(props: Parameters<typeof ForgeInput>[0]) {
  return <ForgeNumberInput {...props} min={0} max={100} step={0.01} />;
}

export function ForgeWalletInput(props: Parameters<typeof ForgeInput>[0]) {
  return (
    <ForgeInput
      {...props}
      spellCheck={false}
      autoComplete="off"
      placeholder="0x…"
      className="wallet-field font-mono"
    />
  );
}

export function ForgeSearch({
  value,
  onChange,
  label = 'Search tokens…',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="search">
      <Search size={17} aria-hidden />
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function ForgeSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label id={id}>{label}</label>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger aria-labelledby={id} className="select-trigger">
          <Select.Value />
          <Select.Icon>
            <ChevronDown size={18} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select-content" position="popper" sideOffset={6}>
            <Select.Viewport>
              {options.map((o) => (
                <Select.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className="select-option"
                >
                  <div>
                    <Select.ItemText>{o.label}</Select.ItemText>
                    {o.description && <small>{o.description}</small>}
                  </div>
                  <Select.ItemIndicator className="select-indicator">
                    <Check size={16} />
                  </Select.ItemIndicator>
                  {o.disabled && <span className="tiny">Unavailable</span>}
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

export function ForgeCombobox({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  const [query, setQuery] = useState('');
  return (
    <div className="combobox-container">
      <ForgeSearch label={`Filter ${label.toLowerCase()}`} value={query} onChange={setQuery} />
      <ForgeSelect
        label={label}
        value={value}
        onChange={onChange}
        options={options.filter(
          (o) => o.value === value || o.label.toLowerCase().includes(query.toLowerCase()),
        )}
      />
    </div>
  );
}

export function ForgeSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <Slider.Root
      className="slider"
      value={[value]}
      min={0}
      max={10000}
      step={100}
      onValueChange={(v) => onChange(v[0])}
      disabled={disabled}
    >
      <Slider.Track className="slider-track">
        <Slider.Range className="slider-range" />
      </Slider.Track>
      <Slider.Thumb
        className="slider-thumb"
        aria-label={label}
        aria-valuetext={`${value / 100}%`}
      />
    </Slider.Root>
  );
}

export function ForgeToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="toggle-row">
      <label htmlFor={id}>{label}</label>
      <Switch.Root id={id} className="switch" checked={checked} onCheckedChange={onChange}>
        <Switch.Thumb />
      </Switch.Root>
    </div>
  );
}

export function ForgeRadioGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <Radio.Root className="radio-group" aria-label={label} value={value} onValueChange={onChange}>
      {options.map((o) => (
        <label key={o.value} className="radio-label">
          <Radio.Item value={o.value} disabled={o.disabled} className="radio-item">
            <Radio.Indicator className="radio-indicator" />
          </Radio.Item>
          {o.label}
        </label>
      ))}
    </Radio.Root>
  );
}

export function ForgeModal({
  title,
  description,
  open,
  onOpenChange,
  children,
  drawer = false,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
  drawer?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className={`modal ${drawer ? 'drawer' : ''}`}>
          <div className="modal-head">
            <Dialog.Title className="modal-title">{title}</Dialog.Title>
            <Dialog.Close className="icon-button modal-close" aria-label="Close dialog">
              <X size={19} />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="modal-description">{description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ForgeDrawer(props: Parameters<typeof ForgeModal>[0]) {
  return <ForgeModal {...props} drawer />;
}

export function ForgeTooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={400}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tooltip" sideOffset={8}>
            {text}
            <Tooltip.Arrow />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export function ForgeCopyButton({ value }: { value: string }) {
  const [state, setState] = useState<'Copy' | 'Copied' | 'Failed'>('Copy');
  return (
    <button
      type="button"
      className="icon-button copy-btn"
      aria-label={state === 'Copied' ? 'Copied to clipboard' : 'Copy address'}
      title={state === 'Copied' ? 'Copied!' : 'Copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('Copied');
          setTimeout(() => setState('Copy'), 2000);
        } catch {
          setState('Failed');
          setTimeout(() => setState('Copy'), 2000);
        }
      }}
    >
      {state === 'Copied' ? <Check size={13} className="copied-icon" /> : <Copy size={13} />}
      <span className="sr-only" role="status">
        {state}
      </span>
    </button>
  );
}

export function ForgeAddress({
  value,
  kind = 'address',
  short = false,
}: {
  value?: string | null;
  kind?: 'address' | 'tx';
  short?: boolean;
}) {
  if (!value) return <span className="muted font-mono">Not available</span>;
  return (
    <span className="address font-mono">
      <a
        href={explorer(kind, value)}
        target="_blank"
        rel="noreferrer"
        title={value}
        className="address-link"
      >
        <span>{short ? `${value.slice(0, 6)}…${value.slice(-4)}` : value}</span>
        <ArrowUpRight size={13} aria-hidden />
      </a>
      <ForgeCopyButton value={value} />
    </span>
  );
}

export function ForgeStatus({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'lime';
}) {
  return (
    <span className={`status ${tone}`}>
      <span className="status-dot" aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/* ==================================================
   PIPELINE STEPPER (Zero native scrollbar buttons)
   ================================================== */
export function ForgeStepper({
  step,
  onStepClick,
}: {
  step: number;
  onStepClick?: (step: number) => void;
}) {
  const steps = [
    { num: '01', name: 'TOKEN' },
    { num: '02', name: 'FEE FLOW' },
    { num: '03', name: 'REVIEW' },
    { num: '04', name: 'LIVE' },
  ];

  return (
    <nav aria-label="Launch pipeline progress" className="pipeline-stepper-wrap">
      <div className="pipeline-stepper">
        {steps.map((s, i) => {
          const isDone = i < step;
          const isCurrent = i === step;
          const isClickable = onStepClick && isDone;
          const isLast = i === steps.length - 1;

          return (
            <div key={s.name} className="pipeline-node-container">
              <div
                className={`pipeline-step ${isCurrent ? 'is-active' : ''} ${isDone ? 'is-completed' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isClickable ? (
                  <button
                    type="button"
                    className="pipeline-btn"
                    onClick={() => onStepClick(i)}
                  >
                    <span className="pipeline-num-badge">
                      {isDone ? <Check size={13} strokeWidth={2.8} /> : s.num}
                    </span>
                    <span className="pipeline-title">{s.name}</span>
                  </button>
                ) : (
                  <div className="pipeline-btn">
                    <span className="pipeline-num-badge">
                      {isDone ? <Check size={13} strokeWidth={2.8} /> : s.num}
                    </span>
                    <span className="pipeline-title">{s.name}</span>
                  </div>
                )}
              </div>

              {!isLast && (
                <div className={`pipeline-pipe ${i < step ? 'pipe-active' : ''}`}>
                  <span className="pipe-bar" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/* ==================================================
   THEME-ALIGNED TOKEN PREVIEW
   ================================================== */
export function ForgeTokenPreview({
  name,
  ticker,
  image,
  description,
}: {
  name: string;
  ticker: string;
  image?: string;
  description?: string;
}) {
  return (
    <div className="forge-theme-preview-card">
      <div className="preview-card-header">
        <span className="preview-chip-tag">
          <span className="preview-chip-dot" />
          FORGE TOKEN
        </span>
        <span className="preview-pill-network">Robinhood Chain</span>
      </div>

      <div className="preview-hero-row">
        <div className="preview-avatar-box">
          {image ? (
            <img src={image} alt={`${name || 'Token'} icon`} className="preview-avatar-image" />
          ) : (
            <div className="preview-avatar-forge-logo" aria-hidden>
              <span>{(name || ticker || 'F').charAt(0).toUpperCase()}</span>
            </div>
          )}
        </div>
        <div className="preview-hero-text">
          <strong className="preview-hero-name">{name || 'Your Token'}</strong>
          <div className="preview-ticker-badge">${ticker || 'TICKER'}</div>
        </div>
      </div>

      {description && <p className="preview-hero-desc">{description}</p>}

      <div className="preview-card-bottom-specs">
        <div className="preview-micro-spec">
          <span className="micro-spec-lbl">STATUS</span>
          <span className="micro-spec-val status-live">IMMUTABLE FLOW</span>
        </div>
        <div className="preview-micro-spec">
          <span className="micro-spec-lbl">CREATOR FEES</span>
          <span className="micro-spec-val val-lime">100% PROGRAMMED</span>
        </div>
      </div>
    </div>
  );
}

export function ForgeFileUpload({
  file,
  onChange,
  progress,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  progress?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(f?: File) {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) {
      setError('Use a PNG, JPG or WEBP image up to 5 MB.');
      return;
    }
    setError('');
    onChange(f);
  }

  return (
    <div className="field uploader-field">
      <div className="field-header">
        <label className="field-label">Token Image</label>
        <span className="field-hint">PNG, JPG, WEBP · Max 5MB</span>
      </div>
      <div
        className={`uploader ${drag ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          choose(e.dataTransfer.files[0]);
        }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.remove-image-btn')) return;
          input.current?.click();
        }}
      >
        <input
          ref={input}
          className="sr-only"
          tabIndex={-1}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Token image file"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        {file && preview ? (
          <div className="uploader-preview-row">
            <img src={preview} alt="Selected token image preview" className="uploader-thumb" />
            <div className="uploader-file-info">
              <strong className="file-name">{file.name}</strong>
              <span className="file-size font-mono">{(file.size / 1024).toFixed(1)} KB</span>
              <span className="replace-hint">Click or drop to replace image</span>
            </div>
            <button
              type="button"
              className="icon-button remove-image-btn"
              aria-label="Remove image"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                if (input.current) input.current.value = '';
              }}
            >
              <X size={17} />
            </button>
          </div>
        ) : (
          <div className="uploader-empty-state">
            <div className="uploader-icon-wrap">
              <Upload size={22} strokeWidth={2} aria-hidden />
            </div>
            <div className="uploader-text">
              <strong>Drop your token image here</strong>
              <span>or click to browse files</span>
            </div>
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="upload-progress-bar" role="status">
          <div className="progress-info">
            <span>{progress === 100 ? 'Metadata stored on IPFS' : 'Uploading metadata…'}</span>
            <strong className="font-mono">{progress}%</strong>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {error && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export type TransactionState = {
  status: 'idle' | 'awaiting signature' | 'submitted' | 'confirming' | 'confirmed' | 'failed';
  hash?: string;
  error?: string;
  title?: string;
};

export function ForgeTransactionModal({
  state,
  open,
  onClose,
}: {
  state: TransactionState;
  open: boolean;
  onClose: () => void;
}) {
  const isPending =
    state.status === 'awaiting signature' ||
    state.status === 'confirming' ||
    state.status === 'submitted';
  const isSuccess = state.status === 'confirmed';
  const isFailed = state.status === 'failed';

  return (
    <ForgeModal
      title={state.title || 'Transaction'}
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <div className="tx-modal-body">
        <div className={`tx-icon-block ${isSuccess ? 'success' : isFailed ? 'failed' : 'pending'}`}>
          {isPending && <Loader2 size={34} className="spinner" />}
          {isSuccess && <CheckCircle2 size={34} />}
          {isFailed && <AlertCircle size={34} />}
        </div>

        <ForgeStatus tone={isSuccess ? 'success' : isFailed ? 'warning' : 'neutral'}>
          {state.status.toUpperCase()}
        </ForgeStatus>

        <p className="tx-status-desc">
          {state.status === 'awaiting signature' && 'Review and sign the transaction in your wallet.'}
          {state.status === 'confirming' && 'Confirming on-chain. Please wait a few seconds…'}
          {state.status === 'submitted' && 'Transaction submitted. Waiting for confirmation…'}
          {state.status === 'confirmed' && 'Transaction successfully confirmed on Robinhood Chain!'}
          {state.status === 'failed' && 'The transaction could not be completed.'}
        </p>

        {state.hash && (
          <div className="tx-hash-wrap">
            <span className="muted text-xs">Transaction Hash:</span>
            <ForgeAddress value={state.hash} kind="tx" />
          </div>
        )}

        {state.error && (
          <div role="alert" className="error-box">
            {state.error}
          </div>
        )}

        {(isSuccess || isFailed) && (
          <button type="button" className="button full button-lime" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </ForgeModal>
  );
}
