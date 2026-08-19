/**
 * Lust Goddess Crate Cycle Scanner (v4.0.0 — reset + enhanced crates)
 * 
 * The game uses a shuffled pool of 70 crates per cycle:
 * - 56 Rare
 * - 10 Big Rare
 * - 3 Epic
 * - 1 Legendary
 * 
 * v3.0.0: Sliding window à 140 (2 cycles complets).
 * v3.1.0: Fenêtre repassée à 210 (3 cycles complets).
 * v3.2.0: Poids Legendary pour éviter les cycles sans Legendary.
 * v3.3.0: Scoring pondéré par rareté (R/B=1, E=5, L=20).
 * v3.4.0: Le scoring tranche seul, plus de surcharge « plus récent ».
 * v4.0.0: Support des enhanced crates (hors cycle) et des resets (rank up).
 *   - RecordEntry: type unifié pour crate/reset/enhanced.
 *   - extractCycleRecords() filtre les entrées pour le scanner.
 */

export type Rarity = 'Rare' | 'Big Rare' | 'Epic' | 'Legendary';

// ─── Record entry types ─────────────────────────────────────

/** Normal crate (part of the 70-cycle) */
export type CrateEntry = { t: 'c'; r: Rarity };
/** Enhanced crate (hors cycle — boosted rarity from league breach) */
export type EnhancedEntry = { t: 'e'; r: Rarity };
/** Cycle reset (league breach / rank up) */
export type ResetEntry = { t: 'r' };

export type RecordEntry = CrateEntry | EnhancedEntry | ResetEntry;

export function isCrateEntry(e: RecordEntry): e is CrateEntry {
  return e.t === 'c';
}

export function isEnhancedEntry(e: RecordEntry): e is EnhancedEntry {
  return e.t === 'e';
}

export function isResetEntry(e: RecordEntry): e is ResetEntry {
  return e.t === 'r';
}

// ─── Cycle constants ────────────────────────────────────────

export const CYCLE_SIZE = 70;
export const SCAN_WINDOW = CYCLE_SIZE * 3; // 210
export const MIN_RECORDS = CYCLE_SIZE * 3; // 210

export const EXPECTED: Record<Rarity, number> = {
  'Rare': 56,
  'Big Rare': 10,
  'Epic': 3,
  'Legendary': 1,
};

// Poids de scoring par rareté — basé sur la probabilité d'erreur selon la couleur:
const SCORE_WEIGHTS: Record<Rarity, number> = {
  'Rare': 1,
  'Big Rare': 1,
  'Epic': 5,
  'Legendary': 20,
};

export const RARITY_COLORS: Record<Rarity, { bg: string; text: string; border: string; dot: string; solid: string; ring: string }> = {
  'Rare': { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-300', dot: 'bg-sky-400', solid: 'bg-sky-400', ring: 'ring-sky-300' },
  'Big Rare': { bg: 'bg-cyan-100', text: 'text-cyan-900', border: 'border-cyan-300', dot: 'bg-cyan-500', solid: 'bg-cyan-500', ring: 'ring-cyan-400' },
  'Epic': { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300', dot: 'bg-purple-500', solid: 'bg-purple-500', ring: 'ring-purple-400' },
  'Legendary': { bg: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-400', dot: 'bg-amber-400', solid: 'bg-amber-500', ring: 'ring-amber-400' },
};

export const RARITY_SHORT: Record<Rarity, string> = {
  'Rare': 'R',
  'Big Rare': 'B',
  'Epic': 'E',
  'Legendary': 'L',
};

export const SHORT_TO_RARITY: Record<string, Rarity> = {
  'R': 'Rare', 'B': 'Big Rare', 'E': 'Epic', 'L': 'Legendary',
  'r': 'Rare', 'b': 'Big Rare', 'e': 'Epic', 'l': 'Legendary',
  'rare': 'Rare', 'big rare': 'Big Rare', 'bigrare': 'Big Rare',
  'epic': 'Epic', 'legendary': 'Legendary', 'lg': 'Legendary', 'br': 'Big Rare',
};

export interface CycleStats {
  dropped: number;
  remaining: number;
}

export interface RarityDeviation {
  expected: number;
  actual: number;
  diff: number;
}

export interface CycleErrorInfo {
  distance: number;
  details: Record<Rarity, RarityDeviation>;
}

export interface ScanResult {
  valid: boolean;
  cycleStart: number; // index within cycleRecords array
  currentCyclePosition: number;
  currentCycle: Rarity[];
  cycleHistory: Rarity[][];
  cycleValidities: boolean[];
  totalCycles: number;
  incompleteCycle: Rarity[];
  message: string;
  hasErrors: boolean;
  totalDistance: number;
  cycleErrors: (CycleErrorInfo | null)[];
  incompleteCycleErrors: CycleErrorInfo | null;
  windowStart: number; // index where the sliding window begins within cycleRecords
}

// ─── Extract cycle-only records for scanning ───────────────

/**
 * From the full entry list, extract only cycle crates after the last reset.
 * Enhanced crates and pre-reset data are excluded from scanning.
 */
export function extractCycleRecords(entries: RecordEntry[]): Rarity[] {
  let lastResetIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].t === 'r') {
      lastResetIdx = i;
      break;
    }
  }
  const rarities: Rarity[] = [];
  for (let i = lastResetIdx + 1; i < entries.length; i++) {
    if (entries[i].t === 'c') {
      rarities.push((entries[i] as CrateEntry).r);
    }
  }
  return rarities;
}

/** Count enhanced crates (for display) */
export function countEnhanced(entries: RecordEntry[]): number {
  return entries.filter((e) => e.t === 'e').length;
}

/** Count resets (for display) */
export function countResets(entries: RecordEntry[]): number {
  return entries.filter((e) => e.t === 'r').length;
}

// ─── Internal scanner helpers ───────────────────────────────

function countRarities(segment: Rarity[]): Record<Rarity, number> {
  const counts: Record<Rarity, number> = { 'Rare': 0, 'Big Rare': 0, 'Epic': 0, 'Legendary': 0 };
  for (const r of segment) {
    counts[r]++;
  }
  return counts;
}

function isValidCycle(segment: Rarity[]): boolean {
  if (segment.length !== CYCLE_SIZE) return false;
  const counts = countRarities(segment);
  for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
    if (counts[rarity] !== EXPECTED[rarity]) return false;
  }
  return true;
}

function cycleDistance(segment: Rarity[]): number {
  if (segment.length !== CYCLE_SIZE) return Infinity;
  const counts = countRarities(segment);
  let distance = 0;
  for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
    distance += Math.abs(counts[rarity] - EXPECTED[rarity]);
  }
  return distance;
}

function getCycleErrorInfo(segment: Rarity[]): CycleErrorInfo {
  const counts = countRarities(segment);
  const details: Record<Rarity, RarityDeviation> = {} as Record<Rarity, RarityDeviation>;
  let distance = 0;
  for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
    const actual = counts[rarity];
    const diff = actual - EXPECTED[rarity];
    distance += Math.abs(diff);
    details[rarity] = { expected: EXPECTED[rarity], actual, diff };
  }
  return { distance, details };
}

// ─── Scanner ────────────────────────────────────────────────

export function scanCycles(records: Rarity[]): ScanResult {
  const defaultResult: ScanResult = {
    valid: false, cycleStart: -1, currentCyclePosition: -1,
    currentCycle: [], cycleHistory: [], cycleValidities: [],
    totalCycles: 0, incompleteCycle: [], message: '',
    hasErrors: false, totalDistance: 0, cycleErrors: [],
    incompleteCycleErrors: null, windowStart: 0,
  };

  if (records.length < MIN_RECORDS) {
    const needed = MIN_RECORDS - records.length;
    defaultResult.message = `Besoin d'au moins ${MIN_RECORDS} enregistrements pour scanner. Actuel: ${records.length}. Il en manque ${needed}!`;
    return defaultResult;
  }

  // ─── Sliding window ───
  let windowRecords: Rarity[];
  let windowOffset: number;
  if (records.length > SCAN_WINDOW) {
    windowRecords = records.slice(-SCAN_WINDOW);
    windowOffset = records.length - SCAN_WINDOW;
  } else {
    windowRecords = records;
    windowOffset = 0;
  }

  // ─── Fuzzy scoring ───
  let bestScore = -Infinity;
  let bestStart = 0;
  let bestPerfectCount = 0;
  let bestWeightedDist = 0;

  const maxStart = windowRecords.length - CYCLE_SIZE;

  for (let i = 0; i <= maxStart; i++) {
    const remaining = windowRecords.length - i;
    const numCycles = Math.floor(remaining / CYCLE_SIZE);
    let perfectCount = 0;
    let weightedDistance = 0;

    for (let j = 0; j < numCycles; j++) {
      const segStart = i + j * CYCLE_SIZE;
      const segment = windowRecords.slice(segStart, segStart + CYCLE_SIZE);
      const counts = countRarities(segment);
      let segWeightedDist = 0;
      let segPerfect = true;
      for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
        const diff = Math.abs(counts[rarity] - EXPECTED[rarity]);
        if (diff > 0) segPerfect = false;
        segWeightedDist += diff * SCORE_WEIGHTS[rarity];
      }
      weightedDistance += segWeightedDist * (1 + j * 0.15);
      if (segPerfect) perfectCount++;
    }

    const score = (perfectCount * 10000) - weightedDistance;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
      bestPerfectCount = perfectCount;
      bestWeightedDist = weightedDistance;
    }
  }

  const chosenStart = bestStart;
  const isPerfect = bestWeightedDist === 0 && bestPerfectCount > 0;

  if (isPerfect) {
    const rem = windowRecords.length - chosenStart;
    const nc = Math.floor(rem / CYCLE_SIZE);
    defaultResult.message = `${nc} cycle${nc > 1 ? 's' : ''} parfait${nc > 1 ? 's' : ''} trouvé${nc > 1 ? 's' : ''} ! 🎯`;
  } else {
    const rem = windowRecords.length - chosenStart;
    const nc = Math.floor(rem / CYCLE_SIZE);
    let totalDist = 0;
    for (let j = 0; j < nc; j++) {
      totalDist += cycleDistance(windowRecords.slice(chosenStart + j * CYCLE_SIZE, chosenStart + j * CYCLE_SIZE + CYCLE_SIZE));
    }
    defaultResult.message = `Aucun cycle parfait trouvé (écart total: ${totalDist}). Meilleure estimation affichée — erreurs de saisie probables.`;
  }

  // ─── Extract cycles ───
  const remaining = windowRecords.length - chosenStart;
  const numCycles = Math.floor(remaining / CYCLE_SIZE);
  const cycles: Rarity[][] = [];
  const cycleValidities: boolean[] = [];
  const cycleErrors: (CycleErrorInfo | null)[] = [];
  let totalDistance = 0;
  let hasErrors = false;

  for (let j = 0; j < numCycles; j++) {
    const segStart = chosenStart + j * CYCLE_SIZE;
    const segment = windowRecords.slice(segStart, segStart + CYCLE_SIZE);
    const valid = isValidCycle(segment);
    const errorInfo = getCycleErrorInfo(segment);
    cycles.push(segment);
    cycleValidities.push(valid);
    cycleErrors.push(errorInfo.distance > 0 ? errorInfo : null);
    totalDistance += errorInfo.distance;
    if (errorInfo.distance > 0) hasErrors = true;
  }

  const incomplete = windowRecords.slice(chosenStart + numCycles * CYCLE_SIZE);
  const incompleteErrors = incomplete.length > 0 ? getCycleErrorInfo(incomplete) : null;

  const currentCycle = cycles.length > 0 ? cycles[cycles.length - 1] : [];
  const currentCyclePosition = incomplete.length;
  const absoluteCycleStart = chosenStart + windowOffset;

  const hasCycleWithoutLegendary = cycles.some(
    (c) => c.length === CYCLE_SIZE && countRarities(c)['Legendary'] === 0
  );
  defaultResult.valid = !hasCycleWithoutLegendary &&
    (isPerfect || cycleValidities.filter(Boolean).length > 0 || totalDistance <= numCycles * 6);
  defaultResult.cycleStart = absoluteCycleStart;
  defaultResult.currentCyclePosition = currentCyclePosition;
  defaultResult.currentCycle = currentCycle;
  defaultResult.cycleHistory = cycles;
  defaultResult.cycleValidities = cycleValidities;
  defaultResult.totalCycles = numCycles;
  defaultResult.incompleteCycle = incomplete;
  defaultResult.hasErrors = hasErrors;
  defaultResult.totalDistance = totalDistance;
  defaultResult.cycleErrors = cycleErrors;
  defaultResult.incompleteCycleErrors = incompleteErrors;
  defaultResult.windowStart = windowOffset;

  return defaultResult;
}

export function getCycleStats(
  incompleteCycle: Rarity[],
  _lastCompleteCycle?: Rarity[]
): Record<Rarity, CycleStats> {
  const counts = countRarities(incompleteCycle);
  const stats: Record<Rarity, CycleStats> = {} as Record<Rarity, CycleStats>;
  for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
    const dropped = counts[rarity];
    stats[rarity] = { dropped, remaining: EXPECTED[rarity] - dropped };
  }
  return stats;
}

/**
 * After a rank-up reset, the cycle start is known (position 0).
 * Slice records into complete cycles + incomplete, without needing 210 records.
 */
export function scanPostReset(records: Rarity[]): ScanResult {
  const numComplete = Math.floor(records.length / CYCLE_SIZE);
  const incomplete = records.slice(numComplete * CYCLE_SIZE);

  const cycles: Rarity[][] = [];
  const cycleValidities: boolean[] = [];
  const cycleErrors: (CycleErrorInfo | null)[] = [];
  let totalDistance = 0;
  let hasErrors = false;

  for (let j = 0; j < numComplete; j++) {
    const segment = records.slice(j * CYCLE_SIZE, (j + 1) * CYCLE_SIZE);
    const valid = isValidCycle(segment);
    const errorInfo = getCycleErrorInfo(segment);
    cycles.push(segment);
    cycleValidities.push(valid);
    cycleErrors.push(errorInfo.distance > 0 ? errorInfo : null);
    totalDistance += errorInfo.distance;
    if (errorInfo.distance > 0) hasErrors = true;
  }

  const incompleteErrors = incomplete.length > 0 ? getCycleErrorInfo(incomplete) : null;

  return {
    valid: true,
    cycleStart: 0,
    currentCyclePosition: incomplete.length,
    currentCycle: cycles.length > 0 ? cycles[cycles.length - 1] : [],
    cycleHistory: cycles,
    cycleValidities,
    totalCycles: numComplete,
    incompleteCycle: incomplete,
    message: numComplete > 0
      ? `${numComplete} cycle${numComplete > 1 ? 's' : ''} post-rank up • Position : ${incomplete.length}/${CYCLE_SIZE}`
      : `Cycle post-rank up — position ${records.length}/${CYCLE_SIZE}`,
    hasErrors,
    totalDistance,
    cycleErrors,
    incompleteCycleErrors: incompleteErrors,
    windowStart: 0,
  };
}

// ─── Import / Export ────────────────────────────────────────

/**
 * Parse import text. Supports:
 * - Old format: R, B, E, L, r, b, e, l
 * - New format: *R, *B (enhanced), [RESET]
 * - Compact: RRBELL
 */
export function parseImportText(text: string): RecordEntry[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  // Split by newlines first (for line-based [RESET] markers)
  const lines = cleaned.split(/\n/).filter(Boolean);
  const entries: RecordEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for [RESET] marker
    if (/^\[RESET\]$/i.test(trimmed)) {
      entries.push({ t: 'r' });
      continue;
    }

    // Split tokens by comma/semicolon/tab/space/pipe
    let tokens = trimmed.split(/[,;\t\r|\s]+/).filter(Boolean);

    // Compact single-string format: RRBELL
    if (tokens.length === 1 && tokens[0].length > 1 && /^[rRbBeElL*]+$/.test(tokens[0])) {
      tokens = tokens[0].split('');
    }

    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i].trim();
      if (!token) { i++; continue; }

      // Enhanced marker: *R, *B, *E, *L
      if (token.startsWith('*') && token.length >= 2) {
        const key = token.slice(1).toUpperCase();
        const rarity = SHORT_TO_RARITY[key];
        if (rarity) {
          entries.push({ t: 'e', r: rarity });
        }
        i++;
        continue;
      }

      // Normal rarity
      const upper = token.toUpperCase();
      if (['R', 'B', 'E', 'L'].includes(upper)) {
        entries.push({ t: 'c', r: SHORT_TO_RARITY[upper] });
        i++;
        continue;
      }

      // Full names
      const lower = token.toLowerCase();
      if (lower === '[reset]') {
        entries.push({ t: 'r' });
      } else {
        const mapped = SHORT_TO_RARITY[lower];
        if (mapped) {
          entries.push({ t: 'c', r: mapped });
        }
      }
      i++;
    }
  }
  return entries;
}

/** Export entries to text format */
export function exportEntriesText(entries: RecordEntry[]): string {
  return entries.map((e) => {
    if (e.t === 'r') return '[RESET]';
    if (e.t === 'e') return `*${RARITY_SHORT[e.r]}`;
    return RARITY_SHORT[e.r];
  }).join(', ');
}

/**
 * Migrate old format (Rarity[]) to new format (RecordEntry[]).
 * Returns null if already in new format.
 */
export function migrateOldFormat(data: unknown): RecordEntry[] | null {
  if (!Array.isArray(data)) return null;
  if (data.length === 0) return [];
  const first = data[0];
  // New format: first element is an object with 't' property
  if (typeof first === 'object' && first !== null && 't' in first) return null;
  // Old format: array of strings
  if (typeof first === 'string') {
    return (data as string[]).map((s) => {
      const rarity = SHORT_TO_RARITY[s] || SHORT_TO_RARITY[s.toLowerCase()];
      return rarity ? { t: 'c' as const, r: rarity } : { t: 'c' as const, r: 'Rare' as Rarity };
    });
  }
  return null;
}
