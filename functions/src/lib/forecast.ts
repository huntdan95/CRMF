import { logger } from 'firebase-functions/v2';

/**
 * The day's forecast at the marina from Open-Meteo (no key needed), as the
 * confirmation page shows it (src/components/booking/TourWeather.tsx).
 * Same coordinates as siteConfig.marina.
 */
const MARINA_LAT = 28.8966;
const MARINA_LON = -82.5915;

export interface DayForecast {
  label: string;
  highF: number;
  lowF: number;
  rainPct: number;
}

const LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  80: 'Light rain showers',
  81: 'Showers',
  82: 'Heavy showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms with hail',
  99: 'Severe thunderstorms',
};

/** Null when Open-Meteo can't be reached or says nothing useful: the email goes without. */
export async function fetchDayForecast(
  date: string,
  fetchFn: typeof fetch = fetch,
): Promise<DayForecast | null> {
  const params = new URLSearchParams({
    latitude: String(MARINA_LAT),
    longitude: String(MARINA_LON),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
    timezone: 'America/New_York',
    start_date: date,
    end_date: date,
    temperature_unit: 'fahrenheit',
  });
  try {
    const res = await fetchFn(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const body = (await res.json()) as {
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: (number | null)[];
        weather_code?: number[];
      };
    };
    const high = body.daily?.temperature_2m_max?.[0];
    const low = body.daily?.temperature_2m_min?.[0];
    const code = body.daily?.weather_code?.[0];
    if (typeof high !== 'number' || typeof low !== 'number') return null;
    return {
      label: (code !== undefined && LABELS[code]) || 'Forecast',
      highF: Math.round(high),
      lowF: Math.round(low),
      rainPct: Math.round(body.daily?.precipitation_probability_max?.[0] ?? 0),
    };
  } catch (err) {
    logger.warn('Forecast unavailable', { date, err: String(err) });
    return null;
  }
}
