import { fmt } from "@/lib/format";

const W = 640;
const H = 220;
const M = { t: 16, r: 12, b: 28, l: 44 };

function escalaY(max: number, min = 0) {
  const span = max - min || 1;
  return (v: number) => M.t + (H - M.t - M.b) * (1 - (v - min) / span);
}

function marcas(max: number, min = 0, n = 4) {
  const paso = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + paso * i);
}

/** Barras verticales simples para una serie. */
export function Barras({ etiquetas, valores, unidad }: { etiquetas: string[]; valores: number[]; unidad: string }) {
  const max = Math.max(...valores, 0) * 1.1 || 1;
  const y = escalaY(max);
  const ancho = (W - M.l - M.r) / Math.max(valores.length, 1);
  const salto = Math.ceil(valores.length / 12);
  return (
    <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Consumo en ${unidad} por período`}>
      {marcas(max).map((m) => (
        <g key={m}>
          <line x1={M.l} x2={W - M.r} y1={y(m)} y2={y(m)} stroke="var(--acero-2)" />
          <text x={M.l - 6} y={y(m) + 4} textAnchor="end">
            {fmt(m)}
          </text>
        </g>
      ))}
      {valores.map((v, i) => (
        <g key={i}>
          <rect
            x={M.l + i * ancho + ancho * 0.15}
            width={ancho * 0.7}
            y={y(v)}
            height={Math.max(0, y(0) - y(v))}
            rx={2}
            fill="var(--tinta)"
          >
            <title>
              {etiquetas[i]}: {fmt(v)} {unidad}
            </title>
          </rect>
          {i % salto === 0 && (
            <text x={M.l + i * ancho + ancho / 2} y={H - 8} textAnchor="middle">
              {etiquetas[i]}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Línea de stock diario con el mínimo como referencia. */
export function LineaStock({
  serie,
  minimo,
  unidad,
}: {
  serie: { etiqueta: string; valor: number }[];
  minimo: number;
  unidad: string;
}) {
  const vals = serie.map((s) => s.valor);
  const max = Math.max(...vals, minimo, 0) * 1.1 || 1;
  const min = Math.min(...vals, 0);
  const y = escalaY(max, min);
  const paso = (W - M.l - M.r) / Math.max(serie.length - 1, 1);
  const x = (i: number) => M.l + i * paso;
  const d = serie.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.valor).toFixed(1)}`).join(" ");
  const area = serie.length ? `${d} L${x(serie.length - 1)},${y(Math.max(min, 0))} L${x(0)},${y(Math.max(min, 0))} Z` : "";
  const salto = Math.ceil(serie.length / 8);
  return (
    <svg className="grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stock diario en ${unidad}`}>
      {marcas(max, min).map((m) => (
        <g key={m}>
          <line x1={M.l} x2={W - M.r} y1={y(m)} y2={y(m)} stroke="var(--acero-2)" />
          <text x={M.l - 6} y={y(m) + 4} textAnchor="end">
            {fmt(m)}
          </text>
        </g>
      ))}
      <path d={area} fill="var(--albahaca)" opacity={0.12} />
      <path d={d} fill="none" stroke="var(--albahaca)" strokeWidth={2.5} strokeLinejoin="round" />
      {minimo > 0 && (
        <g>
          <line x1={M.l} x2={W - M.r} y1={y(minimo)} y2={y(minimo)} stroke="var(--tomate)" strokeDasharray="5 4" />
          <text x={W - M.r} y={y(minimo) - 5} textAnchor="end" style={{ fill: "var(--tomate)" }}>
            mínimo {fmt(minimo)} {unidad}
          </text>
        </g>
      )}
      {serie.map((s, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(s.valor)} r={6} fill="transparent">
            <title>
              {s.etiqueta}: {fmt(s.valor)} {unidad}
            </title>
          </circle>
          {i % salto === 0 && (
            <text x={x(i)} y={H - 8} textAnchor="middle">
              {s.etiqueta}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Mini barras en línea para tablas. */
export function MiniBarras({ valores }: { valores: number[] }) {
  const max = Math.max(...valores, 0) || 1;
  const w = 6;
  const g = 2;
  const h = 22;
  return (
    <svg width={valores.length * (w + g)} height={h} aria-hidden="true" style={{ display: "block" }}>
      {valores.map((v, i) => (
        <rect key={i} x={i * (w + g)} y={h - (v / max) * h} width={w} height={(v / max) * h} rx={1} fill="var(--tinta-2)" />
      ))}
    </svg>
  );
}
