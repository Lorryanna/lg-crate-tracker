'use client';

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Star,
  Sparkles,
  Trash2,
  RotateCcw,
  Upload,
  Download,
  HelpCircle,
  ChevronRight,
  Info,
  ShieldCheck,
  Swords,
  Trophy,
  History,
  Grid3X3,
  List,
  Save,
  AlertTriangle,
  ArrowUpCircle,
} from 'lucide-react';
import type { Rarity } from '@/lib/crate-scanner';
import {
  RARITY_SHORT,
  CYCLE_SIZE,
  MIN_RECORDS,
  EXPECTED,
  scanCycles,
  scanPostReset,
  getCycleStats,
  parseImportText,
  exportEntriesText,
  extractCycleRecords,
  countEnhanced,
  countResets,
  migrateOldFormat,
  isCrateEntry,
  isEnhancedEntry,
  isResetEntry,
  type RecordEntry,
  type CrateEntry,
  type CycleStats as CycleStatsType,
  type ScanResult,
  type CycleErrorInfo,
  type RarityDeviation,
} from '@/lib/crate-scanner';

// ─── localStorage helpers ─────────────────────────────────

const STORAGE_KEY = 'lg-crate-tracker-records';

function loadEntries(): RecordEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    // Migration from old format
    const migrated = migrateOldFormat(parsed);
    if (migrated) {
      saveEntries(migrated);
      return migrated;
    }
    return parsed as RecordEntry[];
  } catch {
    return [];
  }
}

function saveEntries(entries: RecordEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ─── Rarity config ────────────────────────────────────────

const RARITY_CONFIG: {
  rarity: Rarity;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  color: string;
  textColor: string;
  enhancedColor: string;
  expected: number;
}[] = [
  {
    rarity: 'Rare',
    label: 'Rare',
    shortLabel: 'R',
    icon: <ShieldCheck className="h-4 w-4" />,
    color: 'bg-sky-100 border-sky-300 hover:bg-sky-200',
    textColor: 'text-sky-800',
    enhancedColor: 'bg-sky-50 border-pink-300 hover:bg-pink-50 opacity-80',
    expected: 56,
  },
  {
    rarity: 'Big Rare',
    label: 'Big Rare',
    shortLabel: 'B',
    icon: <Star className="h-4 w-4" />,
    color: 'bg-cyan-100 border-cyan-300 hover:bg-cyan-200',
    textColor: 'text-cyan-900',
    enhancedColor: 'bg-cyan-50 border-pink-300 hover:bg-pink-50 opacity-80',
    expected: 10,
  },
  {
    rarity: 'Epic',
    label: 'Epic',
    shortLabel: 'E',
    icon: <Sparkles className="h-4 w-4" />,
    color: 'bg-purple-100 border-purple-300 hover:bg-purple-200',
    textColor: 'text-purple-800',
    enhancedColor: 'bg-purple-50 border-pink-300 hover:bg-pink-50 opacity-80',
    expected: 3,
  },
  {
    rarity: 'Legendary',
    label: 'Legendary',
    shortLabel: 'L',
    icon: <Trophy className="h-4 w-4" />,
    color: 'bg-amber-100 border-amber-400 hover:bg-amber-200',
    textColor: 'text-amber-900',
    enhancedColor: 'bg-amber-50 border-pink-300 hover:bg-pink-50 opacity-80',
    expected: 1,
  },
];

// ─── Component ───────────────────────────────────────────

const EMPTY_ENTRIES: RecordEntry[] = [];
let cachedRaw = '';
let cachedParsed: RecordEntry[] = EMPTY_ENTRIES;
const listeners = new Set<() => void>();

function getEntriesSnapshot(): RecordEntry[] {
  if (typeof window === 'undefined') return EMPTY_ENTRIES;
  const raw = localStorage.getItem(STORAGE_KEY) ?? '[]';
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        cachedParsed = EMPTY_ENTRIES;
      } else {
        const migrated = migrateOldFormat(parsed);
        if (migrated) {
          cachedParsed = migrated;
          saveEntries(migrated);
          cachedRaw = JSON.stringify(migrated);
        } else {
          cachedParsed = parsed as RecordEntry[];
        }
      }
    } catch {
      cachedParsed = EMPTY_ENTRIES;
    }
  }
  return cachedParsed;
}

function subscribeToStorage(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function notifyListeners() {
  listeners.forEach((cb) => cb());
}

const APP_VERSION = 'v4.0.6';

export default function CrateTracker() {
  const entries = useSyncExternalStore(
    subscribeToStorage,
    getEntriesSnapshot,
    () => EMPTY_ENTRIES,
  );

  const [importText, setImportText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [enhancedMode, setEnhancedMode] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyContainerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(entries.length);

  // ─── Derived data ──────────────────────────────────────

  // Counters
  const cycleRecordCount = entries.filter(isCrateEntry).length;
  const enhancedCount = countEnhanced(entries);
  const resetCount = countResets(entries);

  // Extract cycle-only records for scanning
  const cycleRecords = useMemo(() => extractCycleRecords(entries), [entries]);

  // ─── Computed scan & stats ─────────────────────────────

  const hasReset = useMemo(() => entries.some(isResetEntry), [entries]);

  const scanResult: ScanResult | null = useMemo(() => {
    // CRITICAL: check hasReset FIRST. When a reset exists, cycle start is
    // known (position 0) — always use scanPostReset, never scanCycles.
    if (hasReset && cycleRecords.length > 0) {
      return scanPostReset(cycleRecords);
    }
    // No reset: use classic sliding window scan (needs 210+ records)
    if (cycleRecords.length >= MIN_RECORDS) {
      return scanCycles(cycleRecords);
    }
    return null;
  }, [cycleRecords, hasReset]);

  const cycleStats: Record<Rarity, CycleStatsType> | null = useMemo(() => {
    if (!scanResult?.valid) return null;
    return getCycleStats(scanResult.incompleteCycle);
  }, [scanResult]);

  // ─── Actions ───────────────────────────────────────────

  const addRecord = useCallback((rarity: Rarity, enhanced: boolean) => {
    const current = getEntriesSnapshot();
    const entry: RecordEntry = enhanced ? { t: 'e', r: rarity } : { t: 'c', r: rarity };
    saveEntries([...current, entry]);
    cachedRaw = '';
    notifyListeners();
  }, []);

  const addReset = useCallback(() => {
    const current = getEntriesSnapshot();
    saveEntries([...current, { t: 'r' }]);
    cachedRaw = '';
    notifyListeners();
    toast.success('⬆ Rank up enregistré (annuler avec Suppr)');
  }, []);

  const deleteLast = useCallback(() => {
    const current = getEntriesSnapshot();
    if (current.length === 0) {
      toast.error('Aucun enregistrement à annuler');
      return;
    }
    saveEntries(current.slice(0, -1));
    cachedRaw = '';
    notifyListeners();
  }, []);

  const clearAll = useCallback(() => {
    saveEntries([]);
    cachedRaw = '';
    notifyListeners();
    setClearOpen(false);
    toast.success('Tous les enregistrements effacés');
  }, []);

  const handleImport = useCallback(() => {
    const parsed = parseImportText(importText);
    if (parsed.length === 0) {
      toast.error('Aucun enregistrement valide trouvé');
      return;
    }
    const current = getEntriesSnapshot();
    saveEntries([...current, ...parsed]);
    cachedRaw = '';
    notifyListeners();
    const crates = parsed.filter(isCrateEntry).length;
    const enhanced = parsed.filter(isEnhancedEntry).length;
    const resets = parsed.filter(isResetEntry).length;
    const parts: string[] = [];
    if (crates > 0) parts.push(`${crates} crates`);
    if (enhanced > 0) parts.push(`${enhanced} enhanced`);
    if (resets > 0) parts.push(`${resets} reset`);
    toast.success(`${parts.join(', ')} importés`);
    setImportOpen(false);
    setImportText('');
  }, [importText]);

  const handleFileImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseImportText(text);
      if (parsed.length === 0) {
        toast.error('Aucun enregistrement valide dans le fichier');
        return;
      }
      const current = getEntriesSnapshot();
      saveEntries([...current, ...parsed]);
      cachedRaw = '';
      notifyListeners();
      toast.success(`${parsed.length} entrées importées depuis ${file.name}`);
      setImportOpen(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const exportText = useMemo(() => exportEntriesText(entries), [entries]);
  const exportJson = useMemo(() => JSON.stringify(entries), [entries]);

  const exportClipboard = useCallback(() => {
    navigator.clipboard.writeText(exportText).then(() => {
      toast.success('Copié dans le presse-papier !');
      setExportOpen(false);
    }).catch(() => {
      toast.error('Impossible de copier');
    });
  }, [exportText]);

  const exportFile = useCallback(() => {
    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lg-crates-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Fichier téléchargé !');
    setExportOpen(false);
  }, [exportText]);

  const exportJsonClipboard = useCallback(() => {
    navigator.clipboard.writeText(exportJson).then(() => {
      toast.success('JSON copié !');
      setExportOpen(false);
    }).catch(() => {
      toast.error('Impossible de copier');
    });
  }, [exportJson]);

  const exportJsonFile = useCallback(() => {
    const blob = new Blob([exportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lg-crates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Fichier JSON téléchargé !');
    setExportOpen(false);
  }, [exportJson]);

  // ─── Keyboard shortcuts ───────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); addRecord('Rare', enhancedMode); }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); addRecord('Big Rare', enhancedMode); }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); addRecord('Epic', enhancedMode); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); addRecord('Legendary', enhancedMode); }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteLast(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addRecord, deleteLast, enhancedMode]);

  // ─── Auto-scroll ─────────────────────────────────────

  useEffect(() => {
    const el = historyContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  // ─── Flash highlight ──────────────────────────────────

  useEffect(() => {
    const prev = prevLengthRef.current;
    const curr = entries.length;
    prevLengthRef.current = curr;
    if (curr > prev && curr - prev === 1) {
      setHighlightedIndex(curr - 1);
      const timer = setTimeout(() => setHighlightedIndex(null), 5000);
      return () => clearTimeout(timer);
    }
    if (curr < prev) setHighlightedIndex(null);
  }, [entries.length]);

  // ─── Cycle start indices ──────────────────────────────

  const cycleStartIndices = useMemo(() => {
    if (!scanResult || scanResult.cycleStart < 0) return new Set<number>();
    const indices = new Set<number>();
    // cycleStart is relative to cycleRecords (post-reset).
    // We need to map back to absolute entry indices.
    // Find the offset of the first cycle crate after the last reset.
    let lastResetEntryIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (isResetEntry(entries[i])) { lastResetEntryIdx = i; break; }
    }
    let cycleIdx = 0;
    for (let i = lastResetEntryIdx + 1; i < entries.length; i++) {
      if (isCrateEntry(entries[i])) {
        if (cycleIdx === scanResult.cycleStart) {
          indices.add(i);
        }
        cycleIdx++;
      }
    }
    for (let c = 1; c <= scanResult.totalCycles; c++) {
      const targetCycleRecord = scanResult.cycleStart + c * CYCLE_SIZE;
      cycleIdx = 0;
      for (let i = lastResetEntryIdx + 1; i < entries.length; i++) {
        if (isCrateEntry(entries[i])) {
          if (cycleIdx === targetCycleRecord) {
            indices.add(i);
          }
          cycleIdx++;
        }
      }
    }
    return indices;
  }, [scanResult, entries]);

  // ─── Derived values ────────────────────────────────────

  const progressPercent = cycleStats
    ? Math.round(
        ((cycleStats['Rare'].dropped + cycleStats['Big Rare'].dropped +
          cycleStats['Epic'].dropped + cycleStats['Legendary'].dropped) / CYCLE_SIZE) * 100
      )
    : 0;

  const legendDropped = cycleStats ? cycleStats['Legendary'].dropped : 0;
  const legendRemaining = cycleStats ? Math.max(0, cycleStats['Legendary'].remaining) : 1;
  const actualRemaining = cycleStats
    ? (Object.keys(cycleStats) as Rarity[]).reduce(
        (sum, r) => sum + Math.max(0, cycleStats[r].remaining), 0
      )
    : 0;

  // ─── Render ──────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen flex flex-col bg-gradient-to-br from-stone-50 to-stone-100 overflow-hidden">

        {/* ─── Header ──────────────────────────────────── */}
        <header className="border-b bg-white/80 backdrop-blur-sm shrink-0">
          <div className="max-w-[1600px] mx-auto px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-amber-500" />
              <h1 className="text-sm font-bold tracking-tight">LG Crate Tracker</h1>
            </div>
            <div className="flex items-center gap-1">
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <Upload className="h-3 w-3" /><span className="hidden sm:inline">Importer</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Importer des données</DialogTitle>
                    <DialogDescription>Colle tes données ou charge un fichier.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder={"R, R, B, E, L, ...\n*R pour enhanced\n[RESET] pour rank up"}
                      rows={4}
                      className="text-xs font-mono max-h-24 overflow-y-auto resize-none"
                    />
                    <Button onClick={handleImport} disabled={!importText.trim()} className="w-full gap-2">
                      <Upload className="h-4 w-4" /> Importer
                    </Button>
                    <Separator />
                    <div className="text-center text-xs text-muted-foreground">ou</div>
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full gap-2">
                      <Upload className="h-4 w-4" /> Charger un fichier
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.csv"
                      onChange={handleFileImport}
                      className="hidden"
                    />
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={exportOpen} onOpenChange={setExportOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <Download className="h-3 w-3" /><span className="hidden sm:inline">Exporter</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Exporter l&apos;historique</DialogTitle>
                    <DialogDescription>{entries.length} entrée{entries.length > 1 ? 's' : ''} ({cycleRecordCount} crates, {enhancedCount} enhanced, {resetCount} reset)</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium mb-1">Aperçu (texte compact)</p>
                      <Textarea
                        readOnly
                        value={exportText}
                        rows={3}
                        className="text-[11px] font-mono bg-muted/50 resize-none max-h-24 overflow-y-auto"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button onClick={exportClipboard} className="justify-start gap-2" variant="outline" size="sm">
                        <Save className="h-3.5 w-3.5" /> Clipboard .txt
                      </Button>
                      <Button onClick={exportFile} className="justify-start gap-2" variant="outline" size="sm">
                        <Download className="h-3.5 w-3.5" /> Fichier .txt
                      </Button>
                      <Button onClick={exportJsonClipboard} className="justify-start gap-2" variant="outline" size="sm">
                        <Save className="h-3.5 w-3.5" /> Clipboard .json
                      </Button>
                      <Button onClick={exportJsonFile} className="justify-start gap-2" variant="outline" size="sm">
                        <Download className="h-3.5 w-3.5" /> Fichier .json
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <HelpCircle className="h-3 w-3" /><span className="hidden sm:inline">Aide</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Comment utiliser le Crate Tracker</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      <p>Après chaque combat gagné, cliquez sur le bouton correspondant (ou touches <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">R</kbd> <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">B</kbd> <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">E</kbd> <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">L</kbd>).</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-pink-500" />
                      <p><strong>✨ Hors cycle :</strong> Active le mode enhanced avant de cliquer sur une rareté. Les crates enhanced (suite à un rank up) ne sont pas comptées dans le cycle de 70.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
                      <p><strong>⬆ Rank up :</strong> Quand vous changez de league, le cycle de 70 redémarre. Cliquez sur ce bouton pour réinitialiser le compteur.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      <p>Après au moins <strong>210 crates en cycle</strong> (3 cycles), le scan s&apos;active automatiquement.</p>
                    </div>
                    <Separator />
                    <div className="flex items-center gap-2">
                      <Save className="h-4 w-4 shrink-0 text-emerald-500" />
                      <p><strong>Tout est sauvegardé localement</strong> (localStorage). Aucun serveur requis.</p>
                    </div>
                    <Separator />
                    <div className="text-xs space-y-1">
                      <p className="font-medium text-foreground">Raccourcis clavier :</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">R</kbd><span>Rare</span></div>
                        <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">B</kbd><span>Big Rare</span></div>
                        <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">E</kbd><span>Epic</span></div>
                        <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">L</kbd><span>Legendary</span></div>
                        <div className="flex items-center gap-2 col-span-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Suppr</kbd><span>Annuler dernier</span></div>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </header>

        {/* ─── Main Content ────────────────────────────── */}
        <main className="flex-1 min-h-0 overflow-hidden max-w-[1600px] mx-auto w-full px-4 py-2">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 h-full">

            {/* ═══ LEFT: History ════ */}
            <div className="lg:col-span-5 flex flex-col min-h-0">
              <Card className="flex-1 flex flex-col min-h-0 overflow-hidden py-0 gap-0">
                <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 shrink-0 border-b">
                  <div className="flex items-center gap-1.5">
                    <List className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Historique</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {enhancedCount > 0 && (
                      <Badge variant="outline" className="text-[9px] text-pink-600 border-pink-300">
                        ✨ {enhancedCount}
                      </Badge>
                    )}
                    {resetCount > 0 && (
                      <Badge variant="outline" className="text-[9px] text-orange-600 border-orange-300">
                        ⬆ {resetCount}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] font-mono">
                      #{cycleRecordCount}
                    </Badge>
                  </div>
                </div>
                <div
                  ref={historyContainerRef}
                  className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
                >
                  {entries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <Swords className="h-10 w-10 mb-2 opacity-30" />
                      <p className="text-sm">Aucun enregistrement</p>
                      <p className="text-xs">Utilise les boutons ou les touches R/B/E/L</p>
                    </div>
                  ) : (
                    <div className="space-y-0">
                      {entries.map((entry, i) => {
                        const isHighlighted = i === highlightedIndex;

                        // Reset separator
                        if (isResetEntry(entry)) {
                          return (
                            <div
                              key={i}
                              className={`flex items-center gap-1.5 px-1 py-1 my-1 rounded ${isHighlighted ? 'crate-flash' : ''}`}
                            >
                              <ArrowUpCircle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                              <span className="text-[11px] font-semibold text-orange-700">⬆ Rank up — Cycle réinitialisé</span>
                              <span className="text-[10px] text-muted-foreground font-mono ml-auto">#{i + 1}</span>
                            </div>
                          );
                        }

                        // Enhanced crate
                        if (isEnhancedEntry(entry)) {
                          const config = RARITY_CONFIG.find((c) => c.rarity === entry.r)!;
                          return (
                            <div
                              key={i}
                              className={`flex items-center gap-1 px-1 py-px rounded text-[11px] ${isHighlighted ? 'crate-flash' : ''}`}
                            >
                              <span className="text-muted-foreground font-mono w-5 text-right shrink-0">
                                <span className="text-pink-400">✨</span>{i + 1}
                              </span>
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0 ring-2 ring-pink-300"
                                style={{
                                  backgroundColor:
                                    entry.r === 'Rare' ? '#38bdf8'
                                    : entry.r === 'Big Rare' ? '#06b6d4'
                                    : entry.r === 'Epic' ? '#a855f7'
                                    : '#f59e0b',
                                }}
                              />
                              <span className={`${config.textColor} font-medium truncate opacity-70`}>{config.label}</span>
                              <span className="text-[9px] text-pink-500 ml-auto shrink-0">hors cycle</span>
                            </div>
                          );
                        }

                        // Normal crate
                        if (isCrateEntry(entry)) {
                          const config = RARITY_CONFIG.find((c) => c.rarity === entry.r)!;
                          const isCycleStart = cycleStartIndices.has(i);
                          return (
                            <div
                              key={i}
                              className={`flex items-center gap-1 px-1 py-px rounded text-[11px] ${config.color}${isHighlighted ? ' crate-flash' : ''}`}
                            >
                              <span className="text-muted-foreground font-mono w-5 text-right shrink-0">
                                {i + 1}
                              </span>
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    entry.r === 'Rare' ? '#38bdf8'
                                    : entry.r === 'Big Rare' ? '#06b6d4'
                                    : entry.r === 'Epic' ? '#a855f7'
                                    : '#f59e0b',
                                }}
                              />
                              <span className={`${config.textColor} font-medium truncate`}>{config.label}</span>
                              {isCycleStart && (
                                <span className="text-[8px] border border-amber-400 text-amber-600 rounded px-0.5 ml-auto">
                                  C↓
                                </span>
                              )}
                            </div>
                          );
                        }

                        return null;
                      })}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* ═══ RIGHT: Controls + Analysis ════ */}
            <div className="lg:col-span-7 flex flex-col gap-2.5 min-h-0 overflow-y-auto">

              {/* ── 1. Buttons ────────────────────────── */}
              <Card className="shrink-0 py-0 gap-0">
                <CardContent className="px-3 py-2.5">
                  <div className="grid grid-cols-4 gap-1.5">
                    {RARITY_CONFIG.map((c) => (
                      <Tooltip key={c.rarity}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            className={`h-9 gap-1.5 border-2 text-xs font-semibold transition-all active:scale-95 ${
                              enhancedMode ? c.enhancedColor : c.color
                            }`}
                            onClick={() => addRecord(c.rarity, enhancedMode)}
                          >
                            {enhancedMode && <Sparkles className="h-3 w-3 text-pink-500" />}
                            {c.icon}
                            <span className={c.textColor}>{c.label}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {enhancedMode ? '✨ Enhanced — ' : ''}Touche <kbd className="px-1 py-0.5 bg-stone-700 text-stone-50 rounded text-xs font-mono">{c.shortLabel}</kbd>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mt-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={enhancedMode ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setEnhancedMode(!enhancedMode)}
                          className={`gap-1 h-7 text-xs transition-all ${
                            enhancedMode
                              ? 'bg-pink-500 hover:bg-pink-600 text-white border-pink-500'
                              : 'border-pink-300 text-pink-600 hover:bg-pink-50'
                          }`}
                        >
                          <Sparkles className="h-3 w-3" />
                          <span className={enhancedMode ? 'font-semibold' : ''}>
                            {enhancedMode ? '✨ Mode Enhanced ON' : '✨ Hors cycle'}
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {enhancedMode
                          ? 'Désactiver le mode enhanced — les prochaines crates seront en cycle'
                          : 'Activer le mode enhanced — les prochaines crates seront hors cycle (rank up)'
                        }
                      </TooltipContent>
                    </Tooltip>

                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={addReset}
                            className="gap-1 h-7 text-xs border-orange-300 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                          >
                            <ArrowUpCircle className="h-3 w-3" />
                            <span className="hidden xl:inline">Rank up</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>⬆ Rank up — cycle réinitialisé (Suppr pour annuler)</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={deleteLast}
                            disabled={entries.length === 0}
                            className="gap-1 text-destructive hover:text-destructive h-7 text-xs"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span className="hidden xl:inline">Annuler</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Suppr / Retour arrière</TooltipContent>
                      </Tooltip>

                      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={entries.length === 0}
                            className="gap-1 text-destructive hover:text-destructive h-7 text-xs"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span className="hidden xl:inline">Tout effacer</span>
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Effacer tout ?</DialogTitle>
                            <DialogDescription>
                              Cette action est irréversible. Tous vos enregistrements seront supprimés.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <Button variant="outline">Annuler</Button>
                            </DialogClose>
                            <Button variant="destructive" onClick={clearAll}>Effacer</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ── 2. Progress banner ──────────────────── */}
              {!scanResult && cycleRecords.length > 0 && (
                <Card className="border-amber-200 bg-amber-50 shrink-0 py-0 gap-0">
                  <CardContent className="py-1.5 px-2.5 flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-amber-800">
                        <strong>{MIN_RECORDS - cycleRecords.length} crates</strong> restants avant le scan automatique.
                      </p>
                      <div className="w-full h-1 bg-amber-200 rounded-full mt-0.5 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (cycleRecords.length / MIN_RECORDS) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── 3. Scan banner ──────────────────────── */}
              {scanResult && (
                <Card className={
                  scanResult.hasErrors
                    ? 'border-amber-200 bg-amber-50 shrink-0 py-0 gap-0'
                    : scanResult.valid
                      ? 'border-emerald-200 bg-emerald-50 shrink-0 py-0 gap-0'
                      : 'border-red-200 bg-red-50 shrink-0 py-0 gap-0'
                }>
                  <CardContent className="py-1.5 px-2.5 flex items-start gap-2">
                    {scanResult.hasErrors ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    ) : scanResult.valid ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className={`text-xs font-medium ${
                        scanResult.hasErrors ? 'text-amber-800'
                        : scanResult.valid ? 'text-emerald-800'
                        : 'text-red-800'
                      }`}>
                        {scanResult.message}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${
                        scanResult.hasErrors ? 'text-amber-600'
                        : 'text-emerald-600'
                      }`}>
                        {scanResult.totalCycles} cycle(s) complet(s) • Position : {scanResult.currentCyclePosition}/{CYCLE_SIZE}
                        {scanResult.hasErrors && ` • Écart total: ${scanResult.totalDistance}`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── 4. Cycle en cours ──────────────────── */}
              {cycleStats && scanResult?.valid && (
                <Card className="shrink-0 py-0 gap-0">
                  <CardHeader className="pb-1.5 pt-2.5 px-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                        <Grid3X3 className="h-3.5 w-3.5" />
                        Cycle en cours
                      </CardTitle>
                      <Badge variant="secondary" className="text-[10px]">
                        {progressPercent}%
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="px-3 pb-3">
                    <div className="w-full h-1 bg-muted rounded-full mb-2 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {RARITY_CONFIG.map((c) => {
                        const stat = cycleStats[c.rarity];
                        const isComplete = stat.remaining <= 0;
                        return (
                          <div key={c.rarity} className={`rounded-md border-2 p-1.5 ${
                            isComplete ? 'border-emerald-300 bg-emerald-50' : `${c.color} border`
                          }`}>
                            <div className="flex items-center gap-1">
                              {c.icon}
                              <span className={`text-[11px] font-semibold ${c.textColor}`}>{c.label}</span>
                            </div>
                            <div className="flex items-baseline gap-0.5">
                              <span className={`text-base font-bold ${c.textColor}`}>{stat.dropped}</span>
                              <span className="text-[10px] text-muted-foreground">/ {c.expected}</span>
                            </div>
                            <div className="mt-0.5 w-full h-1 bg-black/10 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  c.rarity === 'Rare' ? 'bg-sky-400'
                                  : c.rarity === 'Big Rare' ? 'bg-cyan-500'
                                  : c.rarity === 'Epic' ? 'bg-purple-500'
                                  : 'bg-amber-500'
                                }`}
                                style={{ width: `${Math.min(100, (stat.dropped / c.expected) * 100)}%` }}
                              />
                            </div>
                            <div className={`text-[10px] font-medium ${
                              isComplete ? 'text-emerald-600' : 'text-muted-foreground'
                            }`}>
                              {isComplete ? '✓ Complété' : `${stat.remaining} restant${stat.remaining > 1 ? 's' : ''}`}
                            </div>
                            {!isComplete && (
                              <div className="text-[10px] text-muted-foreground font-mono">
                                → {actualRemaining > 0
                                  ? ((Math.max(0, stat.remaining) / actualRemaining) * 100).toFixed(1)
                                  : '0'}%
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Prochain Legendary */}
                    <div className={`mt-2 flex items-center justify-between rounded-md border-2 px-3 py-2 ${
                      legendDropped > 0
                        ? 'border-emerald-300 bg-emerald-50'
                        : progressPercent > 80
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-amber-200 bg-amber-50/50'
                    }`}>
                      <div className="flex items-center gap-2">
                        <Trophy className={`h-4 w-4 shrink-0 ${legendDropped > 0 ? 'text-emerald-500' : 'text-amber-500'}`} />
                        <span className="text-xs font-medium text-foreground">Prochain Legendary</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        {legendDropped > 0 ? (
                          <span className="text-sm font-bold text-emerald-600">Obtenu ✓</span>
                        ) : (
                          <>
                            <span className={`text-lg font-bold font-mono ${
                              progressPercent > 80 ? 'text-amber-600' : 'text-amber-500'
                            }`}>
                              {legendRemaining > 0 && actualRemaining > 0
                                ? ((legendRemaining / actualRemaining) * 100).toFixed(1)
                                : '0'}
                            </span>
                            <span className="text-xs text-muted-foreground">%
                              <span className="font-mono text-[10px]">({legendRemaining}/{actualRemaining})</span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Anomalie — sur-comptes uniquement */}
                    {(() => {
                      if (!scanResult.incompleteCycleErrors) return null;
                      const overCounted = (Object.entries(scanResult.incompleteCycleErrors.details) as [Rarity, RarityDeviation][])
                        .filter(([, d]) => d.diff > 0);
                      if (overCounted.length === 0) return null;
                      return (
                        <div className="mt-2 p-1.5 rounded-md bg-red-50 border border-red-200 flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-[11px] text-red-800 font-medium">Anomalie dans le cycle en cours</p>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                              {overCounted.map(([rarity, d]) => (
                                <span key={rarity} className="text-[10px] text-red-700">
                                  {rarity}: {d.actual}/{d.expected} (+{d.diff})
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              {/* ── 5. Summary + Visualization ──────────── */}
              <div className="flex gap-2 shrink-0">
                <Card className="shrink-0 py-0 gap-0">
                  <CardContent className="py-2 px-3">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-center">
                      <div>
                        <div className="text-sm font-bold font-mono">{cycleRecordCount}</div>
                        <div className="text-[10px] text-muted-foreground">Cycle</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold font-mono text-amber-600">{cycleRecords.filter((r) => r === 'Legendary').length}</div>
                        <div className="text-[10px] text-muted-foreground">Légendaires</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold font-mono">{scanResult?.totalCycles ?? 0}</div>
                        <div className="text-[10px] text-muted-foreground">Cycles</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold font-mono">{scanResult?.currentCyclePosition ?? '-'}</div>
                        <div className="text-[10px] text-muted-foreground">Position</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {scanResult?.valid && (
                  <Card className="flex-1 flex flex-col min-w-0 py-0 gap-0">
                    <CardHeader className="pb-1.5 pt-2 px-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                          <History className="h-3.5 w-3.5" />
                          Visualisation du cycle
                        </CardTitle>
                        {scanResult.cycleHistory.length > 1 && (
                          <Button variant="ghost" size="sm"
                            onClick={() => setShowHistory(!showHistory)}
                            className="h-6 gap-1 text-[10px] px-1.5"
                          >
                            <History className="h-3 w-3" />
                            {showHistory ? 'Actuel' : `${scanResult.cycleHistory.length} cycles`}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="px-3 pb-2.5 flex-1 min-h-0 overflow-y-auto">
                      {!showHistory ? (
                        <CycleGrid
                          cycle={scanResult.incompleteCycle.length > 0 ? scanResult.incompleteCycle : scanResult.currentCycle}
                          cycleSize={CYCLE_SIZE}
                        />
                      ) : (
                        <div className="space-y-4">
                          {scanResult.cycleHistory.map((cycle, i) => {
                            const errInfo = scanResult.cycleErrors[i];
                            return (
                              <div key={i}>
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-[11px] font-medium text-muted-foreground">Cycle {i + 1}</span>
                                  {errInfo ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300 cursor-help">
                                          ⚠ Écart: {errInfo.distance}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom" className="text-[10px] max-w-xs">
                                        <div className="space-y-0.5">
                                          {(Object.entries(errInfo.details) as [Rarity, RarityDeviation][])
                                            .filter(([, d]) => d.diff !== 0)
                                            .map(([r, d]) => (
                                              <div key={r}>{r}: {d.actual}/{d.expected} ({d.diff > 0 ? '+' : ''}{d.diff})</div>
                                            ))}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  ) : (
                                    <Badge variant="outline" className="text-[9px] text-emerald-600 border-emerald-300">✓ Valide</Badge>
                                  )}
                                </div>
                                <CycleGrid cycle={cycle} cycleSize={CYCLE_SIZE} />
                              </div>
                            );
                          })}
                          {scanResult.incompleteCycle.length > 0 && (
                            <div>
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  En cours ({scanResult.incompleteCycle.length}/{CYCLE_SIZE})
                                </span>
                                <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300">En cours</Badge>
                              </div>
                              <CycleGrid cycle={scanResult.incompleteCycle} cycleSize={CYCLE_SIZE} />
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

            </div>
          </div>
        </main>

        {/* ─── Footer ──────────────────────────────────── */}
        <footer className="border-t bg-white/80 backdrop-blur-sm shrink-0">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 text-center text-[10px] text-muted-foreground">
            LG Crate Tracker {APP_VERSION} — Basé sur les recherches de Daa, OxKing, pho et la communauté.
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

// ─── Cycle Grid Sub-component ─────────────────────────────

function CycleGrid({ cycle, cycleSize }: { cycle: Rarity[]; cycleSize: number }) {
  const colorMap: Record<Rarity, { bg: string; label: string }> = {
    'Rare': { bg: 'bg-sky-200', label: 'R' },
    'Big Rare': { bg: 'bg-cyan-400', label: 'B' },
    'Epic': { bg: 'bg-purple-400', label: 'E' },
    'Legendary': { bg: 'bg-amber-400', label: 'L' },
  };

  return (
    <div className="flex flex-wrap gap-0.5">
      {Array.from({ length: cycleSize }, (_, i) => {
        const crate = cycle[i];
        const isEmpty = !crate;
        const isLegend = crate === 'Legendary';
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                className={
                  `w-4 h-4 sm:w-5 sm:h-5 rounded-sm flex items-center justify-center ` +
                  `text-[7px] sm:text-[8px] font-bold transition-all ` +
                  (isEmpty
                    ? 'bg-stone-100 border border-stone-200'
                    : `${colorMap[crate].bg} ${isLegend ? 'ring-2 ring-amber-300' : ''}`)
                }
              >
                {crate ? colorMap[crate].label : ''}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              #{i + 1} {crate || 'vide'}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
