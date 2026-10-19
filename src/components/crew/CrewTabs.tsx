'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { clsx } from '@/lib/clsx';

export type CrewTab = 'schedule' | 'photos' | 'settings';

const TABS: { id: CrewTab; label: string; icon: ReactNode }[] = [
  {
    id: 'schedule',
    label: 'Schedule',
    icon: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </>
    ),
  },
  {
    id: 'photos',
    label: 'Photos',
    icon: (
      <>
        <path d="M4 8.5a2 2 0 0 1 2-2h1.6L9 4.5h6l1.4 2H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <>
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
        <circle cx="15" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </>
    ),
  },
];

function tabFromHash(hash: string): CrewTab {
  const id = hash.replace(/^#/, '');
  return TABS.some((t) => t.id === id) ? (id as CrewTab) : 'schedule';
}

const noopSubscribe = () => () => {};

const DotContext = createContext<(tab: CrewTab, on: boolean) => void>(() => {});

/**
 * Puts a dot on `tab` in the tab bar while `on` — something there still
 * needs setting up. Does nothing outside {@link CrewTabs}.
 */
export function useTabDot(tab: CrewTab, on: boolean) {
  const setDot = useContext(DotContext);
  useEffect(() => {
    setDot(tab, on);
    return () => setDot(tab, false);
  }, [setDot, tab, on]);
}

/**
 * The crew app's screens behind a bottom tab bar, one at a time. Every
 * panel stays mounted while hidden, so an upload keeps going (and keeps
 * its progress bar) on the way to the schedule and back, and the
 * notifications panel re-saves this phone's subscription on every open.
 * The open tab rides in the URL hash so a reload lands back on it.
 */
export function CrewTabs({ panels }: { panels: Record<CrewTab, ReactNode> }) {
  // The hash is read once, after hydration; taps take over from there.
  const fromHash = useSyncExternalStore(
    noopSubscribe,
    () => tabFromHash(window.location.hash),
    () => 'schedule' as const,
  );
  const [picked, setPicked] = useState<CrewTab | null>(null);
  const tab = picked ?? fromHash;

  const [dots, setDots] = useState<Partial<Record<CrewTab, boolean>>>({});
  const setDot = useCallback(
    (id: CrewTab, on: boolean) =>
      setDots((d) => (!!d[id] === on ? d : { ...d, [id]: on })),
    [],
  );

  // Each tab keeps its own scroll position, like a native app.
  const scrollByTab = useRef<Partial<Record<CrewTab, number>>>({});
  const shown = useRef(tab);
  useLayoutEffect(() => {
    if (shown.current === tab) return;
    shown.current = tab;
    window.scrollTo({ top: scrollByTab.current[tab] ?? 0, behavior: 'instant' });
  }, [tab]);

  function select(next: CrewTab) {
    if (next === tab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    scrollByTab.current[tab] = window.scrollY;
    setPicked(next);
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      '',
      next === 'schedule' ? pathname + search : `${pathname}${search}#${next}`,
    );
  }

  function onKeyDown(e: KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length]!.id;
    select(next);
    document.getElementById(`crew-tab-${next}`)?.focus();
  }

  return (
    <DotContext.Provider value={setDot}>
      <main className="mx-auto max-w-xl px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+6rem)]">
        {TABS.map(({ id }) => (
          <div
            key={id}
            id={`crew-panel-${id}`}
            role="tabpanel"
            aria-labelledby={`crew-tab-${id}`}
            hidden={id !== tab}
          >
            {panels[id]}
          </div>
        ))}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-ink)]/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div role="tablist" aria-label="Crew app" className="mx-auto grid max-w-xl grid-cols-3">
          {TABS.map(({ id, label, icon }, i) => {
            const active = id === tab;
            return (
              <button
                key={id}
                id={`crew-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`crew-panel-${id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => select(id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={clsx(
                  'flex h-16 flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold',
                  active ? 'text-[var(--color-spring)]' : 'text-[var(--color-ink-soft)]',
                )}
              >
                <span
                  className={clsx(
                    'relative inline-flex h-8 w-14 items-center justify-center rounded-full transition-colors',
                    active && 'bg-[var(--color-mist)]',
                  )}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    {icon}
                  </svg>
                  {dots[id] && (
                    <span className="absolute top-1 right-3 h-2.5 w-2.5 rounded-full bg-[var(--color-buoy)] ring-2 ring-white" />
                  )}
                </span>
                {label}
                {dots[id] && <span className="sr-only"> (needs setting up)</span>}
              </button>
            );
          })}
        </div>
      </div>
    </DotContext.Provider>
  );
}
