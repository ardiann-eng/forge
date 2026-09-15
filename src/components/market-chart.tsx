'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart2, ExternalLink, LineChart, Zap } from 'lucide-react';
import { CandlestickSeries, ColorType, CrosshairMode, createChart, createSeriesMarkers, LineSeries, LineStyle, type IChartApi, type SeriesMarker, type Time } from 'lightweight-charts';
import type { Candle, ChartTimeframe, ForgeChartEvent } from '@/lib/market/types';
import { EVENT_COLORS } from '@/lib/market/events';
import { explorer } from '@/lib/config';

export interface MarketChartProps {
  candles: Candle[];
  events: ForgeChartEvent[];
  timeframe: ChartTimeframe;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  metric: 'PRICE' | 'MC';
  onMetricChange: (metric: 'PRICE' | 'MC') => void;
  tokenSymbol: string;
  currentPriceUsd?: number;
  currentMarketCapUsd?: number;
  priceChange24h?: number;
  isLive?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  canShowMarketCap?: boolean;
  spotQuote?: { priceUsd: number | null; launchedAt: number } | null;
}

function displayNumber(value?: number, price = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (price && value < 0.01) return `$${value.toFixed(8)}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: price ? 4 : 2 })}`;
}

export function MarketChart({ candles, events, spotQuote, timeframe, onTimeframeChange, metric, onMetricChange, tokenSymbol, currentPriceUsd, currentMarketCapUsd, priceChange24h, isLive = true, isLoading = false, isError = false, canShowMarketCap = false }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [chartType, setChartType] = useState<'candle' | 'line'>('candle');
  const [selectedEvent, setSelectedEvent] = useState<ForgeChartEvent | null>(null);
  const [activeEventFilter, setActiveEventFilter] = useState('ALL');
  const filteredEvents = useMemo(() => activeEventFilter === 'ALL' ? events : events.filter((event) => event.type === activeEventFilter), [activeEventFilter, events]);
  // Indicative live bonding-curve quote shown only when there is no trade
  // history yet and the chart is in PRICE mode. Never presented as candles.
  const showSpotQuote = !isLoading && !isError && candles.length === 0 && metric === 'PRICE' && typeof spotQuote?.priceUsd === 'number' && (spotQuote.priceUsd as number) > 0;

  useEffect(() => {
    if (!containerRef.current || isLoading || isError || candles.length === 0) return;
    chartRef.current?.remove();
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: 480,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#52525b', fontFamily: 'DM Sans Variable, sans-serif' },
      grid: { vertLines: { color: '#f0f0e9' }, horzLines: { color: '#f0f0e9' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#a1a1aa', width: 1, style: 3 }, horzLine: { color: '#a1a1aa', width: 1, style: 3 } },
      rightPriceScale: { borderColor: '#e1e1da', scaleMargins: { top: 0.12, bottom: 0.1 } },
      timeScale: { borderColor: '#e1e1da', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    const series = chartType === 'candle'
      ? chart.addSeries(CandlestickSeries, { upColor: '#a7f500', downColor: '#18181b', borderUpColor: '#72a800', borderDownColor: '#18181b', wickUpColor: '#72a800', wickDownColor: '#18181b' })
      : chart.addSeries(LineSeries, { color: '#72a800', lineWidth: 2 });
    if (chartType === 'candle') series.setData(candles.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    else series.setData(candles.map((c) => ({ time: c.time as Time, value: c.close })));
    if (filteredEvents.length) {
      const candleTimes = candles.map((c) => c.time);
      const markers: SeriesMarker<Time>[] = filteredEvents.map((event) => {
        const time = candleTimes.reduce((closest, candidate) => Math.abs(candidate - event.timestamp) < Math.abs(closest - event.timestamp) ? candidate : closest, candleTimes[0]);
        const info = EVENT_COLORS[event.type] || EVENT_COLORS.FEE_ROUTED;
        return { time: time as Time, position: event.type === 'BUYBACK' ? 'belowBar' : 'aboveBar', color: info.badge, shape: event.type === 'BUYBACK' || event.type === 'GRADUATION' ? 'arrowUp' : 'circle', text: info.label, id: event.id, size: 1.5 };
      });
      createSeriesMarkers(series, markers);
    }
    chart.timeScale().fitContent();
    const resize = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    resize.observe(container);
    return () => { resize.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, chartType, filteredEvents, isError, isLoading]);

  // Indicative quote reference line for pre-trade tokens (no candles yet).
  useEffect(() => {
    if (!containerRef.current || !showSpotQuote) return;
    chartRef.current?.remove();
    const container = containerRef.current;
    const price = spotQuote!.priceUsd as number;
    const now = Math.floor(Date.now() / 1000);
    const start = spotQuote!.launchedAt > 0 && spotQuote!.launchedAt < now ? spotQuote!.launchedAt : now;
    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: 480,
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#52525b', fontFamily: 'DM Sans Variable, sans-serif' },
      grid: { vertLines: { color: '#f0f0e9' }, horzLines: { color: '#f0f0e9' } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#a1a1aa', width: 1, style: 3 }, horzLine: { color: '#a1a1aa', width: 1, style: 3 } },
      rightPriceScale: { borderColor: '#e1e1da', scaleMargins: { top: 0.3, bottom: 0.3 } },
      timeScale: { borderColor: '#e1e1da', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    const series = chart.addSeries(LineSeries, { color: '#72a800', lineWidth: 2, lineStyle: LineStyle.Dashed, pointMarkersVisible: true, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true });
    series.setData(start === now
      ? [{ time: now as Time, value: price }]
      : [{ time: start as Time, value: price }, { time: now as Time, value: price }]);
    series.createPriceLine({ price, color: '#72a800', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'LIVE QUOTE' });
    chart.timeScale().fitContent();
    const resize = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
    resize.observe(container);
    return () => { resize.disconnect(); chart.remove(); chartRef.current = null; };
  }, [showSpotQuote, spotQuote]);

  const shownValue = metric === 'MC' ? displayNumber(currentMarketCapUsd) : displayNumber(currentPriceUsd, true);
  return <div className="modern-terminal-chart-card">
    <div className="chart-header-bar">
      <div className="chart-price-display"><div className="price-top-row">{isLoading ? <span className="skeleton skeleton-chart-price" /> : <strong className="chart-main-price font-mono">{shownValue}</strong>}<span className="chart-metric-tag">{metric === 'MC' ? 'MARKET CAP' : `${tokenSymbol} / USD`}</span>{typeof priceChange24h === 'number' ? <span className={`chart-change-pill font-mono is-${priceChange24h >= 0 ? 'positive' : 'negative'}`}>{priceChange24h > 0 ? '+' : ''}{priceChange24h.toFixed(2)}%</span> : null}</div><div className="price-status-row"><span className="live-pulse-dot" /><span>{isLive ? 'LIVE' : 'DELAYED'}</span><span>ROBINHOOD CHAIN</span></div></div>
      <div className="chart-toolbar">
        <div className="toolbar-group"><button type="button" className={`toolbar-btn ${metric === 'PRICE' ? 'is-active' : ''}`} onClick={() => onMetricChange('PRICE')}>PRICE</button>{canShowMarketCap ? <button type="button" className={`toolbar-btn ${metric === 'MC' ? 'is-active' : ''}`} onClick={() => onMetricChange('MC')}>MC</button> : null}</div>
        <div className="toolbar-group timeframe-group">{(['1M', '5M', '15M', '1H', '4H', '1D'] as ChartTimeframe[]).map((item) => <button key={item} type="button" className={`toolbar-btn font-mono ${timeframe === item ? 'is-active' : ''}`} onClick={() => onTimeframeChange(item)}>{item}</button>)}</div>
        <div className="toolbar-group"><button type="button" className={`toolbar-icon-btn ${chartType === 'candle' ? 'is-active' : ''}`} onClick={() => setChartType('candle')} aria-label="Candlestick view"><BarChart2 size={15} /></button><button type="button" className={`toolbar-icon-btn ${chartType === 'line' ? 'is-active' : ''}`} onClick={() => setChartType('line')} aria-label="Line view"><LineChart size={15} /></button></div>
      </div>
    </div>
    {events.length ? <div className="chart-event-filter-bar"><span className="event-filter-label"><Zap size={13} />FORGE EVENTS</span><div className="event-filter-pills">{['ALL', 'BUYBACK', 'BURN', 'GRAD_BOOST', 'DCA_BUY', 'HOLDER_REWARD'].map((tag) => <button key={tag} type="button" className={`event-pill-btn ${activeEventFilter === tag ? 'is-active' : ''}`} onClick={() => setActiveEventFilter(tag)}>{tag === 'HOLDER_REWARD' ? 'HOLDERS' : tag.replaceAll('_', ' ')}</button>)}</div></div> : null}
    <div className="chart-canvas-area">
      {isLoading ? <div className="chart-loading-overlay" aria-busy="true"><div className="chart-skeleton-grid"><span className="chart-skeleton-line" />{[1,2,3,4,5].map((item) => <span className={`chart-skeleton-candle c${item}`} key={item} />)}</div><span>LOADING MARKET DATA</span></div> : null}
      {isError ? <div className="chart-empty-overlay"><strong>MARKET DATA TEMPORARILY UNAVAILABLE</strong><span>Please try again shortly.</span></div> : null}
      {!isLoading && !isError && !candles.length && !showSpotQuote ? <div className="chart-empty-overlay"><strong>NO TRADES YET</strong><span>The chart will begin with the first confirmed trade.</span></div> : null}
      {showSpotQuote ? <div className="chart-quote-note"><span className="live-pulse-dot" /><span>LIVE BONDING QUOTE · NO TRADES YET — indicative line, not trade history</span></div> : null}
      <div ref={containerRef} className="lightweight-charts-container" />
    </div>
    {filteredEvents.length ? <div className="chart-event-ticker"><span className="ticker-label">LATEST FORGE ACTIONS</span><div className="ticker-list">{filteredEvents.slice(-4).reverse().map((event) => { const info = EVENT_COLORS[event.type] || EVENT_COLORS.FEE_ROUTED; return <button key={event.id} type="button" className="ticker-item-btn" onClick={() => setSelectedEvent(event)}><span className="ticker-badge" style={{ backgroundColor: info.badge, color: info.text }}>{info.label}</span><span>{event.description}</span></button>; })}</div></div> : null}
    {selectedEvent ? <div className="event-detail-modal-overlay" onClick={() => setSelectedEvent(null)}><div className="event-detail-modal-content" role="dialog" aria-modal="true" aria-labelledby="event-title" onClick={(event) => event.stopPropagation()}><div className="modal-header-row"><span className="event-modal-badge">{selectedEvent.type}</span><button type="button" className="modal-close-btn" aria-label="Close event details" onClick={() => setSelectedEvent(null)}>×</button></div><h3 className="event-modal-title" id="event-title">FORGE ACTION</h3><p className="event-modal-desc">{selectedEvent.description}</p><dl className="event-modal-dl"><div className="dl-row"><dt>TIME</dt><dd>{new Date(selectedEvent.timestamp * 1000).toUTCString()}</dd></div>{selectedEvent.nativeAmount !== undefined ? <div className="dl-row"><dt>AMOUNT</dt><dd>{(Number(selectedEvent.nativeAmount) / 1e18).toFixed(6)} ETH</dd></div> : null}{selectedEvent.tokenAmount !== undefined ? <div className="dl-row"><dt>TOKENS</dt><dd>{(Number(selectedEvent.tokenAmount) / 1e18).toLocaleString()} {tokenSymbol}</dd></div> : null}{selectedEvent.priceUsdAtEvent !== undefined ? <div className="dl-row"><dt>PRICE</dt><dd>{displayNumber(selectedEvent.priceUsdAtEvent, true)}</dd></div> : null}</dl><a href={explorer('tx', selectedEvent.txHash)} target="_blank" rel="noopener noreferrer" className="button button-lime full">VIEW TX <ExternalLink size={14} /></a></div></div> : null}
  </div>;
}
