'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from '@/lib/clsx';

export interface SignatureValue {
  /** `data:image/png;base64,…` */
  png: string;
  method: 'drawn' | 'typed';
}

const INK = '#0E201E';
const HEIGHT = 170;
/** Higher densities only make the PNG bigger; 2× is plenty for print. */
const MAX_DPR = 2;
/** A dot or a stray tap isn't a signature. */
const MIN_POINTS = 12;

/**
 * Finger/mouse signature box, with a typed-name fallback for anyone who
 * can't draw one (a typed name is a valid electronic signature too).
 * Reports a PNG of the signature, or null while it's empty.
 */
export function SignaturePad({
  typedName,
  onChange,
  invalid,
}: {
  typedName: string;
  onChange: (value: SignatureValue | null) => void;
  invalid?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const points = useRef(0);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [hasInk, setHasInk] = useState(false);
  // Bumped when a resize clears the canvas, so a typed signature is drawn
  // again at the new width instead of silently disappearing.
  const [resizes, setResizes] = useState(0);

  const context = useCallback(() => canvasRef.current?.getContext('2d') ?? null, []);

  const reset = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = context();
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
    }
    points.current = 0;
    setHasInk(false);
    onChange(null);
  }, [context, onChange]);

  // Size the canvas to its box. A rotation or resize would stretch the
  // drawing, so it clears instead and the signer draws again.
  useEffect(() => {
    reset();
    let width = canvasRef.current?.clientWidth ?? 0;
    const onResize = () => {
      const next = canvasRef.current?.clientWidth ?? 0;
      if (next !== width) {
        width = next;
        reset();
        setResizes((n) => n + 1);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // Only on mount: `reset` is stable for a given `onChange`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Typed mode: render the name in a script-like face.
  useEffect(() => {
    if (mode !== 'type') return;
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const name = typedName.trim();
    if (!name) {
      onChange(null);
      return;
    }
    const width = canvas.clientWidth;
    let size = 44;
    ctx.font = `italic ${size}px "Snell Roundhand", "Segoe Script", "Brush Script MT", Georgia, serif`;
    while (ctx.measureText(name).width > width - 32 && size > 18) {
      size -= 2;
      ctx.font = `italic ${size}px "Snell Roundhand", "Segoe Script", "Brush Script MT", Georgia, serif`;
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, 16, HEIGHT - 52);
    onChange({ png: canvas.toDataURL('image/png'), method: 'typed' });
  }, [mode, typedName, context, onChange, resizes]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode !== 'draw') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    const ctx = context();
    if (ctx) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    points.current += 1;
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const ctx = context();
    const p = pos(e);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
    points.current += 1;
  }

  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const enough = points.current >= MIN_POINTS;
    setHasInk(points.current > 0);
    onChange(enough ? { png: canvas.toDataURL('image/png'), method: 'drawn' } : null);
  }

  function switchMode(next: 'draw' | 'type') {
    if (next === mode) return;
    reset();
    setMode(next);
  }

  return (
    <div>
      <div
        className={clsx(
          'relative overflow-hidden rounded-xl border-2 bg-white',
          invalid ? 'border-[var(--color-error)]' : 'border-[var(--color-ink)]/25',
        )}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={mode === 'draw' ? 'Signature box: draw your signature' : `Typed signature: ${typedName}`}
          className={clsx('block w-full touch-none select-none', mode === 'draw' ? 'cursor-crosshair' : '')}
          style={{ height: HEIGHT }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
        {/* Signature line */}
        <div aria-hidden className="pointer-events-none absolute inset-x-4 bottom-10 border-b border-dashed border-[var(--color-ink)]/30" />
        <span aria-hidden className="pointer-events-none absolute bottom-3 left-4 text-xs text-[var(--color-ink-soft)]">
          {mode === 'draw' ? (hasInk ? '' : 'Sign here with your finger') : typedName.trim() ? '' : 'Enter your name above'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={() => switchMode(mode === 'draw' ? 'type' : 'draw')}
          className="font-medium text-[var(--color-spring)] underline underline-offset-2"
        >
          {mode === 'draw' ? 'Can’t draw? Type your signature' : 'Draw my signature instead'}
        </button>
        {mode === 'draw' && hasInk && (
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-[var(--color-ink)]/20 px-3 py-1.5 font-medium hover:border-[var(--color-ink)]"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
