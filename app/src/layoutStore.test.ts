import { describe, it, expect, beforeEach } from 'vitest'
import { loadLayout, LS_KEY } from './layoutStore'
import { LAYOUT_VERSION, defaultLayout, type Layout } from './types'

describe('loadLayout', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the default when localStorage is empty', () => {
    expect(loadLayout()).toEqual(defaultLayout())
  })

  it('returns the default when the stored layout is malformed JSON', () => {
    localStorage.setItem(LS_KEY, 'not json')
    expect(loadLayout()).toEqual(defaultLayout())
  })

  it('returns a current-version layout unchanged', () => {
    const l = defaultLayout()
    localStorage.setItem(LS_KEY, JSON.stringify(l))
    expect(loadLayout()).toEqual(l)
  })

  it('migrates v4 to current, recentering the default clock (x=733 -> 775)', () => {
    const v4: Layout = {
      v: 4,
      bgColor: '#000',
      bgImage: null,
      widgets: [
        {
          id: 'clock', type: 'clock', withDate: false, x: 733, y: 26,
          fontSize: 64, color: '#fff', bold: false,
        },
        {
          id: 'other', type: 'text', text: 'hi', x: 100, y: 100,
          fontSize: 30, color: '#fff', bold: false,
        },
      ],
    }
    localStorage.setItem(LS_KEY, JSON.stringify(v4))
    const loaded = loadLayout()
    expect(loaded.v).toBe(LAYOUT_VERSION)
    const clock = loaded.widgets.find((w) => w.id === 'clock')
    expect(clock?.x).toBe(775)
    const other = loaded.widgets.find((w) => w.id === 'other')
    expect(other?.x).toBe(100)
  })

  it('leaves a customized v4 clock alone (only the default 733 is repositioned)', () => {
    const v4: Layout = {
      v: 4,
      bgColor: '#000',
      bgImage: null,
      widgets: [{
        id: 'clock', type: 'clock', withDate: false, x: 500, y: 26,
        fontSize: 64, color: '#fff', bold: false,
      }],
    }
    localStorage.setItem(LS_KEY, JSON.stringify(v4))
    expect(loadLayout().widgets[0]?.x).toBe(500)
  })

  it('discards a pre-v4 layout entirely', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 3, widgets: [] }))
    expect(loadLayout()).toEqual(defaultLayout())
  })
})
