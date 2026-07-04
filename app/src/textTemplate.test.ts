import { describe, it, expect } from 'vitest'
import { substituteTemplate } from './textTemplate'
import { EMPTY_SENSORS, type Sensors } from './types'

const SENSORS: Sensors = {
  cpuTemp: 52, cpuLoad: 34, cpuPower: 78.4, cpuClock: 4750,
  gpuTemp: 63, gpuLoad: 78, gpuPower: 210.5,
  ramLoad: 45,
  netUp: 0.42, netDown: 2.11,
  diskLoad: 8,
}
const NOW = new Date(2026, 6, 5, 14, 30, 45) // 2026-07-05 14:30:45

describe('substituteTemplate', () => {
  it('passes plain text through untouched', () => {
    expect(substituteTemplate('hello world', SENSORS, NOW)).toBe('hello world')
  })

  it('substitutes CPU / GPU / RAM values with the metric-specific default decimals', () => {
    // temp / load / clock default to 0 decimals; power / net rates default to 1
    expect(substituteTemplate('{cpu.temp}', SENSORS, NOW)).toBe('52')
    expect(substituteTemplate('{cpu.load}', SENSORS, NOW)).toBe('34')
    expect(substituteTemplate('{cpu.power}', SENSORS, NOW)).toBe('78.4')
    expect(substituteTemplate('{cpu.clock}', SENSORS, NOW)).toBe('4750')
    expect(substituteTemplate('{gpu.temp}', SENSORS, NOW)).toBe('63')
    expect(substituteTemplate('{gpu.power}', SENSORS, NOW)).toBe('210.5')
    expect(substituteTemplate('{ram.load}', SENSORS, NOW)).toBe('45')
    expect(substituteTemplate('{net.up}', SENSORS, NOW)).toBe('0.4')
    expect(substituteTemplate('{net.down}', SENSORS, NOW)).toBe('2.1')
    expect(substituteTemplate('{disk.load}', SENSORS, NOW)).toBe('8')
  })

  it('honors :N to override decimals', () => {
    expect(substituteTemplate('{cpu.temp:1}', SENSORS, NOW)).toBe('52.0')
    expect(substituteTemplate('{cpu.power:0}', SENSORS, NOW)).toBe('78')
    expect(substituteTemplate('{net.down:3}', SENSORS, NOW)).toBe('2.110')
  })

  it('renders missing sensor values as --', () => {
    expect(substituteTemplate('{cpu.temp}°C', EMPTY_SENSORS, NOW)).toBe('--°C')
  })

  it('resolves {time} as HH:mm:ss and {time:hm} as HH:mm', () => {
    expect(substituteTemplate('{time}', SENSORS, NOW)).toBe('14:30:45')
    expect(substituteTemplate('{time:hm}', SENSORS, NOW)).toBe('14:30')
  })

  it('resolves {date} to a short localized weekday+month+day', () => {
    // e.g. "Sun, Jul 5" — the exact string is locale-dependent but must be
    // stable within one node/browser and include the numeric day.
    const s = substituteTemplate('{date}', SENSORS, NOW)
    expect(s).toMatch(/5/)
    expect(s.length).toBeGreaterThan(3)
  })

  it('passes unknown placeholders through as literal text', () => {
    expect(substituteTemplate('{unknown.thing}', SENSORS, NOW)).toBe('{unknown.thing}')
    expect(substituteTemplate('{foo}', SENSORS, NOW)).toBe('{foo}')
  })

  it('substitutes multiple placeholders in one string', () => {
    expect(substituteTemplate('CPU {cpu.temp}°C · GPU {gpu.load}%', SENSORS, NOW))
      .toBe('CPU 52°C · GPU 78%')
  })

  it('is a no-op when there is no opening brace', () => {
    expect(substituteTemplate('no placeholders', SENSORS, NOW)).toBe('no placeholders')
  })
})
