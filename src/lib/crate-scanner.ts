/**
 * Lust Goddess Crate Cycle Scanner (v3.2.0 — Legendary-weighted scoring)
 * 
 * The game uses a shuffled pool of 70 crates per cycle:
 * - 56 Rare
 * - 10 Big Rare
 * - 3 Epic
 * - 1 Legendary
 * 
 * v3.0.0: Sliding window à 140 enregistrements (2 cycles complets).
 * v3.1.0: Fenêtre repassée à 210 enregistrements (3 cycles complets).
 * v3.2.0: Scoring pondéré par Legendary — un cycle complet sans Legendary
 *   est lourdement pénalisé car c'est le signal de frontière le plus fort.
 *   Un cycle sans Legendary ne peut jamais être considéré « valide ».
 */

export type Rarity = 'Rare' | 'Big Rare' | 'Epic' | 'Legendary';

export const CYCLE_SIZE = 70;
export const SCAN_WINDOW = CYCLE_SIZE * 3; // 210 — sliding window size
export const MIN_RECORDS = CYCLE_SIZE * 3; // 210 — minimum to attempt scan

export const EXPECTED: Record<Rarity, number> = {
  'Rare': 56,
  'Big Rare': 10,
  'Epic': 3,
  'Legendary': 1,
};

// Poids du Legendary dans le scoring (signal de frontière de cycle)
const LEGENDARY_SCORE_WEIGHT = 20;

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
  cycleStart: number; // absolute index in full records array
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
  windowStart: number; // index where the sliding window begins
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

  // ─── Sliding window: scan only the last SCAN_WINDOW records ───
  let windowRecords: Rarity[];
  let windowOffset: number;

  if (records.length > SCAN_WINDOW) {
    windowRecords = records.slice(-SCAN_WINDOW);
    windowOffset = records.length - SCAN_WINDOW;
  } else {
    windowRecords = records;
    windowOffset = 0;
  }

  // ─── Fuzzy scoring: try each possible start within the window ─

  let bestScore = -Infinity;
  let bestStart = 0; // relative to windowRecords
  const perfectStarts: number[] = [];

  const maxStart = windowRecords.length - CYCLE_SIZE;

  for (let i = 0; i <= maxStart; i++) {
    const remaining = windowRecords.length - i;
    const numCycles = Math.floor(remaining / CYCLE_SIZE);
    let perfectCount = 0;
    let weightedDistance = 0;
    let allPerfect = true;

    for (let j = 0; j < numCycles; j++) {
      const segStart = i + j * CYCLE_SIZE;
      const segment = windowRecords.slice(segStart, segStart + CYCLE_SIZE);
      const dist = cycleDistance(segment);
      const counts = countRarities(segment);
      // Pénalité lourde si le nombre de Legendary est incorrect
      // (0 ou 2+ dans un cycle = frontière presque certainement fausse)
      const legendDiff = Math.abs(counts['Legendary'] - EXPECTED['Legendary']);
      const legendPenalty = legendDiff * LEGENDARY_SCORE_WEIGHT;
      // Weight later cycles more (more recent = more reliable)
      weightedDistance += dist * (1 + j * 0.15) + legendPenalty * (1 + j * 0.15);
      if (dist === 0 && legendDiff === 0) {
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

  let chosenStart: number; // relative to windowRecords
  let isPerfect: boolean;

  if (perfectStarts.length > 0) {
    chosenStart = perfectStarts[perfectStarts.length - 1];
    isPerfect = true;
    if (perfectStarts.length === 1) {
      defaultResult.message = 'Correspondance de cycle parfaite trouvée ! 🎯';
    } else {
      defaultResult.message = `${perfectStarts.length} positions de départ possibles. La plus récente est affichée.`;
    }
  } else {
    chosenStart = bestStart;
    isPerfect = false;
    const rem = windowRecords.length - chosenStart;
    const nc = Math.floor(rem / CYCLE_SIZE);
    let totalDist = 0;
    for (let j = 0; j < nc; j++) {
      totalDist += cycleDistance(windowRecords.slice(chosenStart + j * CYCLE_SIZE, chosenStart + j * CYCLE_SIZE + CYCLE_SIZE));
    }
    defaultResult.message = `Aucun cycle parfait trouvé (écart total: ${totalDist}). Meilleure estimation affichée — erreurs de saisie probables.`;
  }

  // ─── Extract cycles from the chosen start (within window) ─

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

  // Convert to absolute positions in the full records array
  const absoluteCycleStart = chosenStart + windowOffset;

  // Un cycle complet sans Legendary est TOUJOURS invalide
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
