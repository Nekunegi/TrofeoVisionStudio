import { Rect, Text, Line, Circle, Shape } from 'react-konva'
import { type Widget } from '../types'
import { useWeather } from '../weather'
import {
  FONT_NUM, FONT_LABEL, LABEL_FILL, PANEL_FILL, GLASS_TINT,
  cardR, TOAST_FONT, type BgEnv,
} from './theme'
import { GlassPanel, PanelStroke } from './primitives'

// Weather -----------------------------------------------------------------
type WxKind = 'sun' | 'partsun' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

function wmoInfo(code: number): { kind: WxKind; label: string } {
  if (code === 0) return { kind: 'sun', label: '快晴' }
  if (code === 1) return { kind: 'partsun', label: '晴れ' }
  if (code === 2) return { kind: 'partsun', label: '晴れ時々くもり' }
  if (code === 3) return { kind: 'cloud', label: 'くもり' }
  if (code === 45 || code === 48) return { kind: 'fog', label: '霧' }
  if (code >= 51 && code <= 57) return { kind: 'drizzle', label: '霧雨' }
  if (code >= 61 && code <= 67) return { kind: 'rain', label: code >= 65 ? '大雨' : '雨' }
  if (code >= 71 && code <= 77) return { kind: 'snow', label: '雪' }
  if (code >= 80 && code <= 82) return { kind: 'rain', label: 'にわか雨' }
  if (code === 85 || code === 86) return { kind: 'snow', label: 'にわか雪' }
  if (code >= 95) return { kind: 'storm', label: '雷雨' }
  return { kind: 'cloud', label: '--' }
}

const SUN_FILL = '#ffd76a'
const CLOUD_FILL = 'rgba(233,239,250,0.92)'

/** Vector weather glyph drawn into an s×s box at (x, y). */
function WeatherIcon({ kind, x, y, size: s }: { kind: WxKind; x: number; y: number; size: number }) {
  const sun = (sx: number, sy: number, r: number) => (
    <>
      <Circle x={sx} y={sy} radius={r} fill={SUN_FILL}
        shadowColor={SUN_FILL} shadowBlur={r * 0.9} shadowOpacity={0.8} />
      {[...Array(8)].map((_, i) => {
        const a = (Math.PI / 4) * i
        return <Line key={i} lineCap="round" stroke={SUN_FILL}
          strokeWidth={Math.max(2, r * 0.18)}
          points={[sx + Math.cos(a) * r * 1.5, sy + Math.sin(a) * r * 1.5,
            sx + Math.cos(a) * r * 1.9, sy + Math.sin(a) * r * 1.9]} />
      })}
    </>
  )
  // one path = a seamless union of circles even though the fill is translucent
  const cloud = (ox: number, oy: number, cs: number) => (
    <Shape listening={false} fill={CLOUD_FILL}
      sceneFunc={(ctx, sh) => {
        const c2 = ctx._context
        ctx.beginPath()
        c2.moveTo(ox + cs * 0.50, oy + cs * 0.66)
        c2.arc(ox + cs * 0.30, oy + cs * 0.66, cs * 0.20, 0, Math.PI * 2)
        c2.moveTo(ox + cs * 0.74, oy + cs * 0.47)
        c2.arc(ox + cs * 0.48, oy + cs * 0.47, cs * 0.26, 0, Math.PI * 2)
        c2.moveTo(ox + cs * 0.92, oy + cs * 0.62)
        c2.arc(ox + cs * 0.70, oy + cs * 0.62, cs * 0.22, 0, Math.PI * 2)
        c2.roundRect(ox + cs * 0.28, oy + cs * 0.60, cs * 0.44, cs * 0.26, cs * 0.08)
        ctx.fillStrokeShape(sh)
      }} />
  )
  const cx = x + s / 2
  switch (kind) {
    case 'sun':
      return sun(cx, y + s / 2, s * 0.30)
    case 'partsun':
      return <>{sun(x + s * 0.66, y + s * 0.30, s * 0.19)}{cloud(x, y + s * 0.04, s * 0.96)}</>
    case 'cloud':
      return cloud(x, y, s)
    case 'fog':
      return (
        <>
          {cloud(x, y - s * 0.12, s * 0.9)}
          {[0.66, 0.80, 0.94].map((f, i) => (
            <Line key={i} lineCap="round" stroke="rgba(200,215,235,0.7)" strokeWidth={s * 0.05}
              points={[x + s * (0.10 + i * 0.06), y + s * f, x + s * (0.74 + i * 0.06), y + s * f]} />
          ))}
        </>
      )
    case 'drizzle':
    case 'rain': {
      const drops = kind === 'rain' ? [0.24, 0.46, 0.68] : [0.30, 0.60]
      return (
        <>
          {cloud(x, y - s * 0.08, s * 0.95)}
          {drops.map((f, i) => (
            <Line key={i} lineCap="round" stroke="#6db7ff" strokeWidth={s * 0.06}
              points={[x + s * (f + 0.06), y + s * 0.74, x + s * f, y + s * 0.95]} />
          ))}
        </>
      )
    }
    case 'snow':
      return (
        <>
          {cloud(x, y - s * 0.08, s * 0.95)}
          {[0.26, 0.50, 0.74].map((f, i) => (
            <Circle key={i} x={x + s * f} y={y + s * (0.84 + (i % 2) * 0.08)}
              radius={s * 0.05} fill="#dceeff" />
          ))}
        </>
      )
    case 'storm':
      return (
        <>
          {cloud(x, y - s * 0.10, s * 0.95)}
          <Line lineCap="round" lineJoin="round" stroke={SUN_FILL} strokeWidth={s * 0.07}
            shadowColor={SUN_FILL} shadowBlur={s * 0.12} shadowOpacity={0.8}
            points={[cx + s * 0.08, y + s * 0.58, cx - s * 0.06, y + s * 0.78,
              cx + s * 0.04, y + s * 0.78, cx - s * 0.10, y + s * 1.0]} />
        </>
      )
  }
}

export function WeatherCard({ w, bg }: { w: Extract<Widget, { type: 'weather' }>; bg: BgEnv }) {
  const data = useWeather(w.lat, w.lon)
  const info = data ? wmoInfo(data.code) : null
  const W = w.width
  const H = w.height
  const r = cardR(H)
  const glass = (w.panelBlur ?? 0) > 0 && bg.el
  return (
    <>
      {glass ? (
        <GlassPanel w={W} h={H} radius={r} blur={w.panelBlur!} tint={GLASS_TINT} bg={bg} />
      ) : (
        <Rect width={W} height={H} cornerRadius={r} fill={PANEL_FILL} />
      )}
      <PanelStroke w={W} h={H} r={r} />
      <Text x={18} y={H * 0.09} width={W - 36} wrap="none" ellipsis
        text={(w.place || 'LOCATION').toUpperCase()} fontSize={H * 0.115}
        fill={LABEL_FILL} fontFamily={TOAST_FONT} fontStyle="600"
        letterSpacing={H * 0.012} />
      {!data && (
        <Text y={H * 0.46} width={W} align="center" text="天気を取得中…"
          fontSize={H * 0.13} fill={LABEL_FILL} fontFamily={TOAST_FONT} />
      )}
      {data && info && (
        <>
          <WeatherIcon kind={info.kind} x={H * 0.10} y={H * 0.32} size={H * 0.52} />
          <Text x={H * 0.72} y={H * 0.30} text={`${Math.round(data.temp)}°`}
            fontSize={H * 0.40} fill={w.color} fontFamily={FONT_NUM} fontStyle="700"
            shadowColor={w.color} shadowBlur={H * 0.05} shadowOpacity={0.4} />
          <Text x={H * 0.74} y={H * 0.78} text={info.label} fontSize={H * 0.13}
            fill="rgba(255,255,255,0.82)" fontFamily={TOAST_FONT} fontStyle="600" />
          <Text x={0} y={H * 0.34} width={W - 18} align="right"
            text={`H ${Math.round(data.hi)}°  L ${Math.round(data.lo)}°`}
            fontSize={H * 0.13} fill="rgba(255,255,255,0.85)"
            fontFamily={FONT_LABEL} fontStyle="600" />
          <Text x={0} y={H * 0.54} width={W - 18} align="right"
            text={`湿度 ${Math.round(data.humidity)}%`} fontSize={H * 0.115}
            fill={LABEL_FILL} fontFamily={TOAST_FONT} />
          <Text x={0} y={H * 0.72} width={W - 18} align="right"
            text={`風 ${Math.round(data.wind)} km/h`} fontSize={H * 0.115}
            fill={LABEL_FILL} fontFamily={TOAST_FONT} />
        </>
      )}
    </>
  )
}
