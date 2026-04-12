/**
 * Lightweight in-process metrics collection for the Tally application.
 *
 * Provides Counter, Histogram, and Gauge metric types that can be scraped
 * via a Prometheus-compatible `/api/metrics` endpoint.  Zero external
 * dependencies — mirrors the approach of `src/lib/logger.ts`.
 *
 * Usage:
 *   import { metrics, httpRequestsTotal, httpRequestDuration } from '@/lib/metrics';
 *
 *   httpRequestsTotal.inc({ procedure: 'user.list', type: 'query', code: 'OK' });
 *   httpRequestDuration.observe(0.123, { procedure: 'user.list', type: 'query' });
 *
 *   // Serialize all registered metrics as Prometheus text exposition format:
 *   const text = metrics.serializePrometheus();
 */

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

/** Metric label values — only primitives to keep things serializable. */
export type Labels = Record<string, string>;

/**
 * Build a deterministic cache key from a set of labels.
 * Keys are sorted so `{a:"1",b:"2"}` and `{b:"2",a:"1"}` map to the same slot.
 */
function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

/**
 * Format labels as Prometheus label set: `{key1="val1",key2="val2"}`.
 * Returns empty string when no labels are present.
 */
function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`).join(',')}}`;
}

/** Escape special characters inside a Prometheus label value. */
function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Format a numeric value for Prometheus output.
 * Integers render without a decimal point; floats keep full precision.
 */
function formatValue(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? '+Inf' : '-Inf';
  return Object.is(v, Math.trunc(v)) ? v.toString() : v.toString();
}

// ---------------------------------------------------------------------------
// Metric types
// ---------------------------------------------------------------------------

export type MetricType = 'counter' | 'histogram' | 'gauge';

interface MetricMeta {
  name: string;
  help: string;
  type: MetricType;
  serialize(): string;
  reset(): void;
}

// ---- Counter --------------------------------------------------------------

export class Counter implements MetricMeta {
  readonly type = 'counter' as const;
  /** @internal */ _values = new Map<string, { labels: Labels; value: number }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  /** Increment the counter. `value` must be ≥ 0 (default 1). */
  inc(labels: Labels = {}, value = 1): void {
    if (value < 0) return; // Prometheus counters must not decrease
    const key = labelKey(labels);
    const existing = this._values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this._values.set(key, { labels: { ...labels }, value });
    }
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    Array.from(this._values.values()).forEach(({ labels, value }) => {
      lines.push(`${this.name}${formatLabels(labels)} ${formatValue(value)}`);
    });
    return lines.join('\n');
  }

  reset(): void {
    this._values.clear();
  }
}

// ---- Gauge ----------------------------------------------------------------

export class Gauge implements MetricMeta {
  readonly type = 'gauge' as const;
  /** @internal */ _values = new Map<string, { labels: Labels; value: number }>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  /** Set the gauge to an absolute value. */
  set(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    const existing = this._values.get(key);
    if (existing) {
      existing.value = value;
    } else {
      this._values.set(key, { labels: { ...labels }, value });
    }
  }

  /** Increment the gauge (default +1). */
  inc(labels: Labels = {}, value = 1): void {
    const key = labelKey(labels);
    const existing = this._values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this._values.set(key, { labels: { ...labels }, value });
    }
  }

  /** Decrement the gauge (default −1). */
  dec(labels: Labels = {}, value = 1): void {
    this.inc(labels, -value);
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    Array.from(this._values.values()).forEach(({ labels, value }) => {
      lines.push(`${this.name}${formatLabels(labels)} ${formatValue(value)}`);
    });
    return lines.join('\n');
  }

  reset(): void {
    this._values.clear();
  }
}

// ---- Histogram ------------------------------------------------------------

/** Default HTTP latency buckets (in seconds), matching Prometheus conventions. */
const DEFAULT_HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramEntry {
  labels: Labels;
  buckets: number[];  // cumulative counts per upper-bound
  sum: number;
  count: number;
}

export class Histogram implements MetricMeta {
  readonly type = 'histogram' as const;
  readonly bucketBoundaries: readonly number[];
  /** @internal */ _entries = new Map<string, HistogramEntry>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    buckets: number[] = DEFAULT_HTTP_BUCKETS,
  ) {
    // Ensure sorted, deduplicated boundaries.
    this.bucketBoundaries = Array.from(new Set(buckets)).sort((a, b) => a - b);
  }

  /** Record an observed value. */
  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let entry = this._entries.get(key);
    if (!entry) {
      entry = {
        labels: { ...labels },
        buckets: new Array(this.bucketBoundaries.length).fill(0) as number[],
        sum: 0,
        count: 0,
      };
      this._entries.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.bucketBoundaries.length; i++) {
      if (value <= this.bucketBoundaries[i]) {
        entry.buckets[i] += 1;
        break; // Store per-bucket counts; cumulative totals are computed during serialization
      }
    }
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    Array.from(this._entries.values()).forEach((entry) => {
      const lblStr = formatLabels(entry.labels);
      // Prometheus requires cumulative bucket counts.
      let cumulative = 0;
      for (let i = 0; i < this.bucketBoundaries.length; i++) {
        cumulative += entry.buckets[i];
        const le = formatValue(this.bucketBoundaries[i]);
        const bucketLabels = entry.labels;
        const bucketKeys = Object.keys(bucketLabels).sort();
        const parts = bucketKeys.map(
          (k) => `${k}="${escapeLabelValue(bucketLabels[k])}"`,
        );
        parts.push(`le="${le}"`);
        lines.push(`${this.name}_bucket{${parts.join(',')}} ${formatValue(cumulative)}`);
      }
      // +Inf bucket — always equals total count
      const infParts = Object.keys(entry.labels)
        .sort()
        .map((k) => `${k}="${escapeLabelValue(entry.labels[k])}"`);
      infParts.push('le="+Inf"');
      lines.push(`${this.name}_bucket{${infParts.join(',')}} ${formatValue(entry.count)}`);

      // Sum and count
      lines.push(`${this.name}_sum${lblStr} ${formatValue(entry.sum)}`);
      lines.push(`${this.name}_count${lblStr} ${formatValue(entry.count)}`);
    });
    return lines.join('\n');
  }

  reset(): void {
    this._entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Registry (global singleton)
// ---------------------------------------------------------------------------

class MetricsRegistry {
  private _metrics = new Map<string, MetricMeta>();

  /** Register and return a Counter. Throws if name is already taken by a different type. */
  counter(name: string, help: string): Counter {
    return this._register(new Counter(name, help)) as Counter;
  }

  /** Register and return a Gauge. */
  gauge(name: string, help: string): Gauge {
    return this._register(new Gauge(name, help)) as Gauge;
  }

  /** Register and return a Histogram with optional custom bucket boundaries. */
  histogram(name: string, help: string, buckets?: number[]): Histogram {
    return this._register(new Histogram(name, help, buckets)) as Histogram;
  }

  /**
   * Serialize every registered metric into the Prometheus text exposition
   * format (text/plain; version=0.0.4).
   */
  serializePrometheus(): string {
    const sections: string[] = [];
    Array.from(this._metrics.values()).forEach((metric) => {
      sections.push(metric.serialize());
    });
    return sections.join('\n\n') + '\n';
  }

  /** Reset all registered metrics to zero. Useful in test suites. */
  resetMetrics(): void {
    Array.from(this._metrics.values()).forEach((metric) => {
      metric.reset();
    });
  }

  // ------- internal --------------------------------------------------------

  private _register<T extends MetricMeta>(metric: T): T {
    const existing = this._metrics.get(metric.name);
    if (existing) {
      if (existing.type !== metric.type) {
        throw new Error(
          `Metric "${metric.name}" is already registered as "${existing.type}", cannot re-register as "${metric.type}"`,
        );
      }
      // Re-registration of the same type returns the original instance so
      // multiple modules can import predefined metrics safely.
      return existing as unknown as T;
    }
    this._metrics.set(metric.name, metric);
    return metric;
  }
}

// ---------------------------------------------------------------------------
// Global singleton & convenience re-exports
// ---------------------------------------------------------------------------

/** Global metrics registry — import this to register custom metrics. */
export const metrics = new MetricsRegistry();

/** Convenience alias for `metrics.serializePrometheus()`. */
export function serializePrometheus(): string {
  return metrics.serializePrometheus();
}

/** Convenience alias for `metrics.resetMetrics()`. */
export function resetMetrics(): void {
  metrics.resetMetrics();
}

// ---------------------------------------------------------------------------
// Pre-defined application metrics
// ---------------------------------------------------------------------------

/** Total number of HTTP requests handled. */
export const httpRequestsTotal = metrics.counter(
  'tally_http_requests_total',
  'Total number of HTTP requests handled',
);

/** Duration of HTTP requests in seconds. */
export const httpRequestDuration = metrics.histogram(
  'tally_http_request_duration_seconds',
  'Duration of HTTP requests in seconds',
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

/** Number of HTTP requests currently being processed. */
export const httpRequestsInFlight = metrics.gauge(
  'tally_http_requests_in_flight',
  'Number of HTTP requests currently in flight',
);

/** Total number of vendor/distributor API calls. */
export const vendorApiCallsTotal = metrics.counter(
  'tally_vendor_api_calls_total',
  'Total number of vendor/distributor API calls',
);

/** Duration of vendor/distributor API calls in seconds. */
export const vendorApiDuration = metrics.histogram(
  'tally_vendor_api_duration_seconds',
  'Duration of vendor/distributor API calls in seconds',
);
