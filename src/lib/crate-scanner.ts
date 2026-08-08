/**
 * Lust Goddess Crate Cycle Scanner
 * 
 * The game uses a shuffled pool of 70 crates per cycle:
 * - 56 Rare
 * - 10 Big Rare
 * - 3 Epic
 * - 1 Legendary
 * 
 * This algorithm finds the most likely cycle start position
 * by checking all possible alignments against the expected distribution.
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

export interface ScanResult {
  valid: boolean;
  cycleStart: number; // 0-based index in the record where the cycle starts
  currentCyclePosition: number; // 0-69 position within the current (incomplete) cycle
  currentCycle: Rarity[]; // The 70 items of the most recent COMPLETE cycle
  cycleHistory: Rarity[][]; // All complete cycles found
  cycleValidities: boolean[]; // Whether each cycle is valid
  totalCycles: number;
  incompleteCycle: Rarity[]; // Items after the last complete cycle (current in-progress cycle)
  message: string;
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
  };

  if (records.length < CYCLE_SIZE * 3) {
    const needed = CYCLE_SIZE * 3 - records.length;
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
  let chosenStart: number;
  let isPerfect = false;

  if (validStarts.length === 0) {
    chosenStart = bestStart;
    defaultResult.message = 'Aucune correspondance parfaite trouvée. Il peut y avoir des erreurs dans l\'historique. Meilleure estimation affichée.';
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

  for (let j = 0; j < numCycles; j++) {
    const segStart = chosenStart + j * CYCLE_SIZE;
    const segment = records.slice(segStart, segStart + CYCLE_SIZE);
    cycles.push(segment);
    cycleValidities.push(isValidCycle(segment));
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
  defaultResult.totalCycles = numCycles;
  defaultResult.incompleteCycle = incomplete;

  if (!defaultResult.message) {
    defaultResult.message = `${numCycles} cycle(s) trouvé(s) à partir de l\'enregistrement #${chosenStart + 1}.`;
  }

  return defaultResult;
}

export function getCycleStats(
  incompleteCycle: Rarity[],
  lastCompleteCycle?: Rarity[]
): Record<Rarity, CycleStats> {
  // If we have an incomplete cycle (current in-progress), use that for stats
  // If we're at the start of a new cycle with no incomplete items, show 0/expected
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
  // Parse various formats: R,B,E,L / Rare, Big Rare, etc.
  // Support: comma-separated, space-separated, newline-separated, or just a string of letters
  const cleaned = text.trim();
  if (!cleaned) return [];

  // Split by common delimiters
  let tokens = cleaned.split(/[,;\t\n\r|\s]+/).filter(Boolean);

  // If it's a single long string like "RRRBREEERRLLBBBR", split into individual chars
  if (tokens.length === 1 && tokens[0].length > 1 && /^[rRbBeElL]+$/.test(tokens[0])) {
    tokens = tokens[0].split('');
  }

  const rarities: Rarity[] = [];
  for (const token of tokens) {
 const trimmed = token.trim();
    if (!trimmed) continue;
    // Try single letter first
    const upper = trimmed.toUpperCase();
    if (['R', 'B', 'E', 'L'].includes(upper)) {
      rarities.push(SHORT_TO_RARITY[upper]);
    } else {
      // Try full name
      const lower = trimmed.toLowerCase();
      const mapped = SHORT_TO_RARITY[lower];
      if (mapped) {
        rarities.push(mapped);
      }
      // else skip unknown tokens
    }
  }
  return rarities;
}
