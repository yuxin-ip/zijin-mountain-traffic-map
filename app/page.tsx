'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import {
  Bike,
  CarFront,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  LocateFixed,
  MapPinned,
  Route,
  ShieldAlert,
} from 'lucide-react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import roadsData from '@/app/data/roads.json';

type TimeMode = 'weekday' | 'holiday' | 'offpeak';
type VehicleMode = 'ebike' | 'car' | 'reservedCar' | 'bike';
type AccessStatus = 'blocked' | 'exclusive' | 'conditional' | 'open' | 'onsite';

type OverpassElement = {
  id: number;
  tags?: { name?: string };
  geometry?: Array<{ lat: number; lon: number }>;
};

type RoadFeature = {
  key: string;
  name: string;
  detail?: string;
  category: 'pedestrian' | 'controlled' | 'reference';
  geometry: [number, number][];
  approximate?: boolean;
};

const OFFICIAL_NOTICE =
  'https://zschina.nanjing.gov.cn/zfxxgk/zfxxgkml/202509/t20250925_5657134.html';

const CONTROLLED_NAMES = new Set([
  '陵园路',
  '梅花谷路',
  '博爱路',
  '博爱东路',
  '博爱西路',
  '四方城西路',
  '紫金山路',
  '邮局路',
  '邮局东路',
  '邮局西路',
  '水榭路',
]);

const EBIKE_BAN_NAMES = new Set([
  '陵园路',
  '博爱路',
  '博爱西路',
  '四方城西路',
  '紫金山路',
  '邮局路',
  '灵谷寺西路',
  '水榭路',
]);

const STATUS_META: Record<
  AccessStatus,
  { label: string; short: string; color: string; halo: string; text: string }
> = {
  blocked: {
    label: '禁止通行',
    short: '禁行',
    color: '#ff5a64',
    halo: '#4b1720',
    text: 'text-[#ff7b82]',
  },
  exclusive: {
    label: '可通行 · 机动车受限',
    short: '电动车可进',
    color: '#35e5be',
    halo: '#0e4f45',
    text: 'text-[#55e7c6]',
  },
  conditional: {
    label: '按预约路线通行',
    short: '预约通行',
    color: '#ffbf47',
    halo: '#5b3a0b',
    text: 'text-[#ffc766]',
  },
  open: {
    label: '通告未作特别限制',
    short: '可通行',
    color: '#5fc8ff',
    halo: '#123c59',
    text: 'text-[#7dd1ff]',
  },
  onsite: {
    label: '按现场标志通行',
    short: '现场为准',
    color: '#aeb8c8',
    halo: '#2a3341',
    text: 'text-slate-300',
  },
};

const TIME_OPTIONS: Array<{ value: TimeMode; label: string; time: string }> = [
  { value: 'weekday', label: '工作日', time: '09:00–17:00' },
  { value: 'holiday', label: '双休 / 节假日', time: '08:30–17:30' },
  { value: 'offpeak', label: '管控时段外', time: '看现场标志' },
];

const VEHICLE_OPTIONS: Array<{
  value: VehicleMode;
  label: string;
  icon: typeof Bike;
}> = [
  { value: 'ebike', label: '电动自行车', icon: Bike },
  { value: 'car', label: '机动车 · 无预约', icon: CarFront },
  { value: 'reservedCar', label: '机动车 · 已预约', icon: CarFront },
  { value: 'bike', label: '普通自行车', icon: Bike },
];

function isControlled(element: OverpassElement) {
  const name = element.tags?.name ?? '';
  if (CONTROLLED_NAMES.has(name)) return true;
  if (name === '紫金山东路') return element.id === 299101582;
  if (name === '灵谷寺路') return element.id !== 310073318;
  return false;
}

function buildFeatures(): RoadFeature[] {
  const result: RoadFeature[] = [];

  (roadsData.elements as OverpassElement[]).forEach((element) => {
    const name = element.tags?.name;
    const geometry = element.geometry?.map(
      ({ lat, lon }) => [lat, lon] as [number, number],
    );
    if (!name || !geometry?.length) return;

    if (name === '陵园路' && element.id === 146635645) {
      result.push({
        key: `${element.id}-walk`,
        name: '陵园路 · 步行道',
        detail: '梅花谷路至四方城东路段',
        category: 'pedestrian',
        geometry: geometry.slice(0, 11),
      });
      result.push({
        key: `${element.id}-other`,
        name: '陵园路 · 其他路段',
        category: 'controlled',
        geometry: geometry.slice(10),
      });
      return;
    }

    const controlled = isControlled(element);
    const detail =
      name === '紫金山东路' && controlled
        ? '灵谷寺路至钟山体育运动公园北口段'
        : name === '紫金山东路'
          ? '通告列明的正常通行参考段'
          : name === '灵谷寺路' && controlled
            ? '南京体育学院西门转盘至紫金山路段'
            : name === '灵谷寺路'
              ? '管控路段以南参考段'
              : undefined;

    result.push({
      key: String(element.id),
      name: name === '陵园路' ? '陵园路 · 其他路段' : name,
      detail,
      category: controlled ? 'controlled' : 'reference',
      geometry,
    });
  });

  result.push({
    key: 'linggusi-west-guide',
    name: '灵谷寺西路',
    detail: '开放地图暂无完整路名线位，虚线为相交道路间示意',
    category: 'controlled',
    approximate: true,
    geometry: [
      [32.043914, 118.851895],
      [32.0468, 118.8534],
      [32.0496, 118.8552],
      [32.052872, 118.85692],
    ],
  });

  return result;
}

const FEATURES = buildFeatures();

function getAccessStatus(
  feature: RoadFeature,
  time: TimeMode,
  vehicle: VehicleMode,
): AccessStatus {
  if (time === 'offpeak') return 'onsite';
  if (feature.category === 'pedestrian') return 'blocked';
  if (feature.category === 'reference') return 'open';

  if (vehicle === 'car') return 'blocked';
  if (vehicle === 'reservedCar') return 'conditional';
  if (vehicle === 'bike') return 'exclusive';

  const baseName = feature.name.split(' · ')[0];
  return EBIKE_BAN_NAMES.has(baseName) ? 'blocked' : 'exclusive';
}

function roadReason(feature: RoadFeature, status: AccessStatus, vehicle: VehicleMode) {
  if (feature.category === 'pedestrian') {
    return '步行道：节假日、双休日禁止所有车辆；工作日仅景区接驳车和残疾人机动轮椅车可通行。';
  }
  if (status === 'onsite') {
    return '正式通告未对管控时段外的一般车辆通行作出统一结论，请按现场标志及临时管控通行。';
  }
  if (status === 'open') {
    return '该路段不在当前所选车辆的专项禁行清单中；仍须服从现场动态交通管控。';
  }
  if (status === 'conditional') {
    return '预约车辆须凭通行凭证，沿指定路线进入指定停车场，并非获得景区内任意通行权。';
  }
  if (status === 'exclusive') {
    return vehicle === 'ebike'
      ? '通告对机动车限行，但未将本路段列入电动自行车禁行的 8 条道路。'
      : '普通自行车未列入该路段的专项禁行对象，应依法安全规范骑行。';
  }
  return vehicle === 'ebike'
    ? '该路段明确列入管控时段内电动自行车禁行清单。'
    : '该路段属于机动车管控道路；公交、预约、报备及景区接驳车辆按规定通行。';
}

function ControlLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
      {children}
    </p>
  );
}

export default function Home() {
  const [timeMode, setTimeMode] = useState<TimeMode>('weekday');
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>('ebike');
  const [selectedRoad, setSelectedRoad] = useState<RoadFeature | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);

  const activeTime = TIME_OPTIONS.find((option) => option.value === timeMode)!;
  const activeVehicle = VEHICLE_OPTIONS.find(
    (option) => option.value === vehicleMode,
  )!;

  const roadGroups = useMemo(() => {
    const groups = new Map<string, RoadFeature>();
    FEATURES.forEach((feature) => {
      const groupKey = `${feature.name}|${feature.detail ?? ''}`;
      if (!groups.has(groupKey)) groups.set(groupKey, feature);
    });
    return [...groups.values()]
      .map((feature) => ({
        feature,
        status: getAccessStatus(feature, timeMode, vehicleMode),
      }))
      .sort((a, b) => {
        const order: AccessStatus[] = [
          'exclusive',
          'conditional',
          'blocked',
          'open',
          'onsite',
        ];
        return order.indexOf(a.status) - order.indexOf(b.status);
      });
  }, [timeMode, vehicleMode]);

  const counts = useMemo(() => {
    return roadGroups.reduce(
      (acc, road) => {
        acc[road.status] += 1;
        return acc;
      },
      { blocked: 0, exclusive: 0, conditional: 0, open: 0, onsite: 0 },
    );
  }, [roadGroups]);

  useEffect(() => {
    let cancelled = false;

    void import('leaflet').then((L) => {
      if (cancelled || !mapNodeRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapNodeRef.current, {
        center: [32.0505, 118.8485],
        zoom: 14,
        minZoom: 13,
        maxZoom: 18,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.control
        .attribution({ position: 'bottomleft', prefix: false })
        .addAttribution('&copy; OpenStreetMap')
        .addTo(map);

      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layerGroup = layerRef.current;
    if (!L || !map || !layerGroup || !mapReady) return;

    layerGroup.clearLayers();
    FEATURES.forEach((feature) => {
      const status = getAccessStatus(feature, timeMode, vehicleMode);
      const meta = STATUS_META[status];

      L.polyline(feature.geometry, {
        color: meta.halo,
        weight: 11,
        opacity: 0.72,
        interactive: false,
      }).addTo(layerGroup);

      const roadLine = L.polyline(feature.geometry, {
        color: meta.color,
        weight: selectedRoad?.key === feature.key ? 7 : 5,
        opacity: feature.approximate ? 0.78 : 0.96,
        dashArray: feature.approximate ? '7 8' : undefined,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layerGroup);

      roadLine.bindTooltip(
        `<strong>${feature.name}</strong><br>${meta.label}${feature.approximate ? '<br><span>虚线为示意线位</span>' : ''}`,
        { sticky: true, className: 'road-tooltip' },
      );
      roadLine.on('click', () => setSelectedRoad(feature));
    });
  }, [mapReady, selectedRoad, timeMode, vehicleMode]);

  function focusRoad(feature: RoadFeature) {
    setSelectedRoad(feature);
    const L = leafletRef.current;
    if (!L || !mapRef.current) return;
    mapRef.current.fitBounds(L.latLngBounds(feature.geometry), {
      padding: [80, 80],
      maxZoom: 16,
    });
  }

  function resetMap() {
    mapRef.current?.setView([32.0505, 118.8485], 14);
    setSelectedRoad(null);
  }

  const selectedStatus = selectedRoad
    ? getAccessStatus(selectedRoad, timeMode, vehicleMode)
    : null;

  return (
    <main className="min-h-screen bg-[#07111d] text-slate-100">
      <header className="border-b border-white/10 bg-[#081522]/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#35e5be] text-[#07111d] shadow-[0_0_30px_rgba(53,229,190,.18)]">
              <MapPinned className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                钟山景区车辆通行图
              </h1>
              <p className="hidden text-xs text-slate-400 sm:block">
                2025-10-01 起实施 · 按车辆与时段查看
              </p>
            </div>
          </div>
          <a
            href={OFFICIAL_NOTICE}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
          >
            官方通告
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </header>

      <section className="border-b border-white/10 bg-[#0a1826] px-4 py-4 md:px-6">
        <div className="mx-auto grid max-w-[1680px] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] xl:items-end">
          <div>
            <ControlLabel>
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              选择时段
            </ControlLabel>
            <ToggleGroup
              value={[timeMode]}
              onValueChange={(value) => {
                const next = value[0] as TimeMode | undefined;
                if (next) setTimeMode(next);
              }}
              className="grid w-full grid-cols-3 gap-2"
            >
              {TIME_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="h-auto min-w-0 flex-col gap-0.5 rounded-xl border border-white/10 bg-white/[0.035] px-2 py-2.5 text-slate-300 data-pressed:border-[#35e5be]/50 data-pressed:bg-[#35e5be]/12 data-pressed:text-[#57edcb] sm:px-4"
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-[11px] font-normal text-slate-500 sm:text-xs">
                    {option.time}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div>
            <ControlLabel>
              <Route className="h-4 w-4" aria-hidden="true" />
              选择交通工具
            </ControlLabel>
            <ToggleGroup
              value={[vehicleMode]}
              onValueChange={(value) => {
                const next = value[0] as VehicleMode | undefined;
                if (next) setVehicleMode(next);
              }}
              className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {VEHICLE_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    className="h-11 min-w-0 gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-slate-300 data-pressed:border-[#5fc8ff]/50 data-pressed:bg-[#5fc8ff]/12 data-pressed:text-[#78d0ff]"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate text-sm">{option.label}</span>
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1680px] lg:h-[calc(100vh-180px)] lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_390px]">
        <section className="relative min-h-[56vh] overflow-hidden border-white/10 lg:min-h-0 lg:border-r">
          <div ref={mapNodeRef} className="absolute inset-0 bg-[#0b1623]" />

          <div className="pointer-events-none absolute left-3 top-3 z-[500] max-w-[calc(100%-24px)] rounded-2xl border border-white/10 bg-[#08131f]/92 p-3 shadow-2xl backdrop-blur md:left-5 md:top-5 md:p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm">
              {(vehicleMode === 'ebike' || vehicleMode === 'bike') &&
                timeMode !== 'offpeak' && (
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-7 rounded-full bg-[#35e5be] shadow-[0_0_10px_rgba(53,229,190,.45)]" />
                    <span>可骑入 · 机动车受限</span>
                  </div>
                )}
              {vehicleMode === 'reservedCar' && timeMode !== 'offpeak' && (
                <div className="flex items-center gap-2">
                  <span className="h-3 w-7 rounded-full bg-[#ffbf47]" />
                  <span>按预约路线通行</span>
                </div>
              )}
              {timeMode !== 'offpeak' && (
                <div className="flex items-center gap-2">
                  <span className="h-3 w-7 rounded-full bg-[#ff5a64]" />
                  <span>禁止通行</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className={`h-3 w-7 rounded-full ${timeMode === 'offpeak' ? 'bg-slate-400' : 'bg-[#5fc8ff]'}`} />
                <span>{timeMode === 'offpeak' ? '现场为准' : '未作特别限制'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={resetMap}
            className="absolute bottom-24 right-3 z-[500] grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-[#08131f]/92 text-slate-200 shadow-xl transition hover:bg-[#132638] lg:bottom-5 lg:right-14"
            aria-label="恢复地图全景"
          >
            <LocateFixed className="h-5 w-5" />
          </button>

          {selectedRoad && selectedStatus && (
            <div className="absolute bottom-3 left-3 right-3 z-[600] rounded-2xl border border-white/10 bg-[#08131f]/95 p-4 shadow-2xl backdrop-blur lg:bottom-5 lg:left-5 lg:right-auto lg:w-[420px]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className={`text-sm font-semibold ${STATUS_META[selectedStatus].text}`}>
                    {STATUS_META[selectedStatus].label}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">{selectedRoad.name}</h2>
                  {selectedRoad.detail && (
                    <p className="mt-0.5 text-xs text-slate-400">{selectedRoad.detail}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-white/10 hover:text-white"
                  onClick={() => setSelectedRoad(null)}
                >
                  关闭
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {roadReason(selectedRoad, selectedStatus, vehicleMode)}
              </p>
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col bg-[#091522]">
          <div className="border-b border-white/10 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-slate-400">当前查看</p>
                <h2 className="mt-1 text-lg font-semibold">
                  {activeVehicle.label} · {activeTime.label}
                </h2>
                <p className="mt-1 text-sm text-slate-400">{activeTime.time}</p>
              </div>
              <span className="rounded-full border border-[#35e5be]/20 bg-[#35e5be]/10 px-2.5 py-1 text-xs text-[#68ebcd]">
                已核对通告
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/8 bg-white/[0.035] p-3">
                <p className="text-xl font-semibold text-[#ff6e77]">{counts.blocked}</p>
                <p className="mt-0.5 text-xs text-slate-400">禁行道路</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.035] p-3">
                <p className="text-xl font-semibold text-[#4fe7c5]">
                  {counts.exclusive || counts.conditional}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {vehicleMode === 'reservedCar' ? '预约可进' : '差异路段'}
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.035] p-3">
                <p className="text-xl font-semibold text-[#76ceff]">
                  {counts.open || counts.onsite}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">其他参考</p>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 lg:px-4">
            <p className="px-2 pb-2 text-xs text-slate-500">点击道路定位并查看依据</p>
            <div className="space-y-1">
              {roadGroups.map(({ feature, status }) => {
                const meta = STATUS_META[status];
                return (
                  <button
                    key={`${feature.name}-${feature.detail ?? ''}`}
                    type="button"
                    onClick={() => focusRoad(feature)}
                    className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                      selectedRoad?.name === feature.name &&
                      selectedRoad?.detail === feature.detail
                        ? 'border-white/20 bg-white/[0.09]'
                        : 'border-transparent hover:border-white/10 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span
                      className="h-8 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">
                          {feature.name}
                        </span>
                        {feature.approximate && (
                          <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                            示意线位
                          </span>
                        )}
                      </span>
                      <span className={`mt-0.5 block text-xs ${meta.text}`}>
                        {meta.short}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-slate-300" />
                  </button>
                );
              })}
            </div>

            <div className="mx-2 my-5 rounded-2xl border border-[#ffbf47]/15 bg-[#ffbf47]/[0.06] p-4">
              <div className="flex gap-3">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc766]" />
                <div>
                  <h3 className="text-sm font-semibold text-[#ffd382]">动态管控优先</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    寒暑假客流高峰参照节假日规则。公安交管部门还可根据实时路况调整；现场标志和人员指挥优先于本图。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <footer className="border-t border-white/10 px-5 py-3 text-[11px] leading-5 text-slate-500">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                本图是出行辅助，不替代交警指挥。道路线位来自 OpenStreetMap；灵谷寺西路为示意线位。
              </p>
            </div>
          </footer>
        </aside>
      </div>
    </main>
  );
}
