// File/data-URL helpers for widget images.
import { PANEL_W, PANEL_H } from './types'

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.readAsDataURL(file)
  })
}

// Widget images live inside the layout (localStorage) — downscale to panel size
// so a camera photo can't blow the ~5MB quota and silently kill persistence.
export async function fileToWidgetImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const raw = await fileToDataUrl(file)
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = raw
  })
  const scale = Math.min(1, PANEL_W / img.width, PANEL_H / img.height)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  if (scale >= 1 && raw.length < 1024 * 1024) return { src: raw, w, h }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  // PNG keeps transparency (logos/stickers); still bounded by the panel size.
  return { src: c.toDataURL('image/png'), w, h }
}
