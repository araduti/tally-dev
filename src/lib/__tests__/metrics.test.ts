/**
 * Unit tests for the lightweight metrics collection system (src/lib/metrics.ts).
 *
 * Covers:
 *  - Counter: inc, inc with labels, inc with custom value, negative value ignored
 *  - Gauge: set, inc, dec, labels
 *  - Histogram: observe, cumulative buckets, sum/count, custom buckets
 *  - Registry: registration, duplicate registration, type conflict
 *  - serializePrometheus: output format, HELP/TYPE lines, label formatting
 *  - resetMetrics: clears all metric state
 *  - Label escaping: quotes, backslashes, newlines
 *  - Pre-defined metrics: all registered and correct type
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  metrics,
  resetMetrics,
  serializePrometheus,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
  vendorApiCallsTotal,
  vendorApiDuration,
} from '../metrics';

describe('metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  // ---------- Counter ------------------------------------------------------

  describe('Counter', () => {
    it('should increment by 1 by default', () => {
      const c = new Counter('test_counter', 'A test counter');
      c.inc();
      expect(c.serialize()).toContain('test_counter 1');
    });

    it('should increment by a custom value', () => {
      const c = new Counter('test_counter', 'A test counter');
      c.inc({}, 5);
      expect(c.serialize()).toContain('test_counter 5');
    });

    it('should accumulate multiple increments', () => {
      const c = new Counter('test_counter', 'A test counter');
      c.inc();
      c.inc();
      c.inc({}, 3);
      expect(c.serialize()).toContain('test_counter 5');
    });

    it('should ignore negative increments', () => {
      const c = new Counter('test_counter', 'A test counter');
      c.inc({}, 5);
      c.inc({}, -1);
      expect(c.serialize()).toContain('test_counter 5');
    });

    it('should track separate label combinations independently', () => {
      const c = new Counter('test_counter', 'A test counter');
      c.inc({ method: 'GET' });
      c.inc({ method: 'POST' });
      c.inc({ method: 'GET' }, 2);
      const output = c.serialize();
      expect(output).toContain('test_counter{method="GET"} 3');
      expect(output).toContain('test_counter{method="POST"} 1');
    });

    it('should treat labels with same keys in different order as equal', () => {
      const c = new Counter('test_counter', 'A test counter');
      c.inc({ a: '1', b: '2' });
      c.inc({ b: '2', a: '1' });
      // Should be 2, not two separate entries
      const output = c.serialize();
      expect(output).toContain('test_counter{a="1",b="2"} 2');
    });

    it('should output HELP and TYPE lines', () => {
      const c = new Counter('test_counter', 'A helpful description');
      c.inc();
      const output = c.serialize();
      expect(output).toContain('# HELP test_counter A helpful description');
      expect(output).toContain('# TYPE test_counter counter');
    });

    it('should reset to empty', () => {
      const c = new Counter('test_counter', 'A test counter');
      c.inc({}, 10);
      c.reset();
      const output = c.serialize();
      expect(output).not.toContain('test_counter 10');
      expect(output).toContain('# HELP');
      expect(output).toContain('# TYPE');
    });
  });

  // ---------- Gauge --------------------------------------------------------

  describe('Gauge', () => {
    it('should set a value', () => {
      const g = new Gauge('test_gauge', 'A test gauge');
      g.set(42);
      expect(g.serialize()).toContain('test_gauge 42');
    });

    it('should overwrite on subsequent set calls', () => {
      const g = new Gauge('test_gauge', 'A test gauge');
      g.set(10);
      g.set(20);
      expect(g.serialize()).toContain('test_gauge 20');
      expect(g.serialize()).not.toContain('test_gauge 10');
    });

    it('should increment from zero', () => {
      const g = new Gauge('test_gauge', 'A test gauge');
      g.inc();
      expect(g.serialize()).toContain('test_gauge 1');
    });

    it('should decrement', () => {
      const g = new Gauge('test_gauge', 'A test gauge');
      g.set(5);
      g.dec();
      expect(g.serialize()).toContain('test_gauge 4');
    });

    it('should go negative', () => {
      const g = new Gauge('test_gauge', 'A test gauge');
      g.dec({}, 3);
      expect(g.serialize()).toContain('test_gauge -3');
    });

    it('should track labels independently', () => {
      const g = new Gauge('test_gauge', 'A test gauge');
      g.set(10, { pool: 'read' });
      g.set(5, { pool: 'write' });
      const output = g.serialize();
      expect(output).toContain('test_gauge{pool="read"} 10');
      expect(output).toContain('test_gauge{pool="write"} 5');
    });

    it('should output HELP and TYPE lines', () => {
      const g = new Gauge('test_gauge', 'A gauge description');
      const output = g.serialize();
      expect(output).toContain('# HELP test_gauge A gauge description');
      expect(output).toContain('# TYPE test_gauge gauge');
    });
  });

  // ---------- Histogram ----------------------------------------------------

  describe('Histogram', () => {
    it('should record observations into correct buckets', () => {
      const h = new Histogram('test_hist', 'A test histogram', [1, 5, 10]);
      h.observe(0.5);
      h.observe(3);
      h.observe(7);
      h.observe(15);
      const output = h.serialize();
      // Cumulative: le=1 → 1, le=5 → 2, le=10 → 3, +Inf → 4
      expect(output).toContain('test_hist_bucket{le="1"} 1');
      expect(output).toContain('test_hist_bucket{le="5"} 2');
      expect(output).toContain('test_hist_bucket{le="10"} 3');
      expect(output).toContain('test_hist_bucket{le="+Inf"} 4');
      expect(output).toContain('test_hist_sum 25.5');
      expect(output).toContain('test_hist_count 4');
    });

    it('should include boundary value in the bucket', () => {
      const h = new Histogram('test_hist', 'A test histogram', [1, 5, 10]);
      h.observe(5); // exactly on boundary
      const output = h.serialize();
      expect(output).toContain('test_hist_bucket{le="5"} 1');
    });

    it('should handle observations with labels', () => {
      const h = new Histogram('test_hist', 'A test histogram', [1, 5]);
      h.observe(0.5, { method: 'GET' });
      h.observe(3, { method: 'POST' });
      const output = h.serialize();
      expect(output).toContain('test_hist_bucket{method="GET",le="1"} 1');
      expect(output).toContain('test_hist_bucket{method="POST",le="1"} 0');
      expect(output).toContain('test_hist_bucket{method="POST",le="5"} 1');
    });

    it('should sort and deduplicate custom buckets', () => {
      const h = new Histogram('test_hist', 'A test histogram', [10, 5, 5, 1]);
      expect(h.bucketBoundaries).toEqual([1, 5, 10]);
    });

    it('should use default HTTP buckets when none provided', () => {
      const h = new Histogram('test_hist', 'A test histogram');
      expect(h.bucketBoundaries).toEqual([
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ]);
    });

    it('should output HELP and TYPE lines', () => {
      const h = new Histogram('test_hist', 'Hist description', [1]);
      const output = h.serialize();
      expect(output).toContain('# HELP test_hist Hist description');
      expect(output).toContain('# TYPE test_hist histogram');
    });

    it('should output only HELP/TYPE when no observations recorded', () => {
      const h = new Histogram('test_hist', 'A test histogram', [1, 5]);
      const output = h.serialize();
      expect(output).toBe(
        '# HELP test_hist A test histogram\n# TYPE test_hist histogram',
      );
    });
  });

  // ---------- Label escaping -----------------------------------------------

  describe('label escaping', () => {
    it('should escape double quotes in label values', () => {
      const c = new Counter('test_counter', 'test');
      c.inc({ path: 'say "hello"' });
      expect(c.serialize()).toContain('{path="say \\"hello\\""}');
    });

    it('should escape backslashes in label values', () => {
      const c = new Counter('test_counter', 'test');
      c.inc({ path: 'C:\\Users' });
      expect(c.serialize()).toContain('{path="C:\\\\Users"}');
    });

    it('should escape newlines in label values', () => {
      const c = new Counter('test_counter', 'test');
      c.inc({ msg: 'line1\nline2' });
      expect(c.serialize()).toContain('{msg="line1\\nline2"}');
    });
  });

  // ---------- Registry -----------------------------------------------------

  describe('MetricsRegistry', () => {
    it('should register and return a counter', () => {
      const c = metrics.counter('reg_counter', 'test');
      expect(c).toBeInstanceOf(Counter);
    });

    it('should register and return a gauge', () => {
      const g = metrics.gauge('reg_gauge', 'test');
      expect(g).toBeInstanceOf(Gauge);
    });

    it('should register and return a histogram', () => {
      const h = metrics.histogram('reg_hist', 'test');
      expect(h).toBeInstanceOf(Histogram);
    });

    it('should return existing metric on duplicate registration of same type', () => {
      const c1 = metrics.counter('dup_counter', 'test');
      const c2 = metrics.counter('dup_counter', 'test again');
      expect(c1).toBe(c2);
    });

    it('should throw on conflicting type registration', () => {
      metrics.counter('conflict_metric', 'test');
      expect(() => metrics.gauge('conflict_metric', 'test')).toThrow(
        /already registered as "counter"/,
      );
    });
  });

  // ---------- serializePrometheus ------------------------------------------

  describe('serializePrometheus()', () => {
    it('should serialize all registered metrics', () => {
      // The pre-defined metrics are always present
      httpRequestsTotal.inc({ procedure: 'user.list', type: 'query', code: 'OK' });
      httpRequestsInFlight.set(3);

      const output = serializePrometheus();
      expect(output).toContain('# HELP tally_http_requests_total');
      expect(output).toContain('# TYPE tally_http_requests_total counter');
      expect(output).toContain('tally_http_requests_total{code="OK",procedure="user.list",type="query"} 1');
      expect(output).toContain('# HELP tally_http_requests_in_flight');
      expect(output).toContain('tally_http_requests_in_flight 3');
    });

    it('should end with a newline', () => {
      const output = serializePrometheus();
      expect(output.endsWith('\n')).toBe(true);
    });

    it('should separate metric blocks with blank lines', () => {
      httpRequestsTotal.inc({ procedure: 'test', type: 'query', code: 'OK' });
      httpRequestsInFlight.set(1);
      const output = serializePrometheus();
      expect(output).toContain('\n\n');
    });
  });

  // ---------- resetMetrics -------------------------------------------------

  describe('resetMetrics()', () => {
    it('should clear all metric data', () => {
      httpRequestsTotal.inc({ procedure: 'test', type: 'query', code: 'OK' }, 100);
      httpRequestsInFlight.set(5);
      httpRequestDuration.observe(0.123, { procedure: 'test', type: 'query' });

      resetMetrics();

      const output = serializePrometheus();
      // Should still have HELP/TYPE headers but no data points
      expect(output).toContain('# HELP tally_http_requests_total');
      expect(output).not.toContain('100');
      expect(output).not.toContain('0.123');
    });
  });

  // ---------- Pre-defined metrics ------------------------------------------

  describe('pre-defined metrics', () => {
    it('httpRequestsTotal should be a counter', () => {
      expect(httpRequestsTotal).toBeInstanceOf(Counter);
      expect(httpRequestsTotal.name).toBe('tally_http_requests_total');
    });

    it('httpRequestDuration should be a histogram with HTTP buckets', () => {
      expect(httpRequestDuration).toBeInstanceOf(Histogram);
      expect(httpRequestDuration.name).toBe('tally_http_request_duration_seconds');
      expect(httpRequestDuration.bucketBoundaries).toEqual([
        0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ]);
    });

    it('httpRequestsInFlight should be a gauge', () => {
      expect(httpRequestsInFlight).toBeInstanceOf(Gauge);
      expect(httpRequestsInFlight.name).toBe('tally_http_requests_in_flight');
    });

    it('vendorApiCallsTotal should be a counter', () => {
      expect(vendorApiCallsTotal).toBeInstanceOf(Counter);
      expect(vendorApiCallsTotal.name).toBe('tally_vendor_api_calls_total');
    });

    it('vendorApiDuration should be a histogram', () => {
      expect(vendorApiDuration).toBeInstanceOf(Histogram);
      expect(vendorApiDuration.name).toBe('tally_vendor_api_duration_seconds');
    });
  });
});
