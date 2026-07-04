import { useEffect, useState } from 'react'

// Open-Meteo: free, no API key, CORS-enabled. Cached per-coordinate so several
// widgets pointing at the same city share one request.
export interface WeatherData {
  temp: number
  code: number // WMO weather code
  hi: number
  lo: number
  humidity: number
  wind: number // km/h
}

const TTL = 10 * 60 * 1000
const cache = new Map<string, { at: number; data: WeatherData }>()
const inflight = new Map<string, Promise<WeatherData | null>>()

function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data)
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(
          'https://api.open-meteo.com/v1/forecast'
          + `?latitude=${lat}&longitude=${lon}`
          + '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m'
          + '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1')
        const j = await r.json()
        const data: WeatherData = {
          temp: j.current.temperature_2m,
          code: j.current.weather_code,
          humidity: j.current.relative_humidity_2m,
          wind: j.current.wind_speed_10m,
          hi: j.daily.temperature_2m_max[0],
          lo: j.daily.temperature_2m_min[0],
        }
        cache.set(key, { at: Date.now(), data })
        return data
      } catch {
        return null
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, p)
  }
  return p
}

export function useWeather(lat: number | undefined, lon: number | undefined): WeatherData | null {
  const [data, setData] = useState<WeatherData | null>(null)
  useEffect(() => {
    if (lat == null || lon == null) {
      setData(null)
      return
    }
    let dead = false
    const run = () => fetchWeather(lat, lon).then((d) => { if (!dead && d) setData(d) })
    run()
    const t = setInterval(run, TTL)
    return () => { dead = true; clearInterval(t) }
  }, [lat, lon])
  return data
}

/** City-name search (Japanese-aware) → best match, or null. */
export async function geocode(q: string):
Promise<{ name: string; lat: number; lon: number } | null> {
  try {
    const r = await fetch(
      'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(q)}&count=1&language=ja&format=json`)
    const j = await r.json()
    const g = j.results?.[0]
    return g ? { name: g.name as string, lat: g.latitude as number, lon: g.longitude as number } : null
  } catch {
    return null
  }
}
