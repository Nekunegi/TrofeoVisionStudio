// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

afterEach(cleanup)
import { LayerPanel } from './LayerPanel'
import type { Widget } from '../types'

const widgets: Widget[] = [
  { id: 'bar-1', type: 'bar', metric: 'cpuLoad', x: 0, y: 0, width: 300, height: 40, max: 100, color: '#fff', label: 'CPU BAR' },
  { id: 'clock-1', type: 'clock', x: 0, y: 0, withDate: false, fontSize: 40, color: '#fff', bold: false },
]

const noop = () => {}

describe('LayerPanel', () => {
  it('lists widgets top-of-stack first (reverse of array order)', () => {
    render(
      <LayerPanel widgets={widgets} selectedId={null}
        onSelect={noop} onUpdate={noop} onDelete={noop} onReorder={noop} />,
    )
    const names = screen.getAllByRole('listitem').map((li) => li.textContent)
    // clock (array end = front) should be the first row
    expect(names[0]).toContain('Clock')
    expect(names[1]).toContain('CPU BAR')
  })

  it('select / delete / visibility wiring', () => {
    const onSelect = vi.fn()
    const onUpdate = vi.fn()
    const onDelete = vi.fn()
    render(
      <LayerPanel widgets={widgets} selectedId={null}
        onSelect={onSelect} onUpdate={onUpdate} onDelete={onDelete} onReorder={noop} />,
    )
    fireEvent.click(screen.getByText('CPU BAR'))
    expect(onSelect).toHaveBeenCalledWith('bar-1')

    const rows = screen.getAllByRole('listitem')
    // Row buttons: [main, up, down, eye, lock, delete]
    const barButtons = rows[1].querySelectorAll('button')
    fireEvent.click(barButtons[3]) // eye toggle
    expect(onUpdate).toHaveBeenCalledWith('bar-1', { hidden: true })
    fireEvent.click(barButtons[5]) // trash
    expect(onDelete).toHaveBeenCalledWith('bar-1')
  })

  it('reorder arrows report the correct direction', () => {
    const onReorder = vi.fn()
    render(
      <LayerPanel widgets={widgets} selectedId={null}
        onSelect={noop} onUpdate={noop} onDelete={noop} onReorder={onReorder} />,
    )
    const rows = screen.getAllByRole('listitem')
    const clockButtons = rows[0].querySelectorAll('button')
    fireEvent.click(clockButtons[1]) // up arrow
    expect(onReorder).toHaveBeenCalledWith('clock-1', 'up')
    fireEvent.click(clockButtons[2]) // down arrow
    expect(onReorder).toHaveBeenCalledWith('clock-1', 'down')
  })
})
