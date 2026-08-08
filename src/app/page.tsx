'use client';

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  Plus,
  Trash2,
  RotateCcw,
  Upload,
  Download,
  HelpCircle,
  Star,
  ChevronRight,
  Info,
  ShieldCheck,
  Swords,
  Sparkles,
  Trophy,
  History,
  Grid3X3,
  List,
  WifiOff,
  Save,
} from 'lucide-react';
import type { Rarity } from '@/lib/crate-scanner';
import {
  RARITY_SHORT,
  CYCLE_SIZE,
  scanCycles,
  getCycleStats,
  parseImportText,
  type CycleStats as CycleStatsType,
  type ScanResult,
} from '@/lib/crate-scanner';

// ─── localStorage helpers ─────────────────────────────────

const STORAGE_KEY = 'lg-crate-tracker-records';

function loadRecords(): Rarity[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r: string) =>
      ['Rare', 'Big Rare', 'Epic', 'Legendary'].includes(r)
    ) as Rarity[];
  } catch {
    return [];
  }
}

function saveRecords(records: Rarity[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// ─── Rarity Button Config ────────────────────────────────

const RARITY_CONFIG: {
  rarity: Rarity;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  color: string;
  textColor: string;
  expected: number;
}[] = [
  {
    rarity: 'Rare',
    label: 'Rare',
    shortLabel: 'R',
    icon: <ShieldCheck className="h-4 w-4" />,
    color: 'bg-sky-100 border-sky-300 hover:bg-sky-200',
    textColor: 'text-sky-800',
    expected: 56,
  },
  {
    rarity: 'Big Rare',
    label: 'Big Rare',
    shortLabel: 'B',
    icon: <Star className="h-4 w-4" />,
    color: 'bg-cyan-100 border-cyan-300 hover:bg-cyan-200',
    textColor: 'text-cyan-900',
    expected: 10,
  },
  {
    rarity: 'Epic',
    label: 'Epic',
    shortLabel: 'E',
    icon: <Sparkles className="h-4 w-4" />,
    color: 'bg-purple-100 border-purple-300 hover:bg-purple-200',
    textColor: 'text-purple-800',
    expected: 3,
  },
  {
    rarity: 'Legendary',
    label: 'Legendary',
    shortLabel: 'L',
    icon: <Trophy className="h-4 w-4" />,
    color: 'bg-amber-100 border-amber-400 hover:bg-amber-200',
    textColor: 'text-amber-900',
    expected: 1,
  },
];

// ─── Component ───────────────────────────────────────────

// Cached empty array for SSR (must be stable reference to avoid infinite loop)
const EMPTY_RECORDS: Rarity[] = [];
let cachedRaw = '';
let cachedParsed: Rarity[] = EMPTY_RECORDS;
const listeners = new Set<() => void>();

function getRecordsSnapshot(): Rarity[] {
  if (typeof window === 'undefined') return EMPTY_RECORDS;
  const raw = localStorage.getItem(STORAGE_KEY) ?? '[]';
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed = JSON.parse(raw);
      const filtered = Array.isArray(parsed)
        ? parsed.filter((r: string) => ['Rare', 'Big Rare', 'Epic', 'Legendary'].includes(r)) as Rarity[]
        : null;
      cachedParsed = (filtered && filtered.length > 0) ? filtered : EMPTY_RECORDS;
    } catch {
      cachedParsed = EMPTY_RECORDS;
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

export default function CrateTracker() {
  const records = useSyncExternalStore(
    subscribeToStorage,
    getRecordsSnapshot,
    () => EMPTY_RECORDS,
  );

  const [importText, setImportText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const recordEndRef = useRef<HTMLDivElement>(null);

  // ─── Auto-scroll to bottom when new records added ─────

  useEffect(() => {
    recordEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [records.length]);

  // ─── Computed scan & stats ─────────────────────────────

  const scanResult: ScanResult | null = useMemo(() => {
    if (records.length < CYCLE_SIZE * 3) return null;
    return scanCycles(records);
  }, [records]);

  const cycleStats: Record<Rarity, CycleStatsType> | null = useMemo(() => {
    if (!scanResult?.valid) return null;
    return getCycleStats(scanResult.incompleteCycle);
  }, [scanResult]);

  // ─── Actions (pure client-side, no API) ────────────────

  const addRecord = useCallback((rarity: Rarity) => {
    const current = getRecordsSnapshot();
    saveRecords([...current, rarity]);
    cachedRaw = ''; // invalidate cache so next getSnapshot re-reads
    notifyListeners();
  }, []);

  const deleteLast = useCallback(() => {
    const current = getRecordsSnapshot();
    if (current.length === 0) {
      toast.error('Aucun enregistrement à supprimer');
      return;
    }
    const removed = current[current.length - 1];
    saveRecords(current.slice(0, -1));
    cachedRaw = '';
    notifyListeners();
    toast.success(`Supprimé: ${removed}`);
  }, []);

  const clearAll = useCallback(() => {
    saveRecords([]);
    cachedRaw = '';
    notifyListeners();
    toast.success('Historique effacé');
  }, []);

  const importRecords = useCallback(() => {
    if (!importText.trim()) return;
    const parsed = parseImportText(importText);
    if (parsed.length === 0) {
      toast.error('Aucune rarité reconnue. Utilisez R, B, E, L ou les noms complets.');
      return;
    }
    saveRecords(parsed);
    cachedRaw = '';
    notifyListeners();
    setImportText('');
    toast.success(`${parsed.length} enregistrements importés`);
  }, [importText]);

  const exportRecords = useCallback(() => {
    const text = records.map((r) => RARITY_SHORT[r]).join(', ');
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copié dans le presse-papier !');
    }).catch(() => {
      toast.error('Impossible de copier');
    });
  }, [records]);

  // ─── Keyboard shortcuts ───────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); addRecord('Rare'); }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); addRecord('Big Rare'); }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); addRecord('Epic'); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); addRecord('Legendary'); }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteLast(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addRecord, deleteLast]);

  // ─── Derived values ────────────────────────────────────

  const progressPercent = cycleStats
    ? Math.round(
        ((cycleStats['Rare'].dropped + cycleStats['Big Rare'].dropped +
          cycleStats['Epic'].dropped + cycleStats['Legendary'].dropped) / CYCLE_SIZE) * 100
      )
    : 0;

  const legendDropped = cycleStats ? cycleStats['Legendary'].dropped : 0;
  const legendRemaining = cycleStats ? cycleStats['Legendary'].remaining : 1;

  // ─── Render ──────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen flex flex-col bg-gradient-to-br from-stone-50 to-stone-100">

        {/* ─── Header ──────────────────────────────────── */}
        <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-amber-500" />
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                LG Crate Tracker
              </h1>
              <Badge variant="secondary" className="text-xs font-normal hidden sm:inline-flex gap-1">
                <WifiOff className="h-3 w-3" />
                Hors-ligne
              </Badge>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Importer</span>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Importer un historique</DialogTitle>
                    <DialogDescription>
                      Collez vos enregistrements en utilisant les lettres R, B, E, L
                      (séparés par des virgules, espaces ou retours à la ligne).
                    </DialogDescription>
                  </DialogHeader>
                  <Textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={"Ex: R,R,R,B,R,E,R,R,R,L,R,B,R...\nou: RRBREERRLLBBR...\nou: Rare, Rare, Big Rare, Epic..."}
                    rows={6}
                    className="font-mono text-sm"
                  />
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Annuler</Button>
                    </DialogClose>
                    <Button onClick={importRecords}>Importer</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline" size="sm"
                    onClick={exportRecords}
                    disabled={records.length === 0}
                    className="gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Exporter</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copier l&apos;historique (R,B,E,L...)</TooltipContent>
              </Tooltip>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Aide</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Comment utiliser le Crate Tracker</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <div className="flex items-start gap-2">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      <p>Après chaque combat gagné, cliquez sur le bouton correspondant à la rareté du crate reçu (ou utilisez les touches <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">R</kbd> <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">B</kbd> <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">E</kbd> <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">L</kbd>).</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      <p>Après au moins <strong>210 enregistrements</strong> (3 cycles), le scan s&apos;active automatiquement.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      <p>Le scan détecte le début de chaque cycle de 70 crates et affiche les stats du cycle en cours.</p>
                    </div>
                    <Separator />
                    <div className="flex items-start gap-2">
                      <Save className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
                      <p><strong>Tout est sauvegardé localement</strong> dans ton navigateur (localStorage). Aucun serveur, aucune connexion internet requise.</p>
                    </div>
                    <Separator />
                    <h4 className="font-semibold text-foreground">Pool de chaque cycle (70 crates)</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {RARITY_CONFIG.map((c) => (
                        <div key={c.rarity} className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${c.color} border`}>
                          {c.icon}
                          <span className={c.textColor}>{c.label}</span>
                          <span className={c.textColor + ' ml-auto font-mono text-xs'}>{c.expected}/70</span>
                        </div>
                      ))}
                    </div>
                    <Separator />
                    <h4 className="font-semibold text-foreground">Raccourcis clavier</h4>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">R</kbd><span>Rare</span></div>
                      <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">B</kbd><span>Big Rare</span></div>
                      <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">E</kbd><span>Epic</span></div>
                      <div className="flex items-center gap-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">L</kbd><span>Legendary</span></div>
                      <div className="flex items-center gap-2 col-span-2"><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Suppr</kbd><span>Annuler dernier</span></div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </header>

        {/* ─── Main Content ────────────────────────────── */}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 sm:py-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">

            {/* ─── Left Column: Record ──────────────────── */}
            <div className="lg:col-span-5 xl:col-span-4 space-y-4">

              {/* Add Buttons */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Ajouter un crate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    {RARITY_CONFIG.map((c) => (
                      <Tooltip key={c.rarity}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            className={`h-12 gap-2 border-2 text-sm font-semibold transition-all active:scale-95 ${c.color}`}
                            onClick={() => addRecord(c.rarity)}
                          >
                            {c.icon}
                            <span className={c.textColor}>{c.label}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Touche <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono">{c.shortLabel}</kbd>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost" size="sm"
                          onClick={deleteLast}
                          disabled={records.length === 0}
                          className="gap-1.5 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Annuler dernier
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Suppr / Retour arrière</TooltipContent>
                    </Tooltip>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost" size="sm"
                          disabled={records.length === 0}
                          className="gap-1.5 text-destructive hover:text-destructive"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Tout effacer
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
                </CardContent>
              </Card>

              {/* Record List */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <List className="h-4 w-4" />
                      Historique
                    </CardTitle>
                    <Badge variant="outline" className="text-xs font-mono">
                      #{records.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[300px] sm:h-[400px]">
                    <div className="px-4 pb-4 space-y-0.5">
                      {records.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                          <Swords className="h-10 w-10 mb-2 opacity-30" />
                          <p className="text-sm">Aucun enregistrement</p>
                          <p className="text-xs">Cliquez sur les boutons ci-dessus</p>
                        </div>
                      ) : (
                        <>
                          {records.map((r, i) => {
                            const config = RARITY_CONFIG.find((c) => c.rarity === r)!;
                            const isCycleStart =
                              scanResult && scanResult.cycleStart >= 0 && i === scanResult.cycleStart;
                            return (
                              <div
                                key={i}
                                className={
                                  `flex items-center gap-2 px-2 py-1 rounded-md text-xs ${config.color}`
                                }
                              >
                                <span className="text-muted-foreground font-mono w-8 text-right shrink-0">
                                  {i + 1}
                                </span>
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor:
                                      r === 'Rare' ? '#38bdf8'
                                      : r === 'Big Rare' ? '#06b6d4'
                                      : r === 'Epic' ? '#a855f7'
                                      : '#f59e0b',
                                  }}
                                />
                                <span className={config.textColor + ' font-medium'}>{config.label}</span>
                                {isCycleStart && (
                                  <Badge variant="outline" className="ml-auto text-[10px] border-amber-400 text-amber-600">
                                    Cycle ↓
                                  </Badge>
                                )}
                              </div>
                            );
                          })}
                          <div ref={recordEndRef} />
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* ─── Right Column: Analysis ───────────────── */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">

              {/* Progress banner before scan threshold */}
              {!scanResult && records.length > 0 && (
                <Card className="border-amber-200 bg-amber-50">
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <Info className="h-4 w-4 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-amber-800">
                        <strong>{CYCLE_SIZE * 3 - records.length} crates</strong> restants avant le scan automatique.
                      </p>
                      <div className="w-full h-1.5 bg-amber-200 rounded-full mt-1.5 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (records.length / (CYCLE_SIZE * 3)) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Scan result banner */}
              {scanResult && (
                <Card className={scanResult.valid ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}>
                  <CardContent className="py-3 px-4 flex items-start gap-3">
                    {scanResult.valid ? (
                      <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${scanResult.valid ? 'text-emerald-800' : 'text-red-800'}`}>
                        {scanResult.message}
                      </p>
                      {scanResult.valid && (
                        <p className="text-xs text-emerald-600 mt-0.5">
                          {scanResult.totalCycles} cycle(s) complet(s) • Position: {scanResult.currentCyclePosition}/{CYCLE_SIZE}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Cycle Stats */}
              {cycleStats && scanResult?.valid && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Grid3X3 className="h-4 w-4" />
                      Cycle en cours
                      <Badge variant="secondary" className="text-xs ml-auto">
                        {progressPercent}%
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="w-full h-2 bg-muted rounded-full mb-4 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {RARITY_CONFIG.map((c) => {
                        const stat = cycleStats[c.rarity];
                        const isComplete = stat.remaining <= 0;
                        return (
                          <div
                            key={c.rarity}
                            className={`rounded-lg border-2 p-3 transition-all ${
                              isComplete
                                ? 'border-emerald-300 bg-emerald-50'
                                : `${c.color} border`
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-2">
                              {c.icon}
                              <span className={`text-xs font-semibold ${c.textColor}`}>{c.label}</span>
                            </div>
                            <div className="flex items-baseline gap-1">
                              <span className={`text-2xl font-bold ${c.textColor}`}>{stat.dropped}</span>
                              <span className="text-xs text-muted-foreground">/ {c.expected}</span>
                            </div>
                            <div className="mt-1.5 w-full h-1.5 bg-black/10 rounded-full overflow-hidden">
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
                            <div className={`text-xs mt-1 font-medium ${
                              isComplete ? 'text-emerald-600' : 'text-muted-foreground'
                            }`}>
                              {isComplete ? '✓ Complété' : `${stat.remaining} restant${stat.remaining > 1 ? 's' : ''}`}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Legendary alerts */}
                    {legendDropped > 0 && (
                      <div className="mt-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-amber-500 shrink-0" />
                        <p className="text-sm text-emerald-800">
                          <strong>Legendary obtenu ce cycle !</strong> Tu peux jouer en mode auto sans risque.
                        </p>
                      </div>
                    )}
                    {legendDropped === 0 && legendRemaining === 1 && progressPercent > 50 && (
                      <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-amber-500 shrink-0" />
                        <p className="text-sm text-amber-800">
                          <strong>Legendary pas encore tombé.</strong>{' '}
                          {progressPercent > 85
                            ? 'Ça devrait tomber bientôt ! Assure-toi d\'avoir des slots libres.'
                            : 'Continue à enregistrer tes crates.'}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Cycle Visualization */}
              {scanResult?.valid && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <History className="h-4 w-4" />
                        Visualisation du cycle
                      </CardTitle>
                      {scanResult.cycleHistory.length > 1 && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setShowHistory(!showHistory)}
                          className="gap-1 text-xs"
                        >
                          <History className="h-3 w-3" />
                          {showHistory ? 'Cycle actuel' : `${scanResult.cycleHistory.length} cycles`}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {!showHistory ? (
                      <CycleGrid
                        cycle={scanResult.incompleteCycle.length > 0
                          ? scanResult.incompleteCycle
                          : scanResult.currentCycle}
                        cycleSize={CYCLE_SIZE}
                      />
                    ) : (
                      <div className="space-y-6">
                        {scanResult.cycleHistory.map((cycle, i) => (
                          <div key={i}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-medium text-muted-foreground">Cycle {i + 1}</span>
                              {scanResult.cycleValidities[i] ? (
                                <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">✓ Valide</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-red-600 border-red-300">✗ Invalide</Badge>
                              )}
                            </div>
                            <CycleGrid cycle={cycle} cycleSize={CYCLE_SIZE} />
                          </div>
                        ))}
                        {scanResult.incompleteCycle.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-xs font-medium text-muted-foreground">
                                Cycle en cours ({scanResult.incompleteCycle.length}/{CYCLE_SIZE})
                              </span>
                              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">En cours</Badge>
                            </div>
                            <CycleGrid cycle={scanResult.incompleteCycle} cycleSize={CYCLE_SIZE} />
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Résumé
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="text-center">
                      <div className="text-2xl font-bold font-mono">{records.length}</div>
                      <div className="text-xs text-muted-foreground">Total crates</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold font-mono">
                        {scanResult?.totalCycles ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">Cycles complets</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold font-mono text-amber-600">
                        {records.filter((r) => r === 'Legendary').length}
                      </div>
                      <div className="text-xs text-muted-foreground">Légendaires</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold font-mono">
                        {scanResult?.currentCyclePosition ?? '-'}
                      </div>
                      <div className="text-xs text-muted-foreground">Position cycle</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </main>

        {/* ─── Footer ──────────────────────────────────── */}
        <footer className="border-t bg-white/80 backdrop-blur-sm mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 text-center text-xs text-muted-foreground">
            LG Crate Tracker — Basé sur les recherches de Daa, OxKing, pho et la communauté.
            <br className="sm:hidden" />{' '}
            <span className="inline-flex items-center gap-1"><WifiOff className="h-3 w-3" /> Données stockées localement dans ton navigateur.</span>
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
