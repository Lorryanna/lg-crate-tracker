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
    return parsed;
  } catch {
    return [];
  }
}

function saveRecords(records: Rarity[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// ─── Rarity config ────────────────────────────────────────

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
      cachedParsed = Array.isArray(parsed) ? parsed : EMPTY_RECORDS;
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

const APP_VERSION = 'v1.8.1';

export default function CrateTracker() {
  const records = useSyncExternalStore(
    subscribeToStorage,
    getRecordsSnapshot,
    () => EMPTY_RECORDS,
  );

  const [importText, setImportText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyContainerRef = useRef<HTMLDivElement>(null);

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
    cachedRaw = '';
    notifyListeners();
  }, []);

  const deleteLast = useCallback(() => {
    const current = getRecordsSnapshot();
    if (current.length === 0) {
      toast.error('Aucun enregistrement à annuler');
      return;
    }
    saveRecords(current.slice(0, -1));
    cachedRaw = '';
    notifyListeners();
  }, []);

  const clearAll = useCallback(() => {
    saveRecords([]);
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
    const current = getRecordsSnapshot();
    saveRecords([...current, ...parsed]);
    cachedRaw = '';
    notifyListeners();
    toast.success(`${parsed.length} enregistrements importés`);
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
      const current = getRecordsSnapshot();
      saveRecords([...current, ...parsed]);
      cachedRaw = '';
      notifyListeners();
      toast.success(`${parsed.length} enregistrements importés depuis ${file.name}`);
      setImportOpen(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const exportClipboard = useCallback(() => {
    const text = records.map((r) => RARITY_SHORT[r]).join(', ');
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copié dans le presse-papier !');
      setExportOpen(false);
    }).catch(() => {
      toast.error('Impossible de copier');
    });
  }, [records]);

  const exportFile = useCallback(() => {
    const text = records.map((r) => RARITY_SHORT[r]).join(', ');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lg-crates-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Fichier téléchargé !');
    setExportOpen(false);
  }, [records]);

  // ─── Keyboard shortcuts ───────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); addRecord('Rare'); }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); addRecord('Big Rare'); }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); addRecord('Epic'); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); addRecord('Legendary'); }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteLast(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addRecord, deleteLast]);

  // ─── Auto-scroll history container to bottom ─────────

  useEffect(() => {
    const el = historyContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [records.length]);

  // ─── Cycle start indices (for C↓ marker in history) ──

  const cycleStartIndices = useMemo(() => {
    if (!scanResult || scanResult.cycleStart < 0) return new Set<number>();
    const indices = new Set<number>();
    for (let c = 0; c <= scanResult.totalCycles; c++) {
      const idx = scanResult.cycleStart + c * CYCLE_SIZE;
      if (idx < records.length) indices.add(idx);
    }
    return indices;
  }, [scanResult, records.length]);

  // ─── Derived values ────────────────────────────────────

  const progressPercent = cycleStats
    ? Math.round(
        ((cycleStats['Rare'].dropped + cycleStats['Big Rare'].dropped +
          cycleStats['Epic'].dropped + cycleStats['Legendary'].dropped) / CYCLE_SIZE) * 100
      )
    : 0;

  const legendDropped = cycleStats ? cycleStats['Legendary'].dropped : 0;
  const legendRemaining = cycleStats ? cycleStats['Legendary'].remaining : 1;
  const remainingInCycle = scanResult ? CYCLE_SIZE - scanResult.currentCyclePosition : 0;

  // ─── Render ──────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-screen flex flex-col bg-gradient-to-br from-stone-50 to-stone-100 overflow-hidden">

        {/* ─── Header (compact) ────────────────────────── */}
        <header className="border-b bg-white/80 backdrop-blur-sm shrink-0">
          <div className="max-w-[1600px] mx-auto px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Swords className="h-4 w-4 text-amber-500" />
              <h1 className="text-sm font-bold tracking-tight">
                LG Crate Tracker
              </h1>
            </div>
            <div className="flex items-center gap-1">
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <Upload className="h-3 w-3" />
                    <span className="hidden sm:inline">Importer</span>
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
                      placeholder="R, R, B, E, R, L, ..."
                      rows={4}
                      className="text-xs font-mono"
                    />
                    <Button onClick={handleImport} disabled={!importText.trim()} className="w-full gap-2">
                      <Upload className="h-4 w-4" />
                      Importer
                    </Button>
                    <Separator />
                    <div className="text-center text-xs text-muted-foreground">ou</div>
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full gap-2">
                      <Upload className="h-4 w-4" />
                      Charger un fichier .txt
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.csv,.text"
                      onChange={handleFileImport}
                      className="hidden"
                    />
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={exportOpen} onOpenChange={setExportOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <Download className="h-3 w-3" />
                    <span className="hidden sm:inline">Exporter</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Exporter l&apos;historique</DialogTitle>
                    <DialogDescription>Choisis le mode d&apos;export.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Button onClick={exportClipboard} className="w-full justify-start gap-2" variant="outline">
                      <Save className="h-4 w-4" />
                      Copier dans le presse-papier
                    </Button>
                    <Button onClick={exportFile} className="w-full justify-start gap-2" variant="outline">
                      <Download className="h-4 w-4" />
                      Télécharger un fichier .txt
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <HelpCircle className="h-3 w-3" />
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

        {/* ─── Main Content (fills remaining height) ──── */}
        <main className="flex-1 min-h-0 overflow-hidden max-w-[1600px] mx-auto w-full px-4 py-2">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 h-full">

            {/* ═══ LEFT COLUMN: History (full height) ════ */}
            <div className="lg:col-span-5 flex flex-col min-h-0">
              <Card className="flex-1 flex flex-col min-h-0 overflow-hidden py-0 gap-0">
                <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 shrink-0 border-b">
                  <div className="flex items-center gap-1.5">
                    <List className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Historique</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    #{records.length}
                  </Badge>
                </div>
                <div
                  ref={historyContainerRef}
                  className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
                >
                  {records.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <Swords className="h-10 w-10 mb-2 opacity-30" />
                      <p className="text-sm">Aucun enregistrement</p>
                      <p className="text-xs">Utilise les boutons ou les touches R/B/E/L</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-0.5">
                      {records.map((r, i) => {
                        const config = RARITY_CONFIG.find((c) => c.rarity === r)!;
                        const isCycleStart = cycleStartIndices.has(i);
                        return (
                          <div
                            key={i}
                            className={`flex items-center gap-1 px-1 py-px rounded text-[11px] ${config.color}`}
                          >
                            <span className="text-muted-foreground font-mono w-5 text-right shrink-0">
                              {i + 1}
                            </span>
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{
                                backgroundColor:
                                  r === 'Rare' ? '#38bdf8'
                                  : r === 'Big Rare' ? '#06b6d4'
                                  : r === 'Epic' ? '#a855f7'
                                  : '#f59e0b',
                              }}
                            />
                            <span className={config.textColor + ' font-medium truncate'}>{config.label}</span>
                            {isCycleStart && (
                              <span className="text-[8px] border border-amber-400 text-amber-600 rounded px-0.5 ml-auto">
                                C↓
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* ═══ RIGHT COLUMN: Controls + Analysis ════ */}
            <div className="lg:col-span-7 flex flex-col gap-2.5 min-h-0 overflow-y-auto">

              {/* ── 1. Buttons row ────────────────────── */}
              <Card className="shrink-0 py-0 gap-0">
                <CardContent className="px-3 py-2.5">
                  <div className="grid grid-cols-4 gap-1.5">
                    {RARITY_CONFIG.map((c) => (
                      <Tooltip key={c.rarity}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            className={`h-9 gap-1.5 border-2 text-xs font-semibold transition-all active:scale-95 ${c.color}`}
                            onClick={() => addRecord(c.rarity)}
                          >
                            {c.icon}
                            <span className={c.textColor}>{c.label}</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Touche <kbd className="px-1 py-0.5 bg-stone-700 text-stone-50 rounded text-xs font-mono">{c.shortLabel}</kbd>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  <div className="flex justify-end gap-1.5 mt-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost" size="sm"
                          onClick={deleteLast}
                          disabled={records.length === 0}
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
                          variant="ghost" size="sm"
                          disabled={records.length === 0}
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
                </CardContent>
              </Card>

              {/* ── 2. Progress banner (before scan threshold) ── */}
              {!scanResult && records.length > 0 && (
                <Card className="border-amber-200 bg-amber-50 shrink-0 py-0 gap-0">
                  <CardContent className="py-1.5 px-2.5 flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-amber-800">
                        <strong>{CYCLE_SIZE * 3 - records.length} crates</strong> restants avant le scan automatique.
                      </p>
                      <div className="w-full h-1 bg-amber-200 rounded-full mt-0.5 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── 3. Scan result banner ─────────────── */}
              {scanResult && (
                <Card className={scanResult.valid ? 'border-emerald-200 bg-emerald-50 shrink-0 py-0 gap-0' : 'border-red-200 bg-red-50 shrink-0 py-0 gap-0'}>
                  <CardContent className="py-1.5 px-2.5 flex items-start gap-2">
                    {scanResult.valid ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p className={`text-xs font-medium ${scanResult.valid ? 'text-emerald-800' : 'text-red-800'}`}>
                        {scanResult.message}
                      </p>
                      {scanResult.valid && (
                        <p className="text-[11px] text-emerald-600 mt-0.5">
                          {scanResult.totalCycles} cycle(s) complet(s) • Position : {scanResult.currentCyclePosition}/{CYCLE_SIZE}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── 4. Cycle en cours (aligned with buttons) ── */}
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
                          <div
                            key={c.rarity}
                            className={`rounded-md border-2 p-1.5 ${
                              isComplete
                                ? 'border-emerald-300 bg-emerald-50'
                                : `${c.color} border`
                            }`}
                          >
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
                                → {remainingInCycle > 0
                                  ? ((stat.remaining / remainingInCycle) * 100).toFixed(1)
                                  : '0'}%
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Legendary alerts */}
                    {legendDropped > 0 && (
                      <div className="mt-2 p-1.5 rounded-md bg-emerald-50 border border-emerald-200 flex items-center gap-2">
                        <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <p className="text-[11px] text-emerald-800">
                          <strong>Legendary obtenu ce cycle !</strong> Mode auto sans risque.
                        </p>
                      </div>
                    )}
                    {legendDropped === 0 && legendRemaining === 1 && progressPercent > 50 && (
                      <div className="mt-2 p-1.5 rounded-md bg-amber-50 border border-amber-200 flex items-center gap-2">
                        <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <p className="text-[11px] text-amber-800">
                          <strong>Legendary pas encore tombé.</strong>{' '}
                          {progressPercent > 85
                            ? 'Ça devrait tomber bientôt !'
                            : 'Continue à enregistrer.'}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ── 5. Summary + Visualization side by side ── */}
              <div className="flex gap-2 shrink-0">

                {/* Summary — compact 2×2 */}
                <Card className="shrink-0 py-0 gap-0">
                  <CardContent className="py-2 px-3">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-center">
                      <div>
                        <div className="text-sm font-bold font-mono">{records.length}</div>
                        <div className="text-[10px] text-muted-foreground">Total</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold font-mono text-amber-600">{records.filter((r) => r === 'Legendary').length}</div>
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

                {/* Cycle Visualization — takes remaining width */}
                {scanResult?.valid && (
                  <Card className="flex-1 flex flex-col min-w-0 py-0 gap-0">
                    <CardHeader className="pb-1.5 pt-2 px-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-xs font-medium flex items-center gap-1.5">
                          <History className="h-3.5 w-3.5" />
                          Visualisation du cycle
                        </CardTitle>
                        {scanResult.cycleHistory.length > 1 && (
                          <Button
                            variant="ghost" size="sm"
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
                          cycle={scanResult.incompleteCycle.length > 0
                            ? scanResult.incompleteCycle
                            : scanResult.currentCycle}
                          cycleSize={CYCLE_SIZE}
                        />
                      ) : (
                        <div className="space-y-4">
                          {scanResult.cycleHistory.map((cycle, i) => (
                            <div key={i}>
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-[11px] font-medium text-muted-foreground">Cycle {i + 1}</span>
                                {scanResult.cycleValidities[i] ? (
                                  <Badge variant="outline" className="text-[9px] text-emerald-600 border-emerald-300">✓ Valide</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] text-red-600 border-red-300">✗ Invalide</Badge>
                                )}
                              </div>
                              <CycleGrid cycle={cycle} cycleSize={CYCLE_SIZE} />
                            </div>
                          ))}
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