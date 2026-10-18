"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AvisoError, AvisoOk, Cargando } from "@/components/Mensaje";
import {
  api,
  enviar,
  MOTIVOS_MERMA,
  type Ingrediente,
  type Merma,
  type MotivoMerma,
  type Paginado,
  type Plato,
  type RegistroProduccion,
  type ResumenMermas,
  type Unidad,
} from "@/lib/api";
import { fmt, fmtCant, fmtFecha, isoLocal, sumarDias } from "@/lib/format";
import { presets } from "@/lib/periodos";
import { useApi } from "@/lib/useApi";

type Tipo = "mercaderia" | "platos";

const LIMITE = 10;

type FormMercaderia = { fecha: string; ingrediente: string; cantidad: string; unidad: string; motivo: MotivoMerma; nota: string };
type FormPlato = { fecha: string; plato: string; porciones: string };

/** Un renglón del listado de últimas mermas, sea mercadería o platos. */
type Renglon =
  | { tipo: "mercaderia"; fecha: string; clave: string; merma: Merma }
  | { tipo: "platos"; fecha: string; clave: string; registro: RegistroProduccion };

export default function Mermas() {
  const hoy = isoLocal();
  const hace30 = sumarDias(hoy, -29);

  const ingredientes = useApi<Ingrediente[]>("/ingredientes/?activos=1");
  const unidades = useApi<Unidad[]>("/unidades/");
  const platos = useApi<Plato[]>("/platos/?activos=1");
  const mermas = useApi<Paginado<Merma>>(`/mermas/?desde=${hace30}`);
  const tirados = useApi<RegistroProduccion[]>(`/produccion/?desde=${hace30}&con_descartados=1`);

  const [tipo, setTipo] = useState<Tipo>("mercaderia");
  const [verTodo, setVerTodo] = useState(false);
  const [fm, setFm] = useState<FormMercaderia>({ fecha: hoy, ingrediente: "", cantidad: "", unidad: "", motivo: "mal_estado", nota: "" });
  const [fp, setFp] = useState<FormPlato>({ fecha: hoy, plato: "", porciones: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Resumen por período
  const opciones = useMemo(() => presets(hoy), [hoy]);
  const [preset, setPreset] = useState("4s");
  const periodo = opciones.find((o) => o.id === preset) ?? opciones[2];
  const resumen = useApi<ResumenMermas>(`/insights/mermas/?desde=${periodo.desde}&hasta=${periodo.hasta}`);

  const ing = (id: string) => ingredientes.data?.find((i) => String(i.id) === id);
  const unidadesPara = (id: string) => {
    const i = ing(id);
    return i ? (unidades.data ?? []).filter((u) => u.dimension === i.dimension) : [];
  };

  function recargarTodo() {
    mermas.recargar();
    tirados.recargar();
    resumen.recargar();
  }

  async function guardarMercaderia(e: React.FormEvent) {
    e.preventDefault();
    const i = ing(fm.ingrediente);
    if (!i || !fm.cantidad) {
      setError("Elegí el producto y la cantidad que se tiró.");
      return;
    }
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await enviar("/mermas/", "POST", {
        fecha: fm.fecha,
        ingrediente: i.id,
        cantidad: fm.cantidad,
        unidad: Number(fm.unidad),
        motivo: fm.motivo,
        nota: fm.nota,
      });
      const u = unidadesPara(fm.ingrediente).find((x) => String(x.id) === fm.unidad);
      setOk(`Merma guardada: ${fmt(Number(fm.cantidad))} ${u?.simbolo ?? ""} de ${i.nombre} descontados del stock.`);
      setFm({ ...fm, ingrediente: "", cantidad: "", unidad: "", nota: "" });
      recargarTodo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPlato(e: React.FormEvent) {
    e.preventDefault();
    const porciones = Math.floor(Number(fp.porciones));
    const plato = platos.data?.find((p) => String(p.id) === fp.plato);
    if (!plato || !(porciones > 0)) {
      setError("Elegí el plato y cuántas porciones se tiraron.");
      return;
    }
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      // Las porciones tiradas se guardan en el registro del día de ese plato.
      const delDia = await api<RegistroProduccion[]>(`/produccion/?fecha=${fp.fecha}`);
      const existente = delDia.find((r) => r.plato === plato.id);
      if (existente) {
        await enviar(`/produccion/${existente.id}/`, "PATCH", { descartados: existente.descartados + porciones });
      } else {
        await enviar("/produccion/", "POST", { fecha: fp.fecha, plato: plato.id, vendidos: 0, descartados: porciones });
      }
      const totalDia = (existente?.descartados ?? 0) + porciones;
      setOk(
        `Guardado: ${porciones} ${porciones === 1 ? "porción" : "porciones"} de ${plato.nombre} tiradas` +
          (existente?.descartados ? ` (${totalDia} en total ese día).` : "."),
      );
      setFp({ ...fp, plato: "", porciones: "" });
      recargarTodo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function borrarMerma(m: Merma) {
    if (!confirm(`¿Borrar la merma de ${m.ingrediente_nombre} del ${fmtFecha(m.fecha)}? Se va a devolver al stock.`)) return;
    try {
      await enviar(`/mermas/${m.id}/`, "DELETE");
      recargarTodo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar.");
    }
  }

  const renglones: Renglon[] = [
    ...(mermas.data?.results ?? []).map((m) => ({ tipo: "mercaderia" as const, fecha: m.fecha, clave: `m${m.id}`, merma: m })),
    ...(tirados.data ?? []).map((r) => ({ tipo: "platos" as const, fecha: r.fecha, clave: `p${r.id}`, registro: r })),
  ].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  const r = resumen.data;

  return (
    <div className="pila">
      <div>
        <h1 className="titulo">Mermas</h1>
        <p className="bajada">
          Todo lo que se tiró: mercadería que no llegó a usarse y porciones de platos preparados.
        </p>
      </div>

      <AvisoError texto={error ?? ingredientes.error ?? mermas.error} />
      <AvisoOk texto={ok} />

      <div className="grilla-2">
        <section className="panel" aria-labelledby="t-cargar">
          <h2 id="t-cargar">Cargar lo que se tiró</h2>
          <div className="segmentado" role="group" aria-label="Qué se tiró" style={{ marginBottom: "1rem" }}>
            <button type="button" aria-pressed={tipo === "mercaderia"} onClick={() => setTipo("mercaderia")}>
              Mercadería
            </button>
            <button type="button" aria-pressed={tipo === "platos"} onClick={() => setTipo("platos")}>
              Platos preparados
            </button>
          </div>

          {tipo === "mercaderia" ? (
            <form onSubmit={guardarMercaderia} className="pila" style={{ gap: "1rem" }}>
              <p className="chico tenue" style={{ margin: 0 }}>
                Producto que se tiró sin usar: vencido, en mal estado, se cayó. Se descuenta del stock.
              </p>
              <div className="fila">
                <label className="campo">
                  Fecha
                  <input type="date" value={fm.fecha} max={hoy} onChange={(e) => setFm({ ...fm, fecha: e.target.value })} required />
                </label>
                <label className="campo" style={{ flex: 1, minWidth: "10rem" }}>
                  Producto
                  <select
                    value={fm.ingrediente}
                    onChange={(e) =>
                      setFm({ ...fm, ingrediente: e.target.value, unidad: String(ing(e.target.value)?.unidad_preferida ?? "") })
                    }
                    required
                  >
                    <option value="">Elegir…</option>
                    {ingredientes.data?.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fila">
                <label className="campo">
                  Cantidad
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={fm.cantidad}
                    onChange={(e) => setFm({ ...fm, cantidad: e.target.value })}
                    required
                    style={{ width: "7rem" }}
                  />
                </label>
                <label className="campo">
                  Unidad
                  <select value={fm.unidad} onChange={(e) => setFm({ ...fm, unidad: e.target.value })} disabled={!fm.ingrediente}>
                    {unidadesPara(fm.ingrediente).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.simbolo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo" style={{ flex: 1, minWidth: "10rem" }}>
                  Motivo
                  <select value={fm.motivo} onChange={(e) => setFm({ ...fm, motivo: e.target.value as MotivoMerma })}>
                    {MOTIVOS_MERMA.map((m) => (
                      <option key={m.valor} value={m.valor}>
                        {m.texto}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {fm.ingrediente && (
                <p className="chico tenue" style={{ margin: 0 }}>
                  Hay {fmtCant(ing(fm.ingrediente)?.stock_actual, ing(fm.ingrediente)?.unidad_simbolo ?? "")} en stock.
                </p>
              )}
              <label className="campo">
                Detalle (opcional)
                <input value={fm.nota} onChange={(e) => setFm({ ...fm, nota: e.target.value })} placeholder="Ej.: llegaron golpeadas" />
              </label>
              <div className="fila" style={{ justifyContent: "flex-end" }}>
                <button className="btn yema" type="submit" disabled={guardando}>
                  {guardando ? "Guardando…" : "Guardar merma"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={guardarPlato} className="pila" style={{ gap: "1rem" }}>
              <p className="chico tenue" style={{ margin: 0 }}>
                Porciones preparadas que se tiraron. Se descuentan del stock los ingredientes de la receta y se suman a
                las tiradas de ese día en <Link href="/produccion">Ventas del día</Link>.
              </p>
              <div className="fila">
                <label className="campo">
                  Fecha
                  <input type="date" value={fp.fecha} max={hoy} onChange={(e) => setFp({ ...fp, fecha: e.target.value })} required />
                </label>
                <label className="campo" style={{ flex: 1, minWidth: "10rem" }}>
                  Plato
                  <select value={fp.plato} onChange={(e) => setFp({ ...fp, plato: e.target.value })} required>
                    <option value="">Elegir…</option>
                    {platos.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo">
                  Porciones
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={fp.porciones}
                    onChange={(e) => setFp({ ...fp, porciones: e.target.value })}
                    required
                    style={{ width: "6rem" }}
                  />
                </label>
              </div>
              <div className="fila" style={{ justifyContent: "flex-end" }}>
                <button className="btn yema" type="submit" disabled={guardando}>
                  {guardando ? "Guardando…" : "Guardar porciones tiradas"}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="panel" aria-labelledby="t-ultimas">
          <h2 id="t-ultimas">Últimos 30 días</h2>
          {(mermas.cargando && !mermas.data) || (tirados.cargando && !tirados.data) ? (
            <Cargando />
          ) : renglones.length === 0 ? (
            <p className="tenue">No se cargó nada tirado en los últimos 30 días.</p>
          ) : (
            <ul className="lista-mermas">
              {(verTodo ? renglones : renglones.slice(0, LIMITE)).map((x) =>
                x.tipo === "mercaderia" ? (
                  <li key={x.clave}>
                    <span className="tenue chico fecha">{fmtFecha(x.fecha)}</span>
                    <span>
                      <strong>
                        {fmt(x.merma.cantidad)} {x.merma.unidad_simbolo} de {x.merma.ingrediente_nombre}
                      </strong>
                      <span className="chico tenue">
                        {" "}
                        {x.merma.motivo_display.toLowerCase()}
                        {x.merma.nota && `: ${x.merma.nota}`}
                      </span>
                    </span>
                    <button className="btn peligro mini" onClick={() => borrarMerma(x.merma)}>
                      Borrar
                    </button>
                  </li>
                ) : (
                  <li key={x.clave}>
                    <span className="tenue chico fecha">{fmtFecha(x.fecha)}</span>
                    <span>
                      <strong>
                        {x.registro.descartados} {x.registro.descartados === 1 ? "porción" : "porciones"} de{" "}
                        {x.registro.plato_nombre}
                      </strong>
                      <span className="chico tenue"> tiradas</span>
                    </span>
                    <span className="etiqueta neutra">Plato</span>
                  </li>
                ),
              )}
            </ul>
          )}
          {renglones.length > LIMITE && (
            <button type="button" className="btn sec mini" style={{ marginTop: "0.75rem" }} onClick={() => setVerTodo(!verTodo)}>
              {verTodo ? "Mostrar menos" : `Mostrar las ${renglones.length}`}
            </button>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="t-resumen">
        <div className="encabezado" style={{ marginBottom: "1rem" }}>
          <h2 id="t-resumen" style={{ margin: 0 }}>
            Cuánto se tiró
          </h2>
          <div className="segmentado" role="group" aria-label="Período">
            {opciones.map((o) => (
              <button key={o.id} type="button" aria-pressed={preset === o.id} onClick={() => setPreset(o.id)}>
                {o.texto}
              </button>
            ))}
          </div>
        </div>
        <AvisoError texto={resumen.error} />
        {resumen.cargando && !r ? (
          <Cargando />
        ) : !r || (r.ingredientes.length === 0 && r.platos.length === 0) ? (
          <p className="tenue">No se tiró nada entre el {fmtFecha(periodo.desde)} y el {fmtFecha(periodo.hasta)}.</p>
        ) : (
          <div className="pila">
            <div className="cifras">
              <div className="cifra">
                <strong>{r.porciones_tiradas}</strong>
                <span>porciones tiradas</span>
              </div>
              <div className="cifra">
                <strong>{r.registros_merma}</strong>
                <span>mermas de mercadería</span>
              </div>
            </div>

            {r.ingredientes.length > 0 && (
              <div>
                <h3>Mercadería</h3>
                <p className="chico tenue" style={{ marginTop: 0 }}>
                  &ldquo;Dentro de platos&rdquo; es lo que llevaban las porciones tiradas, según la receta de ese día.
                </p>
                <div className="tabla-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="num">Sin usar</th>
                        <th className="num">Dentro de platos</th>
                        <th className="num">Total tirado</th>
                        <th className="ocultar-movil">Motivos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.ingredientes.map((i) => (
                        <tr key={i.ingrediente_id}>
                          <td>
                            <Link href={`/mercaderia/${i.ingrediente_id}`}>{i.ingrediente}</Link>
                          </td>
                          <td className="num">{i.cruda ? fmtCant(i.cruda, i.unidad) : "—"}</td>
                          <td className="num">{i.en_platos_tirados ? fmtCant(i.en_platos_tirados, i.unidad) : "—"}</td>
                          <td className="num">
                            <strong>{fmtCant(i.total, i.unidad)}</strong>
                          </td>
                          <td className="chico tenue ocultar-movil">
                            {i.motivos.map((m) => `${m.motivo_display} ${fmt(m.cantidad)} ${i.unidad}`).join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {r.platos.length > 0 && (
              <div>
                <h3>Platos</h3>
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
                      {r.platos.map((p) => (
                        <tr key={p.plato_id}>
                          <td>{p.plato}</td>
                          <td className="num">{p.vendidos}</td>
                          <td className="num">{p.descartados}</td>
                          <td className="num">{p.porcentaje_descartado == null ? "—" : `${fmt(p.porcentaje_descartado)} %`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
