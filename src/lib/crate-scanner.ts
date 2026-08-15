/**
 * Lust Goddess Crate Cycle Scanner (v2 — fuzzy matching)
 * 
 * The game uses a shuffled pool of 70 crates per cycle:
 * - 56 Rare
 * - 10 Big Rare
 * - 3 Epic
 * - 1 Legendary
 * 
 * v2 uses distance-based scoring to tolerate small data entry errors
 * (wrong rarity, missed/extra record) while still finding the best
 * cycle alignment.
 */

export type Rarity = 'Rare' | 'Big Rare' | 'Epic' | 'Legendary';

export const CYCLE_SIZE = 70;
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

export interface CycleStats {
  dropped: number;
  remaining: number;
}

export interface RarityDeviation {
  expected: number;
  actual: number;
  diff: number; // positive = too many, negative = too few
}

export interface CycleErrorInfo {
  distance: number; // total absolute deviation (0 = perfect)
  details: Record<Rarity, RarityDeviation>;
}

export interface ScanResult {
  valid: boolean;
  cycleStart: number;
  currentCyclePosition: number;
  currentCycle: Rarity[];
  cycleHistory: Rarity[][];
  cycleValidities: boolean[];
  totalCycles: number;
  incompleteCycle: Rarity[];
  message: string;
  // v2 — fuzzy error info
  hasErrors: boolean; // true if any complete cycle has distance > 0
  totalDistance: number; // sum of distances across all complete cycles
  cycleErrors: (CycleErrorInfo | null)[]; // null = perfect, object = error details
  incompleteCycleErrors: CycleErrorInfo | null; // current incomplete cycle deviations
}

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

/** Total absolute deviation from expected distribution (0 = perfect) */
function cycleDistance(segment: Rarity[]): number {
  if (segment.length !== CYCLE_SIZE) return Infinity;
  const counts = countRarities(segment);
  let distance = 0;
  for (const rarity of Object.keys(EXPECTED) as Rarity[]) {
    distance += Math.abs(counts[rarity] - EXPECTED[rarity]);
  }
  return distance;
}

/** Detailed per-rarity deviation info for a segment */
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

export function scanCycles(records: Rarity[]): ScanResult {
  const defaultResult: ScanResult = {
    valid: false,
    cycleStart: -1,
    currentCyclePosition: -1,
    currentCycle: [],
    cycleHistory: [],
    cycleValidities: [],
    totalCycles: 0,
    incompleteCycle: [],
    message: '',
    hasErrors: false,
    totalDistance: 0,
    cycleErrors: [],
    incompleteCycleErrors: null,
  };

  if (records.length < CYCLE_SIZE * 3) {
    const needed = CYCLE_SIZE * 3 - records.length;
    defaultResult.message = `Besoin d'au moins 210 enregistrements (3 cycles complets) pour scanner. Actuel: ${records.length}. Il en manque ${needed}!`;
    return defaultResult;
  }

  // ─── Fuzzy scoring: try each possible start position ───
  // Score = (perfect cycles * 10000) - weighted total distance
  // This strongly prefers perfect cycles but still ranks imperfect ones

  let bestScore = -Infinity;
  let bestStart = 0;
  const perfectStarts: number[] = [];

  const maxStart = records.length - CYCLE_SIZE;

  for (let i = 0; i <= maxStart; i++) {
    const remaining = records.length - i;
    const numCycles = Math.floor(remaining / CYCLE_SIZE);
    let perfectCount = 0;
    let weightedDistance = 0;
    let allPerfect = true;

    for (let j = 0; j < numCycles; j++) {
      const segStart = i + j * CYCLE_SIZE;
      const segment = records.slice(segStart, segStart + CYCLE_SIZE);
      const dist = cycleDistance(segment);
      // Weight later cycles slightly more (they're more recent, more likely correct)
      weightedDistance += dist * (1 + j * 0.15);
      if (dist === 0) {
        perfectCount++;
      } else {
        allPerfect = false;
      }
    }

    const score = (perfectCount * 10000) - weightedDistance;

    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }

    if (allPerfect && numCycles > 0) {
      perfectStarts.push(i);
    }
  }

  // ─── Determine which start to use ─────────────────────

  let chosenStart: number;
  let isPerfect: boolean;

  if (perfectStarts.length > 0) {
    // Perfect starts exist — pick the one with most perfect cycles (they all have 0 distance)
    chosenStart = perfectStarts[perfectStarts.length - 1]; // prefer latest start (more data after)
    isPerfect = true;
    if (perfectStarts.length === 1) {
      defaultResult.message = 'Correspondance de cycle parfaite trouvée ! 🎯';
    } else {
      defaultResult.message = `${perfectStarts.length} positions de départ possibles. La plus récente est affichée.`;
    }
  } else {
    // No perfect start — use fuzzy best
    chosenStart = bestStart;
    isPerfect = false;
    // Compute the total distance for the chosen start to quantify errors
    const rem = records.length - chosenStart;
    const nc = Math.floor(rem / CYCLE_SIZE);
    let totalDist = 0;
    for (let j = 0; j < nc; j++) {
      totalDist += cycleDistance(records.slice(chosenStart + j * CYCLE_SIZE, chosenStart + j * CYCLE_SIZE + CYCLE_SIZE));
    }
    defaultResult.message = `Aucun cycle parfait trouvé (écart total: ${totalDist}). Meilleure estimation affichée — il y a probablement des erreurs de saisie.`;
  }

  // ─── Extract cycles from the chosen start ─────────────

  const remaining = records.length - chosenStart;
  const numCycles = Math.floor(remaining / CYCLE_SIZE);
  const cycles: Rarity[][] = [];
  const cycleValidities: boolean[] = [];
  const cycleErrors: (CycleErrorInfo | null)[] = [];
  let totalDistance = 0;
  let hasErrors = false;

  for (let j = 0; j < numCycles; j++) {
    const segStart = chosenStart + j * CYCLE_SIZE;
    const segment = records.slice(segStart, segStart + CYCLE_SIZE);
    const valid = isValidCycle(segment);
    const errorInfo = getCycleErrorInfo(segment);
    cycles.push(segment);
    cycleValidities.push(valid);
    cycleErrors.push(errorInfo.distance > 0 ? errorInfo : null);
    totalDistance += errorInfo.distance;
    if (errorInfo.distance > 0) hasErrors = true;
  }

  const incomplete = records.slice(chosenStart + numCycles * CYCLE_SIZE);
  const incompleteErrors = incomplete.length > 0 ? getCycleErrorInfo(incomplete) : null;

  const currentCycle = cycles.length > 0 ? cycles[cycles.length - 1] : [];
  const currentCyclePosition = incomplete.length;

  defaultResult.valid = isPerfect || cycleValidities.filter(Boolean).length > 0 || totalDistance <= numCycles * 6;
  defaultResult.cycleStart = chosenStart;
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

  return defaultResult;
}

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

export function parseImportText(text: string): Rarity[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  let tokens = cleaned.split(/[,;\t\n\r|\s]+/).filter(Boolean);

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
