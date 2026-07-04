import { Rect, Text, Group } from 'react-konva'
import { TOAST_FONT, type BgEnv } from './theme'
import { GlassPanel, PanelStroke } from './primitives'

export interface LcdToast {
  id: number
  app: string
  title: string
  body: string
  born: number  // epoch ms when it appeared (drives the slide-in)
  until: number // epoch ms when it expires
  total: number // display duration ms (for the countdown bar)
}
const TOAST_W = 540
const TOAST_H = 112
const TOAST_GAP = 14
const TOAST_IN_MS = 300
const TOAST_OUT_MS = 280

export function ToastCard({ t, index, bg, panelW }: { t: LcdToast; index: number; bg: BgEnv; panelW: number }) {
  const nowMs = Date.now()
  const remaining = Math.max(0, Math.min(1, (t.until - nowMs) / t.total))
  const hasBody = !!t.body
  // slide in from the right with ease-out, fade+drift out at end of life
  const tin = Math.min(1, (nowMs - t.born) / TOAST_IN_MS)
  const easeIn = 1 - Math.pow(1 - tin, 3)
  const tout = Math.min(1, Math.max(0, t.until - nowMs) / TOAST_OUT_MS)
  const opacity = easeIn * tout
  const dx = (1 - easeIn) * 90 + (1 - tout) * 50
  const ox = panelW - TOAST_W - 20 + dx
  const oy = 20 + index * (TOAST_H + TOAST_GAP)
  return (
    <Group x={ox} y={oy} opacity={opacity} listening={false}>
      {bg.el ? (
        <GlassPanel w={TOAST_W} h={TOAST_H} radius={26}
          blur={12} tint="rgba(5,7,12,0.55)" bg={bg} />
      ) : (
        <Rect width={TOAST_W} height={TOAST_H} cornerRadius={26}
          fill="rgba(5,7,12,0.88)" />
      )}
      <PanelStroke w={TOAST_W} h={TOAST_H} r={26} />
      <Rect x={8} y={14} width={4} height={TOAST_H - 28} cornerRadius={2}
        fill="#4de1ff" shadowColor="#4de1ff" shadowBlur={8} shadowOpacity={0.8} />
      <Text x={22} y={14} width={TOAST_W - 40} text={t.app.toUpperCase()}
        fontSize={17} fill="#4de1ff" fontFamily={TOAST_FONT} fontStyle="600"
        letterSpacing={1.5} wrap="none" ellipsis />
      <Text x={22} y={hasBody ? 38 : 46} width={TOAST_W - 40} text={t.title}
        fontSize={26} fill="#ffffff" fontFamily={TOAST_FONT} fontStyle="700"
        wrap="none" ellipsis />
      {hasBody && (
        <Text x={22} y={70} width={TOAST_W - 40} height={30} text={t.body}
          fontSize={20} fill="rgba(255,255,255,0.65)" fontFamily={TOAST_FONT}
          wrap="none" ellipsis />
      )}
      <Rect x={22} y={TOAST_H - 8} width={(TOAST_W - 44) * remaining} height={3}
        cornerRadius={1.5} fill="rgba(77,225,255,0.5)" />
    </Group>
  )
}
