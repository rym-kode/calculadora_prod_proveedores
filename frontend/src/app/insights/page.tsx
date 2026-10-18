"use client";

import { useMemo, useState } from "react";
import { Barras, MiniBarras } from "@/components/Graficos";
import { AvisoError, Cargando } from "@/components/Mensaje";
import type { Consumo, VentaPlato } from "@/lib/api";
import { desdeIso, fmt, fmtCant, fmtFecha, isoLocal } from "@/lib/format";
import { presets, type Agrupar } from "@/lib/periodos";
import { useApi } from "@/lib/useApi";

const etiquetaPeriodo = (p: string, agrupar: Agrupar) => {
  if (agrupar === "mes") return new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit" }).format(desdeIso(p));
  if (agrupar === "semana") return `sem. ${fmtFecha(p)}`;
  return new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric" }).format(desdeIso(p));
};

export default function Insights() {
  const hoy = isoLocal();
  const opciones = useMemo(() => presets(hoy), [hoy]);
  const [preset, setPreset] = useState("4s");
  const [desde, setDesde] = useState(opciones[2].desde);
  const [hasta, setHasta] = useState(opciones[2].hasta);
  const [agrupar, setAgrupar] = useState<Agrupar>("semana");
  const [elegido, setElegido] = useState<number | null>(null);

  const rangoValido = desde && hasta && desde <= hasta;
  const qs = `desde=${desde}&hasta=${hasta}`;
  const consumo = useApi<Consumo>(rangoValido ? `/insights/consumo/?${qs}&agrupar=${agrupar}` : null);
  const ventas = useApi<{ platos: VentaPlato[] }>(rangoValido ? `/insights/ventas/?${qs}` : null);

  function elegirPreset(id: string) {
    const p = opciones.find((o) => o.id === id)!;
    setPreset(id);
    setDesde(p.desde);
    setHasta(p.hasta);
    setAgrupar(p.agrupar);
  }

  const c = consumo.data;
  const series = c?.series ?? [];
  const serieElegida = series.find((s) => s.ingrediente_id === elegido) ?? series[0];
  const etiquetas = c ? c.periodos.map((p) => etiquetaPeriodo(p, c.agrupar)) : [];
  const totalVentas = ventas.data?.platos.reduce(
    (t, v) => ({ vendidos: t.vendidos + v.vendidos, descartados: t.descartados + v.descartados }),
    { vendidos: 0, descartados: 0 },
  );

  return (
    <div className="pila">
      <div>
        <h1 className="titulo">Consumo</h1>
        <p className="bajada">Cuánta mercadería se usó en lo vendido y lo tirado, y cuánto se vendió de cada plato, en el período que elijas.</p>
      </div>

      <div className="fila">
        <div className="segmentado" role="group" aria-label="Período">
          {opciones.map((o) => (
            <button key={o.id} type="button" aria-pressed={preset === o.id} onClick={() => elegirPreset(o.id)}>
              {o.texto}
            </button>
          ))}
        </div>
        <label className="campo">
          Desde
          <input type="date" value={desde} max={hasta} onChange={(e) => { setDesde(e.target.value); setPreset(""); }} />
        </label>
        <label className="campo">
          Hasta
          <input type="date" value={hasta} min={desde} onChange={(e) => { setHasta(e.target.value); setPreset(""); }} />
        </label>
        <label className="campo">
          Agrupar por
          <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </select>
        </label>
      </div>

      {!rangoValido && <AvisoError texto="Elegí un rango válido: la fecha desde tiene que ser anterior a la fecha hasta." />}
      <AvisoError texto={consumo.error ?? ventas.error} />

      <section className="panel" aria-labelledby="t-consumo">
        <h2 id="t-consumo">Mercadería usada</h2>
        {consumo.cargando && !c ? (
          <Cargando />
        ) : series.length === 0 ? (
          <p className="tenue">No hay producción cargada en este período.</p>
        ) : (
          <div className="grilla-2">
            <div className="tabla-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Total</th>
                    <th className="num">Por semana</th>
                    <th>Evolución</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr
                      key={s.ingrediente_id}
                      className="clic"
                      onClick={() => setElegido(s.ingrediente_id)}
                      aria-selected={serieElegida?.ingrediente_id === s.ingrediente_id}
                      style={serieElegida?.ingrediente_id === s.ingrediente_id ? { background: "var(--yema-suave)" } : undefined}
                    >
                      <td>
                        <button
                          type="button"
                          onClick={() => setElegido(s.ingrediente_id)}
                          style={{ all: "unset", cursor: "pointer", fontWeight: 600 }}
                        >
                          {s.ingrediente}
                        </button>
                      </td>
                      <td className="num">{fmtCant(s.total, s.unidad)}</td>
                      <td className="num">{fmtCant(s.promedio_semanal, s.unidad)}</td>
                      <td>
                        <MiniBarras valores={s.valores} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {serieElegida && (
              <div>
                <h3>{serieElegida.ingrediente}</h3>
                <p className="chico tenue" style={{ marginTop: 0 }}>
                  {fmtCant(serieElegida.total, serieElegida.unidad)} en total, {fmt(serieElegida.promedio_diario)}{" "}
                  {serieElegida.unidad} por día en promedio.
                </p>
                <Barras etiquetas={etiquetas} valores={serieElegida.valores} unidad={serieElegida.unidad} />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="t-ventas">
        <h2 id="t-ventas">Platos</h2>
        {ventas.cargando && !ventas.data ? (
          <Cargando />
        ) : !ventas.data?.platos.length ? (
          <p className="tenue">No hay platos cargados en este período.</p>
        ) : (
          <div className="tabla-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plato</th>
                  <th className="num">Vendidos</th>
                  <th className="num">Tirados</th>
                  <th className="num">Se tiró</th>
                </tr>
              </thead>
              <tbody>
                {ventas.data.platos.map((v) => (
                  <tr key={v.plato_id}>
                    <td>{v.plato}</td>
                    <td className="num">{v.vendidos}</td>
                    <td className="num">{v.descartados}</td>
                    <td className="num">{v.porcentaje_descartado == null ? "—" : `${fmt(v.porcentaje_descartado)} %`}</td>
                  </tr>
                ))}
              </tbody>
              {totalVentas && (
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th className="num">{totalVentas.vendidos}</th>
                    <th className="num">{totalVentas.descartados}</th>
                    <th className="num">
                      {totalVentas.vendidos + totalVentas.descartados
                        ? `${fmt((totalVentas.descartados / (totalVentas.vendidos + totalVentas.descartados)) * 100)} %`
                        : "—"}
                    </th>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
