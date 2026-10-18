"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { LineaStock } from "@/components/Graficos";
import { AvisoError, Cargando } from "@/components/Mensaje";
import type { Historial, Ingrediente } from "@/lib/api";
import { fmt, fmtCant, fmtFecha, isoLocal, sumarDias } from "@/lib/format";
import { useApi } from "@/lib/useApi";

const RANGOS = [
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
  { dias: 90, texto: "90 días" },
];

export default function DetalleIngrediente() {
  const { id } = useParams<{ id: string }>();
  const [dias, setDias] = useState(30);
  const hasta = isoLocal();
  const desde = sumarDias(hasta, -(dias - 1));
  const ing = useApi<Ingrediente>(`/ingredientes/${id}/`);
  const hist = useApi<Historial>(`/ingredientes/${id}/historial/?desde=${desde}&hasta=${hasta}`);

  const i = ing.data;
  const h = hist.data;
  const consumido = h?.movimientos.filter((m) => m.tipo === "produccion").reduce((t, m) => t - m.cantidad, 0) ?? 0;
  const comprado = h?.movimientos.filter((m) => m.tipo === "compra").reduce((t, m) => t + m.cantidad, 0) ?? 0;
  const tirado = h?.movimientos.filter((m) => m.tipo === "merma").reduce((t, m) => t - m.cantidad, 0) ?? 0;

  return (
    <div className="pila">
      <p className="chico" style={{ margin: 0 }}>
        <Link href="/mercaderia">Mercadería</Link>
      </p>
      <AvisoError texto={ing.error ?? hist.error} />
      {!i ? (
        <Cargando />
      ) : (
        <>
          <div className="encabezado">
            <div>
              <h1 className="titulo">{i.nombre}</h1>
              <p className="bajada">
                Hay {fmtCant(i.stock_actual, i.unidad_simbolo)}
                {i.stock_minimo > 0 && `; el mínimo es ${fmtCant(i.stock_minimo, i.unidad_simbolo)}`}.
              </p>
            </div>
            <div className="segmentado" role="group" aria-label="Período">
              {RANGOS.map((r) => (
                <button key={r.dias} type="button" aria-pressed={dias === r.dias} onClick={() => setDias(r.dias)}>
                  {r.texto}
                </button>
              ))}
            </div>
          </div>

          <section className="panel">
            <div className="cifras" style={{ marginBottom: "1rem" }}>
              <div className="cifra">
                <strong>{fmtCant(consumido, i.unidad_simbolo)}</strong>
                <span>usado en {dias} días</span>
              </div>
              <div className="cifra">
                <strong>{fmtCant((consumido / dias) * 7, i.unidad_simbolo)}</strong>
                <span>promedio por semana</span>
              </div>
              <div className="cifra">
                <strong>{fmtCant(comprado, i.unidad_simbolo)}</strong>
                <span>comprado</span>
              </div>
              <div className="cifra">
                <strong>{fmtCant(tirado, i.unidad_simbolo)}</strong>
                <span>tirado sin usar</span>
              </div>
            </div>
            {h ? (
              <LineaStock
                serie={h.serie.map((p) => ({ etiqueta: fmtFecha(p.fecha), valor: p.stock }))}
                minimo={i.stock_minimo}
                unidad={i.unidad_simbolo}
              />
            ) : (
              <Cargando />
            )}
          </section>

          <section className="panel">
            <h2>Movimientos</h2>
            {!h?.movimientos.length ? (
              <p className="tenue">Sin movimientos en este período.</p>
            ) : (
              <div className="tabla-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Detalle</th>
                      <th className="num">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.movimientos.map((m) => (
                      <tr key={m.id}>
                        <td>{fmtFecha(m.fecha)}</td>
                        <td>
                          <span
                            className={`etiqueta ${
                              m.tipo === "compra" ? "ok" : m.tipo === "merma" ? "merma" : m.tipo === "ajuste" ? "bajo" : "neutra"
                            }`}
                          >
                            {m.tipo_display}
                          </span>
                        </td>
                        <td className="tenue">{m.nota}</td>
                        <td className="num">
                          {m.cantidad > 0 ? "+" : ""}
                          {fmt(m.cantidad)} {i.unidad_simbolo}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
