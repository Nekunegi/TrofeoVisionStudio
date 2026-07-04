import type { useBackend } from '../useBackend'

export function SensorReadout({ backend }: { backend: ReturnType<typeof useBackend> }) {
  const s = backend.sensors
  const cell = (label: string, v: number | null, u: string) => (
    <div className="scell">
      <span>{label}</span>
      <b>{v == null ? '--' : v.toFixed(u === 'MB/s' ? 1 : 0)}<i>{u}</i></b>
    </div>
  )
  return (
    <div className="readout">
      {cell('CPU temp', s.cpuTemp, '°C')}
      {cell('CPU load', s.cpuLoad, '%')}
      {cell('CPU power', s.cpuPower, 'W')}
      {cell('GPU temp', s.gpuTemp, '°C')}
      {cell('GPU load', s.gpuLoad, '%')}
      {cell('GPU power', s.gpuPower, 'W')}
      {cell('RAM', s.ramLoad, '%')}
      {cell('NET up', s.netUp, 'MB/s')}
      {cell('NET down', s.netDown, 'MB/s')}
      {cell('Disk', s.diskLoad, '%')}
      {backend.device !== 'connected' && backend.deviceDetail &&
        <div className="scell err">{backend.deviceDetail}</div>}
    </div>
  )
}
