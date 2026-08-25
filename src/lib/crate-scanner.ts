/**
 * Lust Goddess Crate Cycle Scanner
 * 
 * The game uses a shuffled pool of 70 crates per cycle:
 * - 56 Rare
 * - 10 Big Rare
 * - 3 Epic
 * - 1 Legendary
 * 
 * Supports post-reset (Rank Up) mode where the cycle start is known (position 0
 * of post-reset data).
 */

export type Rarity = 'Rare' | 'Big Rare' | 'Epic' | 'Legendary';

export const CYCLE_SIZE = 70;
export const MIN_RECORDS = CYCLE_SIZE * 3; // 210 for scan mode

export const EXPECTED: Record<Rarity, number> = {
  'Rare': 56,
  'Big Rare': 10,
  'Epic': 3,
  'Legendary': 1,
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
  'R': 'Rare',
  'B': 'Big Rare',
  'E': 'Epic',
  'L': 'Legendary',
  'r': 'Rare',
  'b': 'Big Rare',
  'e': 'Epic',
  'l': 'Legendary',
  'rare': 'Rare',
  'big rare': 'Big Rare',
  'bigrare': 'Big Rare',
  'epic': 'Epic',
  'legendary': 'Legendary',
  'lg': 'Legendary',
  'br': 'Big Rare',
};

export const RARITY_TO_SHORT: Record<Rarity, string> = {
  'Rare': 'R',
  'Big Rare': 'B',
  'Epic': 'E',
  'Legendary': 'L',
};

export interface CycleStats {
  dropped: number;
  remaining: number;
}

export interface CycleErrorInfo {
  missing: Partial<Record<Rarity, number>>;  // expected count - actual count (negative = extra)
  hasError: boolean;
}

export interface ScanResult {
  valid: boolean;
  cycleStart: number; // 0-based index in the input records where the cycle starts
  currentCyclePosition: number; // 0-69 position within the current (incomplete) cycle
  currentCycle: Rarity[]; // The 70 items of the most recent COMPLETE cycle
  cycleHistory: Rarity[][]; // All complete cycles found
  cycleValidities: boolean[]; // Whether each cycle is valid
  cycleErrors: CycleErrorInfo[]; // Per-cycle error details
  totalCycles: number;
  incompleteCycle: Rarity[]; // Items after the last complete cycle (current in-progress cycle)
  message: string;
}

// ─── Record Entry types ────────────────────────────────────

export type RecordEntry =
  | { t: 'c'; r: Rarity }   // normal crate
  | { t: 'e'; r: Rarity }   // enhanced crate (hors cycle)
  | { t: 'r' };             // reset marker (rank up)

export function isResetEntry(e: RecordEntry): e is { t: 'r' } {
  return e.t === 'r';
}

export function isEnhancedEntry(e: RecordEntry): e is { t: 'e'; r: Rarity } {
  return e.t === 'e';
}

export function isCrateEntry(e: RecordEntry): e is { t: 'c'; r: Rarity } {
  return e.t === 'c';
}

/**
 * Extract only normal crate entries after the LAST reset.
 * Enhanced ('e') entries are excluded from cycle tracking.
 * If there's no reset, returns all normal crate entries.
 */
export function extractCycleRecords(records: RecordEntry[]): Rarity[] {
  // Find the position of the last reset
  let lastResetIdx = -1;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].t === 'r') {
      lastResetIdx = i;
      break;
    }
  }

  // Return only normal crates ('c') after the last reset
  const result: Rarity[] = [];
  for (let i = lastResetIdx + 1; i < records.length; i++) {
    if (records[i].t === 'c') {
      result.push((records[i] as { t: 'c'; r: Rarity }).r);
    }
  }
  return result;
}

/** Check if there's any reset in the records */
export function hasResetMarker(records: RecordEntry[]): boolean {
  return records.some(e => e.t === 'r');
}

// ─── Internal helpers ──────────────────────────────────────

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

function getCycleErrorInfo(segment: Rarity[]): CycleErrorInfo {
  if (segment.length !== CYCLE_SIZE) return { missing: {}, hasError: false };
  const counts = countRarities(segment);
  const missing: Partial<Record<Rarity, number>> = {};
  let hasError = false;
  for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
    const diff = counts[rarity] - EXPECTED[rarity];
    if (diff !== 0) {
      missing[rarity] = diff;
      hasError = true;
    }
  }
  return { missing, hasError };
}

// ─── Scan without reset (original algorithm) ──────────────

export function scanCycles(records: Rarity[]): ScanResult {
  const defaultResult: ScanResult = {
    valid: false,
    cycleStart: -1,
    currentCyclePosition: -1,
    currentCycle: [],
    cycleHistory: [],
    cycleValidities: [],
    cycleErrors: [],
    totalCycles: 0,
    incompleteCycle: [],
    message: '',
  };

  if (records.length < MIN_RECORDS) {
    const needed = MIN_RECORDS - records.length;
    defaultResult.message = `Besoin d'au moins 210 enregistrements (3 cycles complets) pour scanner. Actuel: ${records.length}. Il en manque ${needed}!`;
    return defaultResult;
  }

  // Try each possible start position
  let bestScore = -1;
  let bestStart = 0;
  const validStarts: number[] = [];

  const maxStart = records.length - CYCLE_SIZE;

  for (let i = 0; i <= maxStart; i++) {
    let score = 0;
    let allValid = true;
    const remaining = records.length - i;
    const numCycles = Math.floor(remaining / CYCLE_SIZE);

    for (let j = 0; j < numCycles; j++) {
      const segStart = i + j * CYCLE_SIZE;
      const segment = records.slice(segStart, segStart + CYCLE_SIZE);
      if (isValidCycle(segment)) {
        const weight = Math.floor((j + 1) / numCycles) * j;
        score += weight + 1;
      } else {
        allValid = false;
      }
    }

    if (score >= bestScore) {
      bestScore = score;
      bestStart = i;
    }

    if (allValid && numCycles > 0) {
      validStarts.push(i);
    }
  }

  // Determine which start to use
  let chosenStart: number = 0;
  let isPerfect = false;

  if (validStarts.length === 0) {
    chosenStart = bestStart;
    defaultResult.message = "Aucune correspondance parfaite trouvée. Il peut y avoir des erreurs dans l' historique. Meilleure estimation affichée.";
  } else if (validStarts.length === 1) {
    chosenStart = validStarts[0];
    isPerfect = true;
    defaultResult.message = 'Correspondance de cycle parfaite trouvée ! 🎯';
  } else {
    // Multiple valid starts - pick the one with highest score
    let bestValidScore = -1;
    for (const vs of validStarts) {
      const remaining = records.length - vs;
      const numCycles = Math.floor(remaining / CYCLE_SIZE);
      let vsScore = 0;
      for (let j = 0; j < numCycles; j++) {
        const segStart = vs + j * CYCLE_SIZE;
        const segment = records.slice(segStart, segStart + CYCLE_SIZE);
        if (isValidCycle(segment)) {
          const weight = Math.floor((j + 1) / numCycles) * j;
          vsScore += weight + 1;
        }
      }
      if (vsScore > bestValidScore) {
        bestValidScore = vsScore;
        chosenStart = vs;
      }
    }
    isPerfect = true;
    defaultResult.message = `${validStarts.length} positions de départ possibles trouvées. La plus optimale est affichée. Plus de données peuvent préciser.`;
  }

  // Extract cycles from the chosen start
  const remaining = records.length - chosenStart;
  const numCycles = Math.floor(remaining / CYCLE_SIZE);
  const cycles: Rarity[][] = [];
  const cycleValidities: boolean[] = [];
  const cycleErrors: CycleErrorInfo[] = [];

  for (let j = 0; j < numCycles; j++) {
    const segStart = chosenStart + j * CYCLE_SIZE;
    const segment = records.slice(segStart, segStart + CYCLE_SIZE);
    cycles.push(segment);
    cycleValidities.push(isValidCycle(segment));
    cycleErrors.push(getCycleErrorInfo(segment));
  }

  const incomplete = records.slice(chosenStart + numCycles * CYCLE_SIZE);

  const currentCycle = cycles.length > 0 ? cycles[cycles.length - 1] : [];
  const currentCyclePosition = incomplete.length;

  defaultResult.valid = isPerfect || cycleValidities.filter(Boolean).length > 0;
  defaultResult.cycleStart = chosenStart;
  defaultResult.currentCyclePosition = currentCyclePosition;
  defaultResult.currentCycle = currentCycle;
  defaultResult.cycleHistory = cycles;
  defaultResult.cycleValidities = cycleValidities;
  defaultResult.cycleErrors = cycleErrors;
  defaultResult.totalCycles = numCycles;
  defaultResult.incompleteCycle = incomplete;

  if (!defaultResult.message) {
    defaultResult.message = `${numCycles} cycle(s) trouvé(s) à partir de l' enregistrement #${chosenStart + 1}.`;
  }

  return defaultResult;
}

// ─── Scan after reset (cycle start is known = position 0) ──

/**
 * Scan records that come after a reset. Since the cycle start is known
 * (it's the first crate after the reset), we simply divide into 70-crate
 * cycles starting at position 0.
 * 
 * Errors are detected and reported per cycle but we do NOT try to find
 * a different cycle start — the reset guarantees position 0 is correct.
 */
export function scanPostReset(records: Rarity[]): ScanResult {
  const numComplete = Math.floor(records.length / CYCLE_SIZE);
  const incomplete = records.slice(numComplete * CYCLE_SIZE);

  const cycles: Rarity[][] = [];
  const cycleValidities: boolean[] = [];
  const cycleErrors: CycleErrorInfo[] = [];

  for (let j = 0; j < numComplete; j++) {
    const segStart = j * CYCLE_SIZE;
    const segment = records.slice(segStart, segStart + CYCLE_SIZE);
    cycles.push(segment);
    const valid = isValidCycle(segment);
    cycleValidities.push(valid);
    cycleErrors.push(getCycleErrorInfo(segment));
  }

  // Check if any cycle has errors
  const hasAnyError = cycleErrors.some(e => e.hasError);
  const allValid = cycleValidities.every(Boolean);

  // Build message
  let message = '';
  if (records.length === 0) {
    message = 'Aucun enregistrement après le Rank Up.';
  } else if (numComplete === 0) {
    message = `Cycle post-Rank Up — position ${incomplete.length}/${CYCLE_SIZE}`;
  } else if (allValid) {
    message = `${numComplete} cycle(s) post-Rank Up trouvé(s) — tout est cohérent ✓`;
  } else {
    const errorCount = cycleErrors.filter(e => e.hasError).length;
    message = `${numComplete} cycle(s) post-Rank Up — ${errorCount} cycle(s) avec anomalie(s) détectée(s). Le démarrage au Rank Up reste fiable.`;
  }

  const currentCycle = cycles.length > 0 ? cycles[cycles.length - 1] : [];

  return {
    valid: true, // Post-reset always has a valid known start
    cycleStart: 0, // Always 0 for post-reset
    currentCyclePosition: incomplete.length,
    currentCycle,
    cycleHistory: cycles,
    cycleValidities,
    cycleErrors,
    totalCycles: numComplete,
    incompleteCycle: incomplete,
    message,
  };
}

// ─── Cycle stats ───────────────────────────────────────────

export function getCycleStats(
  incompleteCycle: Rarity[],
  lastCompleteCycle?: Rarity[]
): Record<Rarity, CycleStats> {
  const counts = countRarities(incompleteCycle);
  const stats: Record<Rarity, CycleStats> = {} as Record<Rarity, CycleStats>;
  for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
    const dropped = counts[rarity];
    stats[rarity] = {
      dropped,
      remaining: EXPECTED[rarity] - dropped,
    };
  }
  return stats;
}

// ─── Import parsing (old format — just rarities) ───────────

export function parseImportText(text: string): Rarity[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  let tokens = cleaned.split(/[,;\t\n\r|\s]+/).filter(Boolean);

  // If it's a single long string like "RRRBREEERRLLBBBR", split into individual chars
  if (tokens.length === 1 && tokens[0].length > 1 && /^[rRbBeElL]+$/.test(tokens[0])) {
    tokens = tokens[0].split('');
  }

  const rarities: Rarity[] = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();
    if (['R', 'B', 'E', 'L'].includes(upper)) {
      rarities.push(SHORT_TO_RARITY[upper]);
    } else {
      const lower = trimmed.toLowerCase();
      const mapped = SHORT_TO_RARITY[lower];
      if (mapped) {
        rarities.push(mapped);
      }
    }
  }
  return rarities;
}

// ─── Export/Import in new RecordEntry format ────────────────

/**
 * Parse new format export text into RecordEntry array.
 * Format: each line is "c:R" (normal), "e:B" (enhanced), or "r" (reset)
 * Also supports JSON array of RecordEntry.
 */
export function parseImportNewFormat(text: string): RecordEntry[] | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  // Try JSON parse first
  if (cleaned.startsWith('[')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        const entries: RecordEntry[] = [];
        for (const item of parsed) {
          if (typeof item === 'object' && item !== null) {
            if (item.t === 'r') {
              entries.push({ t: 'r' });
            } else if (item.t === 'c' || item.t === 'e') {
              const rarity = item.r as Rarity;
              if (rarity && RARITY_SHORT[rarity]) {
                entries.push({ t: item.t, r: rarity });
              }
            }
          }
        }
        if (entries.length > 0) return entries;
      }
    } catch {
      // Not valid JSON, try line format
    }
  }

  // Try line format: c:R, e:B, r
  const lines = cleaned.split(/[\n\r]+/).filter(Boolean);
  const entries: RecordEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'r' || trimmed === 'RESET' || trimmed === 'reset') {
      entries.push({ t: 'r' });
    } else if (trimmed.includes(':')) {
      const [type, rarStr] = trimmed.split(':', 2);
      const t = type.trim().toLowerCase();
      const r = rarStr.trim().toUpperCase();
      if ((t === 'c' || t === 'e') && ['R', 'B', 'E', 'L'].includes(r)) {
        entries.push({ t, r: SHORT_TO_RARITY[r] });
      }
    }
  }
  return entries.length > 0 ? entries : null;
}

/** Export records to text format (one entry per line) */
export function exportToText(records: RecordEntry[]): string {
  return records.map(entry => {
    if (entry.t === 'r') return 'r';
    return `${entry.t}:${RARITY_TO_SHORT[entry.r]}`;
  }).join('\n');
}

/** Export only the rarity sequence (old format, for compatibility) */
export function exportToOldFormat(records: RecordEntry[]): string {
  return records
    .filter((e): e is { t: 'c'; r: Rarity } => e.t === 'c')
    .map(e => RARITY_TO_SHORT[e.r])
    .join(',');
}
