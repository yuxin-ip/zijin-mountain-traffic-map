import { memo } from 'react';
import data from '@/app/data/basemap.json';

// The geometry is bundled with the site, including the first HTML render.
// No tile service, API key, geocoding request, or coordinate conversion service.
export const baseLabels = data.labels;
export const baseBounds = data.bounds;

const styles: Record<string, { fill?: string; stroke?: string; width?: number; dash?: string }> = {
  urban: { fill: '#303b46', stroke: '#3c4750', width: 0.5 },
  campus: { fill: '#37454a', stroke: '#536369', width: 0.6 },
  forest: { fill: '#204536' },
  park: { fill: '#2c5040', stroke: '#426650', width: 0.6 },
  grass: { fill: '#365a43' },
  pitch: { fill: '#3e634f', stroke: '#6c8b74', width: 0.6 },
  water: { fill: '#255778', stroke: '#407da1', width: 0.7 },
  parking: { fill: '#454c54', stroke: '#68717c', width: 0.6 },
  building: { fill: '#68737c', stroke: '#859098', width: 0.5 },
  stream: { stroke: '#3b7395', width: 1.3 },
  rail: { stroke: '#809198', width: 1.3, dash: '5 3' },
  subway: { stroke: '#7d768d', width: 1, dash: '4 5' },
  trail: { stroke: '#8da38a', width: 1, dash: '2 3' },
  steps: { stroke: '#bbc3ae', width: 2, dash: '1 2' },
  service: { stroke: '#6d7b7c', width: 1.2 },
  street: { stroke: '#87918d', width: 1.6 },
  major: { stroke: '#b1b19c', width: 2.5 },
};
const order = Object.keys(styles);
const layers = [...data.layers].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

export const BaseMap = memo(function BaseMap({ level, bounds }: { level: number; bounds: number[] }) {
  return <g data-testid="base-map" pointerEvents="none" aria-label="内置地理底图：山林、水面、街道、步道与建筑">
    <rect x={baseBounds[0]} y={baseBounds[1]} width={baseBounds[2] - baseBounds[0]} height={baseBounds[3] - baseBounds[1]} fill="#28373a" />
    {layers.filter(layer => layer.level <= level).map(layer => {
      const style = styles[layer.kind];
      const chunks = layer.chunks.filter(chunk => chunk.bounds[0] <= bounds[2] && chunk.bounds[2] >= bounds[0] && chunk.bounds[1] <= bounds[3] && chunk.bounds[3] >= bounds[1]);
      // Preserve complete polygons (including holes) while excluding offscreen cells.
      const d = chunks.map(chunk => chunk.d).join('');
      return <g key={`${layer.kind}-${layer.level}`} data-base-kind={layer.kind} data-feature-count={layer.count} data-rendered-count={chunks.reduce((n, c) => n + c.count, 0)}>
        {['major', 'street'].includes(layer.kind) && <path d={d} fill="none" stroke="#253331" strokeWidth={(style.width ?? 1) + 2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
        <path d={d} fill={style.fill ?? 'none'} stroke={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </g>;
    })}
  </g>;
});
