'use client';

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { BaseMap, baseLabels, baseBounds } from './base-map';

type Point = [number, number];
type View = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
export type MapRoad = {
  key: string; name: string; geometry: Point[]; approximate?: boolean;
  color: string; status: string; category: string;
};
type Landmark = { name: string; point: Point; kind: string };
export type TrafficMapHandle = { reset(): void; focus(geometry: Point[]): void };

const HOME: View = { x: 0, y: -2100, width: 8800, height: 6500 };
const project = ([lat, lon]: Point): Point => [(lon - 118.8) * 94300, (32.07 - lat) * 111320];
const mainRoads = new Set(['陵园路 · 步行道', '博爱路', '紫金山路', '灵谷寺路', '明陵路']);
const mainPlaces = new Set(['明孝陵', '中山陵', '灵谷寺']);

function homeView(size: Size): View {
  const width = Math.max(HOME.width, HOME.height * size.width / size.height) * 1.08;
  const height = width * size.height / size.width;
  return { x: HOME.x + HOME.width / 2 - width / 2, y: HOME.y + HOME.height / 2 - height / 2, width, height };
}

function path(points: Point[], tolerance: number) {
  // Retain endpoints and meaningful bends; reveal the full geometry on close-up.
  const kept: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = kept[kept.length - 1];
    if (Math.hypot(points[i][0] - previous[0], points[i][1] - previous[1]) > tolerance) kept.push(points[i]);
  }
  kept.push(points[points.length - 1]);
  return kept.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

export function TrafficMap({ roads, landmarks, selectedKey, onSelect, ref }: {
  roads: MapRoad[]; landmarks: Landmark[]; selectedKey?: string;
  onSelect(key: string): void; ref?: Ref<TrafficMapHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>({ width: 1000, height: 620 });
  const [view, setView] = useState<View>(() => homeView({ width: 1000, height: 620 }));
  const [ready, setReady] = useState(false);
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef({ distance: 0, road: '' });
  const factor = HOME.width / view.width;
  const level = factor < 1.45 ? 0 : factor < 2.6 ? 1 : 2;
  const unit = view.width / size.width;

  function update(next: View) {
    const clampCenter = (center: number, length: number, min: number, max: number) => length > max - min ? (min + max) / 2 : Math.max(min + length / 2, Math.min(max - length / 2, center));
    const cx = clampCenter(next.x + next.width / 2, next.width, baseBounds[0], baseBounds[2]);
    const cy = clampCenter(next.y + next.height / 2, next.height, baseBounds[1], baseBounds[3]);
    const bounded = { ...next, x: cx - next.width / 2, y: cy - next.height / 2 };
    viewRef.current = bounded;
    setView(bounded);
  }

  function zoomAt(amount: number, px: number, py: number) {
    const current = viewRef.current;
    const currentSize = sizeRef.current;
    const width = Math.max(HOME.width / 16, Math.min(HOME.width * 1.7, current.width / amount));
    const height = width * currentSize.height / currentSize.width;
    const fx = px / currentSize.width;
    const fy = py / currentSize.height;
    update({ width, height, x: current.x + fx * (current.width - width), y: current.y + fy * (current.height - height) });
  }

  useImperativeHandle(ref, () => ({
    reset() { update(homeView(sizeRef.current)); },
    focus(geometry) {
      const points = geometry.map(project);
      const xs = points.map(p => p[0]);
      const ys = points.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const currentSize = sizeRef.current;
      const width = Math.max(1400, (maxX - minX) * 1.6, (maxY - minY) * 1.6 * currentSize.width / currentSize.height);
      const height = width * currentSize.height / currentSize.width;
      update({ x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height });
    },
  }));

  useEffect(() => {
    setReady(true);
    let first = true;
    const observer = new ResizeObserver(([entry]) => {
      const nextSize = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (nextSize.width <= 0 || nextSize.height <= 0) return;
      sizeRef.current = nextSize;
      setSize(nextSize);
      const current = viewRef.current;
      if (first) { first = false; update(homeView(nextSize)); }
      else {
        const height = current.width * nextSize.height / nextSize.width;
        update({ ...current, height, y: current.y + (current.height - height) / 2 });
      }
    });
    if (root.current) observer.observe(root.current);
    const node = svg.current;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (!node) return;
      const rect = node.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.003), event.clientX - rect.left, event.clientY - rect.top);
    }
    node?.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); node?.removeEventListener('wheel', wheel); };
  }, []);

  const projected = useMemo(() => roads.map(road => ({ ...road, points: road.geometry.map(project) })), [roads]);
  const junctions = useMemo(() => {
    const nodes = new Map<string, { point: Point; names: Set<string> }>();
    roads.filter(r => !r.approximate).forEach(road => road.geometry.forEach(point => {
      const key = point.map(v => v.toFixed(5)).join(',');
      const node = nodes.get(key) ?? { point: project(point), names: new Set<string>() };
      node.names.add(road.name.replace(' · 其他路段', '').replace(' · 步行道', ''));
      nodes.set(key, node);
    }));
    return [...nodes.entries()].filter(([, node]) => node.names.size > 1).map(([key, node]) => ({ key, ...node }));
  }, [roads]);

  const labels = useMemo(() => {
    const candidates: { key: string; text: string; point: Point; kind: string; priority: number }[] = [];
    landmarks.filter(place => level > 0 || mainPlaces.has(place.name)).forEach(place => candidates.push({ key: place.name, text: place.name, point: project(place.point), kind: 'place', priority: mainPlaces.has(place.name) ? 0 : 2 }));
    const longest = new Map<string, typeof projected[number]>();
    projected.forEach(road => {
      const existing = longest.get(road.name);
      const length = (r: typeof road) => r.points.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]), 0);
      if (!existing || length(road) > length(existing)) longest.set(road.name, road);
    });
    longest.forEach(road => {
      if (level === 0 && !mainRoads.has(road.name)) return;
      candidates.push({ key: road.key, text: road.name.replace(' · 其他路段', ''), point: road.points[Math.floor(road.points.length / 2)], kind: 'road', priority: road.key === selectedKey ? -1 : 3 });
    });
    if (level === 2) junctions.forEach(node => candidates.push({ key: node.key, text: [...node.names].join(' / '), point: node.point, kind: 'junction', priority: 4 }));
    const trafficNames = new Set([...landmarks.map(p => p.name), ...roads.map(r => r.name.replace(/ · .*/, ''))]);
    baseLabels.filter(label => label.level <= level && !trafficNames.has(label.name)).forEach(label => candidates.push({
      key: `base-${label.kind}-${label.name}`, text: label.name, point: label.point as Point, kind: label.kind,
      priority: ['peak', 'water', 'area'].includes(label.kind) ? 2 : label.kind === 'station' ? 4 : 5,
    }));
    const placed: { x: number; y: number; width: number; height: number }[] = [];
    return candidates.sort((a, b) => a.priority - b.priority).flatMap(label => {
      const px = (label.point[0] - view.x) / unit;
      const py = (label.point[1] - view.y) / unit;
      const width = label.text.length * (label.kind === 'junction' ? 11 : 13) + 14;
      if (px < -20 || py < 115 || px > size.width + 20 || py > size.height - 60) return [];
      for (const dy of [-16, 20, -36, 40]) {
        const box = { x: px - width / 2, y: py + dy - 9, width, height: 21 };
        if (box.x < 6 || box.x + width > size.width - 6) continue;
        if (placed.some(other => box.x < other.x + other.width + 4 && box.x + width + 4 > other.x && box.y < other.y + other.height + 3 && box.y + box.height + 3 > other.y)) continue;
        placed.push(box);
        return [{ ...label, y: label.point[1] + dy * unit }];
      }
      return [];
    });
  }, [projected, roads, landmarks, level, junctions, selectedKey, view, size, unit]);

  return <div className="traffic-map" ref={root} data-testid="traffic-map" data-detail-level={level} data-ready={ready}>
    <svg ref={svg} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet" aria-label="钟山景区道路通行地图，可拖动和缩放" tabIndex={0}
      onKeyDown={event => {
        const current = viewRef.current;
        if (event.key === '+' || event.key === '=') zoomAt(1.6, size.width / 2, size.height / 2);
        else if (event.key === '-') zoomAt(1 / 1.6, size.width / 2, size.height / 2);
        else if (event.key.startsWith('Arrow')) {
          event.preventDefault();
          update({ ...current, x: current.x + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0) * current.width / 10, y: current.y + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0) * current.height / 10 });
        }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
        gesture.current = { distance: 0, road: (event.target as Element).closest('[data-road-key]')?.getAttribute('data-road-key') ?? '' };
      }}
      onPointerMove={event => {
        const old = pointers.current.get(event.pointerId);
        if (!old) return;
        const before = [...pointers.current.values()];
        pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
        const after = [...pointers.current.values()];
        gesture.current.distance += Math.hypot(event.clientX - old[0], event.clientY - old[1]);
        if (before.length === 2) {
          const oldDistance = Math.hypot(before[0][0] - before[1][0], before[0][1] - before[1][1]);
          const newDistance = Math.hypot(after[0][0] - after[1][0], after[0][1] - after[1][1]);
          const rect = event.currentTarget.getBoundingClientRect();
          if (oldDistance > 5) zoomAt(newDistance / oldDistance, (before[0][0] + before[1][0]) / 2 - rect.left, (before[0][1] + before[1][1]) / 2 - rect.top);
        }
        const current = viewRef.current;
        const divisor = before.length === 2 ? 2 : 1;
        update({ ...current, x: current.x - (event.clientX - old[0]) * current.width / sizeRef.current.width / divisor, y: current.y - (event.clientY - old[1]) * current.height / sizeRef.current.height / divisor });
      }}
      onPointerUp={event => {
        pointers.current.delete(event.pointerId);
        if (gesture.current.distance < 5 && gesture.current.road) onSelect(gesture.current.road);
        gesture.current.road = '';
      }}
      onPointerCancel={event => { pointers.current.delete(event.pointerId); gesture.current.road = ''; }}>
      <title>钟山景区道路通行地图</title>
      <desc>山林、水面和周边街道与管制道路随网页直接呈现，不依赖外部地图服务。放大后显示步道、建筑和路口。背景道路不代表允许通行，彩色虚线的线位仅供示意。</desc>
      <BaseMap level={level} />
      {projected.map(road => <g key={road.key} data-road-key={road.key} data-status={road.status}>
        <title>{`${road.name}：${road.status}${road.approximate ? '（线位仅示意）' : ''}`}</title>
        <path d={path(road.points, level === 0 ? 30 : level === 1 ? 10 : 0)} fill="none" stroke="#07111d" strokeWidth={level === 0 ? 7 : 10} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <path className="traffic-road" d={path(road.points, level === 0 ? 30 : level === 1 ? 10 : 0)} fill="none" stroke={road.color} strokeWidth={road.key === selectedKey ? 7 : level === 0 ? 3 : 4.5} strokeDasharray={road.approximate ? '7 8' : undefined} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path(road.points, 0)} fill="none" stroke="transparent" strokeWidth="18" vectorEffect="non-scaling-stroke" />
      </g>)}
      {level === 2 && junctions.map(node => <circle key={node.key} data-testid="junction-dot" cx={node.point[0]} cy={node.point[1]} r={3.5 * unit} fill="#ecf6fc" stroke="#07111d" strokeWidth={2 * unit} pointerEvents="none" />)}
      {labels.map(label => <g key={`${label.kind}-${label.key}`} pointerEvents="none" data-label-kind={label.kind}>
        {label.kind === 'place' && <circle cx={label.point[0]} cy={label.point[1]} r={4 * unit} fill="#ffcf73" stroke="#091522" strokeWidth={2 * unit} />}
        {label.kind === 'peak' && <path d={`M${label.point[0] - 4 * unit},${label.point[1] + 3 * unit} l${4 * unit},${-7 * unit} l${4 * unit},${7 * unit} Z`} fill="#c5dba6" />}
        {label.kind === 'station' && <rect x={label.point[0] - 4 * unit} y={label.point[1] - 4 * unit} width={8 * unit} height={8 * unit} rx={2 * unit} fill="#b7a1dc" />}
        <text x={label.point[0]} y={label.y} textAnchor="middle" dominantBaseline="central" fontSize={(label.kind === 'junction' ? 11 : 13) * unit} fontWeight={label.kind === 'place' ? 650 : 450} fill={label.kind === 'place' ? '#ffe0a3' : label.kind === 'water' ? '#9edaff' : ['peak', 'area'].includes(label.kind) ? '#c5dba6' : label.kind === 'junction' ? '#adc4d1' : label.kind === 'road' ? '#f0f4f6' : '#c0cfcd'} stroke="#203335" strokeWidth={4 * unit} paintOrder="stroke" strokeLinejoin="round">{label.text}</text>
      </g>)}
    </svg>
    <div className="map-level" aria-live="polite" data-testid="map-level">{['景区总览', '街道与步道', '建筑与路口'][level]}<span>{Math.max(1, factor).toFixed(1)}× · {['山林 / 水面 / 主干路', '支路 / 步道 / 地铁站', '建筑轮廓 / 台阶 / 路口'][level]}</span></div>
    <div className="map-compass" aria-hidden="true">↑<span>北</span></div>
    <div className="map-zoom-controls">
      <button type="button" aria-label="放大地图" onClick={() => zoomAt(1.6, size.width / 2, size.height / 2)}>+</button>
      <button type="button" aria-label="缩小地图" onClick={() => zoomAt(1 / 1.6, size.width / 2, size.height / 2)}>−</button>
    </div>
    <div className="map-scale"><span style={{ width: `${(unit > 7 ? 1000 : unit > 2 ? 200 : 100) / unit}px` }} />约 {unit > 7 ? '1 千米' : unit > 2 ? '200 米' : '100 米'}</div>
    <div className="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a><span>钟山及周边内置底图</span></div>
    <noscript><div className="map-no-script">当前为静态地图；启用 JavaScript 后可切换车型、缩放和拖动。</div></noscript>
  </div>;
}
