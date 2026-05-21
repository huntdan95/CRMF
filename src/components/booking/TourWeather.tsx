'use client';

import { useEffect, useState } from 'react';
import { siteConfig } from '@/lib/site-config';
import { parseIsoDate } from '@/lib/date';

interface Props {
  /** YYYY-MM-DD in the marina's local timezone. */
  date: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'out-of-range' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      tempMax: number;
      tempMin: number;
      precipPct: number;
      weatherCode: number;
    };

const WEATHER_DESCRIPTIONS: Record<number, { label: string; emoji: string }> = {
  0: { label: 'Clear sky', emoji: '☀️' },
  1: { label: 'Mostly clear', emoji: '🌤️' },
  2: { label: 'Partly cloudy', emoji: '⛅' },
  3: { label: 'Overcast', emoji: '☁️' },
  45: { label: 'Fog', emoji: '🌫️' },
  48: { label: 'Freezing fog', emoji: '🌫️' },
  51: { label: 'Light drizzle', emoji: '🌦️' },
  53: { label: 'Drizzle', emoji: '🌦️' },
  55: { label: 'Heavy drizzle', emoji: '🌧️' },
  61: { label: 'Light rain', emoji: '🌧️' },
  63: { label: 'Rain', emoji: '🌧️' },
  65: { label: 'Heavy rain', emoji: '🌧️' },
  71: { label: 'Light snow', emoji: '🌨️' },
  73: { label: 'Snow', emoji: '🌨️' },
  80: { label: 'Light rain showers', emoji: '🌦️' },
  81: { label: 'Showers', emoji: '🌧️' },
  82: { label: 'Heavy showers', emoji: '⛈️' },
  95: { label: 'Thunderstorms', emoji: '⛈️' },
  96: { label: 'Thunderstorms with hail', emoji: '⛈️' },
  99: { label: 'Severe thunderstorms', emoji: '⛈️' },
};

function describe(code: number): { label: string; emoji: string } {
  return WEATHER_DESCRIPTIONS[code] ?? { label: 'Forecast available', emoji: '🌤️' };
}

export function TourWeather({ date }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const target = parseIsoDate(date);
    if (!target) {
      setState({ kind: 'error' });
      return;
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const daysOut = Math.floor((target.getTime() - now.getTime()) / 86_400_000);
    // Open-Meteo reliably forecasts ~14 days. Beyond that, skip.
    if (daysOut > 14 || daysOut < -1) {
      setState({ kind: 'out-of-range' });
      return;
    }

    const params = new URLSearchParams({
      latitude: String(siteConfig.marina.latitude),
      longitude: String(siteConfig.marina.longitude),
      daily:
        'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
      timezone: 'America/New_York',
      start_date: date,
      end_date: date,
      temperature_unit: 'fahrenheit',
    });

    let cancelled = false;
    fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error('weather fetch failed');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const daily = data?.daily;
        if (
          !daily ||
          !Array.isArray(daily.temperature_2m_max) ||
          daily.temperature_2m_max.length === 0
        ) {
          setState({ kind: 'error' });
          return;
        }
        setState({
          kind: 'ready',
          tempMax: Math.round(daily.temperature_2m_max[0]),
          tempMin: Math.round(daily.temperature_2m_min[0]),
          precipPct: Math.round(daily.precipitation_probability_max?.[0] ?? 0),
          weatherCode: daily.weather_code?.[0] ?? 0,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  if (state.kind === 'loading') {
    return (
      <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-4 text-sm text-[var(--color-ink-soft)] animate-pulse">
        Checking the forecast for your tour…
      </div>
    );
  }

  if (state.kind === 'out-of-range') {
    return (
      <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-4 text-sm">
        <p className="font-medium">Forecast available closer to your tour.</p>
        <p className="mt-1 text-[var(--color-ink-soft)]">
          We&rsquo;ll keep an eye on conditions and email you if anything
          looks dicey. Travis is the final call on whether to launch.
        </p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return null; // graceful — just don't show the widget
  }

  const desc = describe(state.weatherCode);
  return (
    <div className="rounded-2xl bg-[var(--color-cream)] border border-[var(--color-ink)]/8 p-5">
      <div className="flex items-start gap-4">
        <p className="text-4xl leading-none" aria-hidden>
          {desc.emoji}
        </p>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-ink-soft)] font-medium">
            Forecast for your tour
          </p>
          <p className="mt-1 font-display text-xl leading-tight">
            {desc.label}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            High {state.tempMax}°F · Low {state.tempMin}°F ·{' '}
            {state.precipPct}% chance of rain
          </p>
          {state.precipPct >= 50 && (
            <p className="mt-2 text-xs text-[var(--color-coral-dark)]">
              Rain in the forecast — Travis tours rain or shine when
              conditions are safe. If it&rsquo;s bad enough to cancel,
              you get a full refund.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
