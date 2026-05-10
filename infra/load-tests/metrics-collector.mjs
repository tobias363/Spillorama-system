#!/usr/bin/env node
/**
 * R4 Load-test metrics-collector.
 *
 * Aggregerer per-VU samples til percentile-statistikk og skriver
 * JSON-rapport. Kjører i hovedprosessen (ikke i hver VU) for å unngå
 * O(n²)-overhead.
 *
 * Eksponerer:
 *   - new MetricsCollector()         — opprett collector
 *   - addLatencySample(metric, ms)   — registrer en latency-måling
 *   - addCounter(name)               — øk teller
 *   - addGauge(name, value)          — sett gauge
 *   - getSnapshot()                  — return current metrics
 *   - exportToFile(path)             — skriv JSON-rapport
 *
 * Percentile-beregning bruker enkel sortering (god nok for ≤ 1M samples).
 * For større datasett kan vi bytte til t-digest senere.
 */

import { writeFileSync } from "node:fs";

export class MetricsCollector {
  constructor() {
    /** @type {Map<string, number[]>} */
    this.latencySamples = new Map();
    /** @type {Map<string, number>} */
    this.counters = new Map();
    /** @type {Map<string, number>} */
    this.gauges = new Map();
    /** @type {{ ts: number, name: string, value: number }[]} */
    this.timeSeries = [];
    this.startedAt = Date.now();
  }

  addLatencySample(metric, ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return;
    let arr = this.latencySamples.get(metric);
    if (!arr) {
      arr = [];
      this.latencySamples.set(metric, arr);
    }
    arr.push(ms);
  }

  addCounter(name, n = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + n);
  }

  addGauge(name, value) {
    this.gauges.set(name, value);
  }

  /**
   * Snapshot-en blir lagt til time-series for å tegne "over tid"-grafer.
   * Kalles fra hovedløkken hvert N. sekund.
   */
  recordTimeSeriesPoint() {
    const ts = Date.now();
    for (const [name, value] of this.gauges) {
      this.timeSeries.push({ ts, name, value });
    }
    for (const [name, value] of this.counters) {
      this.timeSeries.push({ ts, name: `${name}_total`, value });
    }
  }

  /**
   * @param {number[]} arr   Sortert eller usortert
   * @param {number} pct     0..100
   */
  static percentile(arr, pct) {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.floor((pct / 100) * sorted.length),
    );
    return sorted[idx];
  }

  /**
   * Return aggregated snapshot of all metrics.
   * @returns {{
   *   latencies: Record<string, { count: number, mean: number, p50: number, p95: number, p99: number, min: number, max: number }>,
   *   counters: Record<string, number>,
   *   gauges: Record<string, number>,
   *   durationMs: number,
   *   timeSeries: { ts: number, name: string, value: number }[]
   * }}
   */
  getSnapshot() {
    const latencies = {};
    for (const [metric, samples] of this.latencySamples) {
      if (samples.length === 0) continue;
      const sum = samples.reduce((a, b) => a + b, 0);
      latencies[metric] = {
        count: samples.length,
        mean: Math.round(sum / samples.length),
        p50: Math.round(MetricsCollector.percentile(samples, 50)),
        p95: Math.round(MetricsCollector.percentile(samples, 95)),
        p99: Math.round(MetricsCollector.percentile(samples, 99)),
        min: Math.round(Math.min(...samples)),
        max: Math.round(Math.max(...samples)),
      };
    }
    const counters = Object.fromEntries(this.counters);
    const gauges = Object.fromEntries(this.gauges);
    return {
      latencies,
      counters,
      gauges,
      durationMs: Date.now() - this.startedAt,
      timeSeries: this.timeSeries,
    };
  }

  /**
   * Skriv full JSON-rapport (alle samples + aggregat).
   * For store kjøringer (≥ 1000 VUs × 60 min) kan filen bli 100+ MB —
   * vi keeper kun aggregat + time-series, ikke raw samples.
   */
  exportToFile(filePath) {
    const snapshot = this.getSnapshot();
    const report = {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      ...snapshot,
    };
    writeFileSync(filePath, JSON.stringify(report, null, 2));
    return report;
  }

  /**
   * Sjekk om snapshot møter SLA-tresholds.
   * @param {{ p95SocketRoundtrip?: number, p95TicketMarkLatency?: number, p99SocketRoundtrip?: number }} sla
   * @returns {{ pass: boolean, violations: string[] }}
   */
  checkSla(sla) {
    const snapshot = this.getSnapshot();
    const violations = [];

    if (sla.p95SocketRoundtrip != null) {
      const observed = snapshot.latencies?.socketRoundtrip?.p95;
      if (observed != null && observed > sla.p95SocketRoundtrip) {
        violations.push(
          `socketRoundtrip p95: ${observed}ms > ${sla.p95SocketRoundtrip}ms (SLA)`,
        );
      }
    }
    if (sla.p95TicketMarkLatency != null) {
      const observed = snapshot.latencies?.ticketMarkLatency?.p95;
      if (observed != null && observed > sla.p95TicketMarkLatency) {
        violations.push(
          `ticketMarkLatency p95: ${observed}ms > ${sla.p95TicketMarkLatency}ms (SLA)`,
        );
      }
    }
    if (sla.p99SocketRoundtrip != null) {
      const observed = snapshot.latencies?.socketRoundtrip?.p99;
      if (observed != null && observed > sla.p99SocketRoundtrip) {
        violations.push(
          `socketRoundtrip p99: ${observed}ms > ${sla.p99SocketRoundtrip}ms (SLA)`,
        );
      }
    }

    return { pass: violations.length === 0, violations };
  }
}

export function summarizeForConsole(snapshot) {
  const lines = [];
  lines.push(`Duration: ${(snapshot.durationMs / 1000).toFixed(1)}s`);

  if (Object.keys(snapshot.latencies).length > 0) {
    lines.push("\nLatency (ms):");
    lines.push(
      `  ${"metric".padEnd(28)} ${"count".padStart(8)} ${"mean".padStart(8)} ${"p50".padStart(8)} ${"p95".padStart(8)} ${"p99".padStart(8)} ${"max".padStart(8)}`,
    );
    for (const [metric, stats] of Object.entries(snapshot.latencies)) {
      lines.push(
        `  ${metric.padEnd(28)} ${String(stats.count).padStart(8)} ${String(stats.mean).padStart(8)} ${String(stats.p50).padStart(8)} ${String(stats.p95).padStart(8)} ${String(stats.p99).padStart(8)} ${String(stats.max).padStart(8)}`,
      );
    }
  }

  if (Object.keys(snapshot.counters).length > 0) {
    lines.push("\nCounters:");
    for (const [name, value] of Object.entries(snapshot.counters)) {
      lines.push(`  ${name.padEnd(36)} ${value}`);
    }
  }

  if (Object.keys(snapshot.gauges).length > 0) {
    lines.push("\nGauges:");
    for (const [name, value] of Object.entries(snapshot.gauges)) {
      lines.push(`  ${name.padEnd(36)} ${value}`);
    }
  }

  return lines.join("\n");
}
