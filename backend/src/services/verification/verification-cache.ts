// §2.6 — LRU verification cache with composite cache key.
// registryVersion invariant: hashes registry-defined definitions ONLY.
// HARDCODED_WIDGETS changes must bump KNOWLEDGE_VERSION, never registryVersion.

import { createHash } from 'crypto';
import type { AnalyzeResult } from './types';
import { KNOWLEDGE_VERSION } from './knowledge/index';

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

// Recursive key-sorted stringify for stable cache keys.
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v !== null && typeof v === 'object') {
    const sorted = Object.keys(v as object).sort().map(k =>
      JSON.stringify(k) + ':' + stableStringify((v as any)[k])
    );
    return '{' + sorted.join(',') + '}';
  }
  return JSON.stringify(v);
}

// Bump these when the corresponding logic changes.
// CODEGEN_VERSION is a manual bump — set via environment or import.
export const CODEGEN_VERSION = process.env.CODEGEN_VERSION ?? '1.0.0';
export const STATIC_VALIDATOR_VERSION = '1.0.0';

export function buildCacheKey(
  appState: unknown,
  registryVersion: string,
): string {
  return createHash('sha256').update(
    stableStringify({
      appState,
      registryVersion,
      knowledgeVersion: KNOWLEDGE_VERSION,
      codegenVersion: CODEGEN_VERSION,
      validatorVersion: STATIC_VALIDATOR_VERSION,
    })
  ).digest('hex').slice(0, 16);
}

export class VerificationCache {
  private map = new Map<string, AnalyzeResult>();
  private order: string[] = [];
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, size: 0 };

  constructor(private maxEntries = 256) {}

  get(key: string): AnalyzeResult | undefined {
    const entry = this.map.get(key);
    if (!entry) { this.stats.misses++; return undefined; }
    this.stats.hits++;
    // Move to MRU
    this.order = [key, ...this.order.filter(k => k !== key)];
    return { ...entry, fromCache: true };
  }

  set(key: string, value: AnalyzeResult): void {
    if (value.source === 'static-only-degraded') return; // never cache degraded
    if (this.map.has(key)) {
      this.order = [key, ...this.order.filter(k => k !== key)];
    } else {
      if (this.order.length >= this.maxEntries) {
        const evict = this.order.pop()!;
        this.map.delete(evict);
        this.stats.evictions++;
      }
      this.order.unshift(key);
    }
    this.map.set(key, value);
    this.stats.size = this.map.size;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }
}
