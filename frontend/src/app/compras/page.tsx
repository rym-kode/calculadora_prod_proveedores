"use client";

import Link from "next/link";
import { useState } from "react";
import { AvisoError, AvisoOk, Cargando } from "@/components/Mensaje";
import { enviar, type Compra, type Ingrediente, type Paginado, type Unidad } from "@/lib/api";
import { fmtCant, fmtFecha, fmtMoneda, isoLocal } from "@/lib/format";
import { useApi } from "@/lib/useApi";

type Renglon = { ingrediente: string; cantidad: string; unidad: string; costo: string };
const vacio = (): Renglon => ({ ingrediente: "", cantidad: "", unidad: "", costo: "" });

export default function Compras() {
  const ingredientes = useApi<Ingrediente[]>("/ingredientes/?activos=1");
  const unidades = useApi<Unidad[]>("/unidades/");
  const compras = useApi<Paginado<Compra>>("/compras/");

  const [fecha, setFecha] = useState(isoLocal());
  const [proveedor, setProveedor] = useState("");
  const [renglones, setRenglones] = useState<Renglon[]>([vacio()]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const ing = (id: string) => ingredientes.data?.find((i) => String(i.id) === id);
  const unidadesPara = (id: string) => {
    const i = ing(id);
    return i ? (unidades.data ?? []).filter((u) => u.dimension === i.dimension) : [];
  };

  const cambiar = (idx: number, campo: keyof Renglon, valor: string) =>
    setRenglones((rs) =>
      rs.map((r, i) => {
        if (i !== idx) return r;
        const nuevo = { ...r, [campo]: valor };
        if (campo === "ingrediente") nuevo.unidad = String(ing(valor)?.unidad_preferida ?? "");
        return nuevo;
      }),
    );

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const completos = renglones.filter((r) => r.ingrediente && r.cantidad);
    if (completos.length === 0) {
      setError("Agregá al menos un producto con su cantidad.");
      return;
    }
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await enviar("/compras/", "POST", {
        fecha,
        proveedor,
        items: completos.map((r) => ({
          ingrediente: Number(r.ingrediente),
          cantidad: r.cantidad,
          unidad: Number(r.unidad),
          costo_total: r.costo || null,
        })),
      });
      setOk(`Compra guardada: ${completos.length} producto${completos.length === 1 ? " sumado" : "s sumados"} al stock.`);
      setRenglones([vacio()]);
      compras.recargar();
      ingredientes.recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(c: Compra) {
    if (!confirm(`¿Borrar la compra del ${fmtFecha(c.fecha)}? Se va a restar del stock lo que se había sumado.`)) return;
    try {
      await enviar(`/compras/${c.id}/`, "DELETE");
      compras.recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar.");
    }
  }

  const sinIngredientes = ingredientes.data && ingredientes.data.length === 0;

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1 className="titulo">Compras</h1>
          <p className="bajada">Lo que cargues acá se suma al stock en la fecha de la compra.</p>
        </div>
      </div>

      <AvisoError texto={error ?? ingredientes.error ?? compras.error} />
      <AvisoOk texto={ok} />

      <div className="grilla-2">
        <form className="panel" onSubmit={guardar}>
          <h2>Nueva compra</h2>
          {sinIngredientes ? (
            <div className="vacio">
              <p>Todavía no hay mercadería cargada.</p>
              <Link className="btn" href="/mercaderia">
                Agregar mercadería
              </Link>
            </div>
          ) : (
            <>
              <div className="fila" style={{ marginBottom: "1rem" }}>
                <label className="campo">
                  Fecha
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
                </label>
                <label className="campo" style={{ flex: 1, minWidth: "12rem" }}>
                  Proveedor
                  <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Ej.: Mercado Central" />
                </label>
              </div>
              <div className="tabla-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="num">Cantidad</th>
                      <th>Unidad</th>
                      <th className="num">Costo total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {renglones.map((r, idx) => (
                      <tr key={idx}>
                        <td>
                          <select
                            value={r.ingrediente}
                            onChange={(e) => cambiar(idx, "ingrediente", e.target.value)}
                            aria-label="Producto"
                            style={{ minWidth: "10rem", width: "100%" }}
                          >
                            <option value="">Elegir…</option>
                            {ingredientes.data?.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.nombre}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={r.cantidad}
                            onChange={(e) => cambiar(idx, "cantidad", e.target.value)}
                            aria-label="Cantidad"
                            style={{ width: "6rem" }}
                          />
                        </td>
                        <td>
                          <select
                            value={r.unidad}
                            onChange={(e) => cambiar(idx, "unidad", e.target.value)}
                            aria-label="Unidad"
                            disabled={!r.ingrediente}
                          >
                            {unidadesPara(r.ingrediente).map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.simbolo}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={r.costo}
                            onChange={(e) => cambiar(idx, "costo", e.target.value)}
                            aria-label="Costo total (opcional)"
                            placeholder="$"
                            style={{ width: "7rem" }}
                          />
                        </td>
                        <td>
                          {renglones.length > 1 && (
                            <button
                              type="button"
                              className="btn peligro mini"
                              onClick={() => setRenglones((rs) => rs.filter((_, i) => i !== idx))}
                              aria-label="Quitar renglón"
                            >
                              Quitar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="fila" style={{ marginTop: "1rem", justifyContent: "space-between" }}>
                <button type="button" className="btn sec" onClick={() => setRenglones((rs) => [...rs, vacio()])}>
                  Agregar producto
                </button>
                <button type="submit" className="btn yema" disabled={guardando}>
                  {guardando ? "Guardando…" : "Guardar compra"}
                </button>
              </div>
            </>
          )}
        </form>

        <section className="panel" aria-labelledby="t-historial">
          <h2 id="t-historial">Últimas compras</h2>
          {compras.cargando && !compras.data ? (
            <Cargando />
          ) : !compras.data?.results?.length ? (
            <p className="tenue">Todavía no hay compras cargadas.</p>
          ) : (
            <div className="pila" style={{ gap: "1rem" }}>
              {compras.data.results.map((c) => (
                <article key={c.id} style={{ borderBottom: "1px solid var(--acero-2)", paddingBottom: "0.75rem" }}>
                  <div className="fila" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong>
                      {fmtFecha(c.fecha)}
                      {c.proveedor && <span className="tenue"> en {c.proveedor}</span>}
                    </strong>
                    <span className="fila" style={{ gap: "0.5rem", alignItems: "center" }}>
                      {c.total != null && <span>{fmtMoneda(c.total)}</span>}
                      <button className="btn peligro mini" onClick={() => borrar(c)}>
                        Borrar
                      </button>
                    </span>
                  </div>
                  <p className="chico tenue" style={{ margin: "0.25rem 0 0" }}>
                    {c.items.map((i) => `${i.ingrediente_nombre} ${fmtCant(Number(i.cantidad), i.unidad_simbolo ?? "")}`).join(", ")}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
