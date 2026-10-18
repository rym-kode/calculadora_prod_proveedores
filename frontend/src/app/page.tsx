"use client";

import Link from "next/link";
import BarraStock from "@/components/BarraStock";
import { AvisoError, Cargando } from "@/components/Mensaje";
import type { Alerta, Resumen } from "@/lib/api";
import { fmt, fmtCant, fmtFecha, fmtFechaLarga } from "@/lib/format";
import { useApi } from "@/lib/useApi";

function textoCobertura(dias: number | null) {
  if (dias == null) return null;
  if (dias < 1) return "No llega a mañana";
  if (dias < 1.5) return "Alcanza para ~1 día";
  return `Alcanza para ~${fmt(dias)} días`;
}

export default function Panel() {
  const alertas = useApi<Alerta[]>("/alertas/");
  const resumen = useApi<Resumen>("/resumen/");
  const r = resumen.data;
  const lista = alertas.data ?? [];

  return (
    <div className="pila">
      <div className="encabezado">
        <div>
          <h1 className="titulo">{r ? fmtFechaLarga(r.fecha) : "Panel"}</h1>
          <p className="bajada">
            {r && !r.produccion_cargada_hoy
              ? "Todavía no cargaste las ventas de hoy."
              : r
                ? `Hoy: ${r.produccion_hoy.vendidos} porciones vendidas` +
                  (r.produccion_hoy.descartados ? ` y ${r.produccion_hoy.descartados} tiradas.` : ".")
                : " "}
          </p>
        </div>
        <div className="fila">
          <Link className="btn yema" href="/produccion">
            Cargar ventas del día
          </Link>
          <Link className="btn sec" href="/compras">
            Cargar compra
          </Link>
        </div>
      </div>

      <AvisoError texto={alertas.error ?? resumen.error} />

      <section className="lista-compras" aria-labelledby="t-lista">
        <header>
          <h2 id="t-lista">Para salir a comprar</h2>
          {lista.length > 0 && (
            <span className="tenue chico">
              Referencia: semana pasada, del {fmtFecha(lista[0].semana_pasada.desde)} al{" "}
              {fmtFecha(lista[0].semana_pasada.hasta)}
            </span>
          )}
        </header>
        {alertas.cargando && !alertas.data ? (
          <div style={{ padding: "0 1.25rem 1rem" }}>
            <Cargando />
          </div>
        ) : lista.length === 0 ? (
          <div className="vacio">
            <p>No falta nada: toda la mercadería está por encima de su mínimo.</p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {lista.map((a) => (
              <li key={a.ingrediente_id} className="item-compra">
                <div>
                  <Link href={`/mercaderia/${a.ingrediente_id}`} className="nombre" style={{ textDecoration: "none" }}>
                    {a.ingrediente}
                  </Link>
                  <div className="motivo">
                    <span className={`etiqueta ${a.nivel}`}>{a.nivel === "critico" ? "Urgente" : "Pronto"}</span>{" "}
                    {a.motivos[0]}
                  </div>
                </div>
                <div className="stock">
                  <div className="dato">
                    Quedan <b>{fmtCant(a.stock_actual, a.unidad)}</b>
                    {a.stock_minimo > 0 && <> de un mínimo de {fmtCant(a.stock_minimo, a.unidad)}</>}
                  </div>
                  <BarraStock stock={a.stock_actual} minimo={a.stock_minimo} nivel={a.nivel} />
                </div>
                <div className="semana dato">
                  Semana pasada se usaron <b>{fmtCant(a.consumo_semana_pasada, a.unidad)}</b>
                  {a.merma_semana_pasada > 0 && <> y se tiraron <b>{fmtCant(a.merma_semana_pasada, a.unidad)}</b></>}
                  {textoCobertura(a.dias_cobertura) && (
                    <>
                      <br />
                      {textoCobertura(a.dias_cobertura)}
                    </>
                  )}
                </div>
                <div className="comprar">
                  <span className="dato">Comprar</span>
                  <strong>{fmtCant(a.compra_sugerida, a.unidad)}</strong>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {r && (
        <div className="grilla-2">
          <section className="panel" aria-labelledby="t-ventas">
            <h2 id="t-ventas">Lo más vendido la semana pasada</h2>
            {r.ventas_semana_pasada.length === 0 ? (
              <p className="tenue">Sin ventas cargadas la semana pasada.</p>
            ) : (
              <div className="tabla-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Plato</th>
                      <th className="num">Vendidos</th>
                      <th className="num">Tirados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.ventas_semana_pasada.map((v) => (
                      <tr key={v.plato_id}>
                        <td>{v.plato}</td>
                        <td className="num">{v.vendidos}</td>
                        <td className="num">{v.descartados}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="chico" style={{ marginBottom: 0 }}>
              <Link href="/insights">Ver consumo y ventas por período</Link>
            </p>
          </section>
          <section className="panel" aria-labelledby="t-estado">
            <h2 id="t-estado">Estado</h2>
            <div className="cifras">
              <div className="cifra">
                <strong>{r.alertas_criticas}</strong>
                <span>urgentes</span>
              </div>
              <div className="cifra">
                <strong>{r.ingredientes_activos}</strong>
                <span>ingredientes</span>
              </div>
              <div className="cifra">
                <strong>{r.platos_activos}</strong>
                <span>platos</span>
              </div>
              <div className="cifra">
                <strong>{r.compras_ultimos_7_dias}</strong>
                <span>compras en 7 días</span>
              </div>
              <div className="cifra">
                <strong>{r.porciones_tiradas_semana_pasada}</strong>
                <span>
                  <Link href="/mermas">porciones tiradas</Link> la semana pasada
                </span>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
