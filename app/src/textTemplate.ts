// Sensor-variable substitution for the Text widget.
//
// Syntax: {cpu.temp}, {gpu.load:1}, {time}, {date}. Unknown placeholders pass
// through unchanged. Optional :N suffix sets decimal places (default: 0 for
// %/°C/MHz, 1 for W/MB/s). Missing sensor values render as "--".

import type { Sensors, SensorMetric } from './types'

const MAP: Record<string, SensorMetric> = {
  'cpu.temp': 'cpuTemp', 'cpu.load': 'cpuLoad',
  'cpu.power': 'cpuPower', 'cpu.clock': 'cpuClock',
  'gpu.temp': 'gpuTemp', 'gpu.load': 'gpuLoad', 'gpu.power': 'gpuPower',
  'ram.load': 'ramLoad',
  'net.up': 'netUp', 'net.down': 'netDown',
  'disk.load': 'diskLoad',
}

// Matches {word.word}, {word.word:N}, {time}, {time:N}, {date}, {date:...}.
const RE = /\{([a-z]+(?:\.[a-z]+)?)(?::([0-9a-z]+))?\}/gi

function pad2(n: number) { return String(n).padStart(2, '0') }

function isFatDecimalMetric(m: SensorMetric): boolean {
  return m === 'cpuPower' || m === 'gpuPower' || m === 'netUp' || m === 'netDown'
}

export function substituteTemplate(text: string, sensors: Sensors, now: Date): string {
  if (!text || text.indexOf('{') < 0) return text
  return text.replace(RE, (whole, key: string, spec: string | undefined) => {
    const k = key.toLowerCase()
    if (k === 'time') {
      // {time} → HH:mm:ss; {time:hm} → HH:mm (any spec starting with 'h' + not 's')
      const hm = spec && /^hm$/i.test(spec)
      return hm
        ? `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
        : `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
    }
    if (k === 'date') {
      return now.toLocaleDateString('en-US',
        { weekday: 'short', month: 'short', day: 'numeric' })
    }
    const metric = MAP[k]
    if (!metric) return whole
    const v = sensors[metric]
    if (v == null) return '--'
    const decimals = spec && /^\d+$/.test(spec)
      ? Math.min(4, parseInt(spec, 10))
      : isFatDecimalMetric(metric) ? 1 : 0
    return v.toFixed(decimals)
  })
}

// Placeholder list surfaced in the editor's Text properties panel.
export const TEMPLATE_HINTS = [
  '{cpu.temp}', '{cpu.load}', '{cpu.power}', '{cpu.clock}',
  '{gpu.temp}', '{gpu.load}', '{gpu.power}',
  '{ram.load}', '{net.up}', '{net.down}', '{disk.load}',
  '{time}', '{time:hm}', '{date}',
] as const
