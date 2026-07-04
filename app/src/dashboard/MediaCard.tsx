import { Rect, Text, Group, Line, Image as KImage, Shape } from 'react-konva'
import { type MediaState, type Widget } from '../types'
import {
  FONT_LABEL, LABEL_FILL, PANEL_FILL, GLASS_TINT,
  cardR, TOAST_FONT, useImage, withAlpha, type BgEnv,
} from './theme'
import { GlassPanel, PanelStroke } from './primitives'

// Now playing ---------------------------------------------------------------
/** Beamed eighth-note glyph (album-art placeholder). */
function MusicGlyph({ x, y, size: s, color }: { x: number; y: number; size: number; color: string }) {
  return (
    <Shape listening={false} fill={color}
      sceneFunc={(ctx, sh) => {
        const c2 = ctx._context
        ctx.beginPath()
        c2.ellipse(x + s * 0.20, y + s * 0.80, s * 0.13, s * 0.095, -0.3, 0, Math.PI * 2)
        c2.moveTo(x + s * 0.80, y + s * 0.72)
        c2.ellipse(x + s * 0.70, y + s * 0.72, s * 0.13, s * 0.095, -0.3, 0, Math.PI * 2)
        c2.rect(x + s * 0.28, y + s * 0.14, s * 0.05, s * 0.66)
        c2.rect(x + s * 0.78, y + s * 0.06, s * 0.05, s * 0.66)
        c2.moveTo(x + s * 0.28, y + s * 0.14)
        c2.lineTo(x + s * 0.83, y + s * 0.06)
        c2.lineTo(x + s * 0.83, y + s * 0.24)
        c2.lineTo(x + s * 0.28, y + s * 0.32)
        c2.closePath()
        ctx.fillStrokeShape(sh)
      }} />
  )
}

export function MediaCard({ w, media, bg, now }: {
  w: Extract<Widget, { type: 'media' }>
  media: MediaState | null
  bg: BgEnv
  now: Date
}) {
  const art = useImage(media?.thumb ?? null)
  const W = w.width
  const H = w.height
  const pad = Math.max(10, H * 0.09)
  const artS = H - pad * 2
  const glass = (w.panelBlur ?? 0) > 0 && bg.el
  const has = !!media?.hasMedia
  const tx = pad + artS + H * 0.12
  const tw = W - tx - pad
  let pos = 0
  if (media && has) {
    pos = media.pos + (media.playing ? (now.getTime() - media.receivedAt) / 1000 : 0)
    if (media.dur > 0) pos = Math.min(pos, media.dur)
  }
  const fmtT = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const barH = Math.max(4, H * 0.045)
  const barY = H - pad - barH
  const glyph = H * 0.10 // play/pause mark size
  const glyphY = barY - H * 0.06 - glyph
  const r = cardR(H)
  const artR = Math.max(8, Math.round(r * 0.62))
  return (
    <>
      {glass ? (
        <GlassPanel w={W} h={H} radius={r} blur={w.panelBlur!} tint={GLASS_TINT} bg={bg} />
      ) : (
        <Rect width={W} height={H} cornerRadius={r} fill={PANEL_FILL} />
      )}
      <PanelStroke w={W} h={H} r={r} />
      {/* album art (rounded clip), or a music-note placeholder */}
      <Group x={pad} y={pad}
        clipFunc={(c2) => { c2.beginPath(); c2.roundRect(0, 0, artS, artS, artR) }}>
        {art && has ? (
          <KImage image={art} width={artS} height={artS} />
        ) : (
          <>
            <Rect width={artS} height={artS} fill="rgba(255,255,255,0.07)" />
            <MusicGlyph x={artS * 0.24} y={artS * 0.22} size={artS * 0.54}
              color={withAlpha(w.color, 0.8)} />
          </>
        )}
      </Group>
      <Rect x={pad} y={pad} width={artS} height={artS} cornerRadius={artR}
        stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      {has && media ? (
        <>
          <Text x={tx} y={H * 0.14} width={tw} wrap="none" ellipsis
            text={media.title || '—'} fontSize={H * 0.185}
            fill="#ffffff" fontFamily={TOAST_FONT} fontStyle="700" />
          <Text x={tx} y={H * 0.40} width={tw} wrap="none" ellipsis
            text={media.artist} fontSize={H * 0.14}
            fill="rgba(255,255,255,0.65)" fontFamily={TOAST_FONT} fontStyle="500" />
          {media.playing ? (
            <Line points={[tx + 1, glyphY, tx + 1 + glyph * 0.95, glyphY + glyph / 2,
              tx + 1, glyphY + glyph]} closed fill={w.color}
              shadowColor={w.color} shadowBlur={5} shadowOpacity={0.6} />
          ) : (
            <>
              <Rect x={tx + 1} y={glyphY} width={glyph * 0.3} height={glyph} fill={w.color} />
              <Rect x={tx + 1 + glyph * 0.55} y={glyphY} width={glyph * 0.3} height={glyph}
                fill={w.color} />
            </>
          )}
          {media.dur > 0 && (
            <Text x={tx} y={glyphY - H * 0.01} width={tw} align="right"
              text={`${fmtT(pos)} / ${fmtT(media.dur)}`} fontSize={H * 0.115}
              fill="rgba(255,255,255,0.6)" fontFamily={FONT_LABEL} fontStyle="600" />
          )}
          <Rect x={tx} y={barY} width={tw} height={barH} cornerRadius={barH / 2}
            fill="rgba(255,255,255,0.14)" />
          {media.dur > 0 && (
            <Rect x={tx} y={barY} height={barH} cornerRadius={barH / 2}
              width={Math.max(barH, tw * Math.min(1, pos / media.dur))}
              fill={w.color} shadowColor={w.color} shadowBlur={6} shadowOpacity={0.6} />
          )}
        </>
      ) : (
        <Text x={tx} y={H / 2 - H * 0.09} text="NO MEDIA" fontSize={H * 0.16}
          fill={LABEL_FILL} fontFamily={FONT_LABEL} fontStyle="600"
          letterSpacing={H * 0.02} />
      )}
    </>
  )
}
