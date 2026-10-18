"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AvisoError, AvisoOk, Cargando } from "@/components/Mensaje";
import { enviar, type Ingrediente, type Plato, type Unidad } from "@/lib/api";
import { fmt, fmtMoneda } from "@/lib/format";
import { useApi } from "@/lib/useApi";

type Renglon = { ingrediente: string; cantidad: string; unidad: string };
type Form = { id?: number; nombre: string; descripcion: string; precio_venta: string; activo: boolean; receta: Renglon[] };
const renglonVacio = (): Renglon => ({ ingrediente: "", cantidad: "", unidad: "" });

export default function Platos() {
  const platos = useApi<Plato[]>("/platos/");
  const ingredientes = useApi<Ingrediente[]>("/ingredientes/");
  const unidades = useApi<Unidad[]>("/unidades/");
  const [form, setForm] = useState<Form | null>(null);
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  const ing = (id: string) => ingredientes.data?.find((i) => String(i.id) === id);
  const unidadesPara = (id: string) => {
    const i = ing(id);
    return i ? (unidades.data ?? []).filter((u) => u.dimension === i.dimension) : [];
  };
  // Para recetas conviene la unidad chica (g, ml, u) por defecto.
  const unidadChica = (id: string) => String(unidadesPara(id).sort((a, b) => a.factor - b.factor)[0]?.id ?? "");

  function abrir(p?: Plato) {
    setErrorDialogo(null);
    setForm(
      p
        ? {
            id: p.id,
            nombre: p.nombre,
            descripcion: p.descripcion,
            precio_venta: p.precio_venta != null ? String(p.precio_venta) : "",
            activo: p.activo,
            receta: p.ingredientes.map((r) => ({
              ingrediente: String(r.ingrediente),
              cantidad: String(Number(r.cantidad)),
              unidad: String(r.unidad),
            })),
          }
        : { nombre: "", descripcion: "", precio_venta: "", activo: true, receta: [renglonVacio()] },
    );
    dlg.current?.showModal();
  }

  const cambiarRenglon = (idx: number, campo: keyof Renglon, valor: string) =>
    form &&
    setForm({
      ...form,
      receta: form.receta.map((r, i) =>
        i !== idx ? r : { ...r, [campo]: valor, ...(campo === "ingrediente" ? { unidad: unidadChica(valor) } : {}) },
      ),
    });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErrorDialogo(null);
    const receta = form.receta.filter((r) => r.ingrediente && r.cantidad);
    if (receta.length === 0) {
      setErrorDialogo("Agregá al menos un ingrediente con su cantidad por porción.");
      return;
    }
    const body = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion,
      precio_venta: form.precio_venta || null,
      activo: form.activo,
      ingredientes: receta.map((r) => ({ ingrediente: Number(r.ingrediente), cantidad: r.cantidad, unidad: Number(r.unidad) })),
    };
    try {
      if (form.id) await enviar(`/platos/${form.id}/`, "PUT", body);
      else await enviar("/platos/", "POST", body);
      dlg.current?.close();
      setOk(form.id ? `${body.nombre} actualizado. Los días ya cargados mantienen la receta anterior.` : `${body.nombre} agregado.`);
      platos.recargar();
    } catch (err) {
      setErrorDialogo(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  async function borrar() {
    if (!form?.id || !confirm(`¿Borrar ${form.nombre}?`)) return;
    try {
      await enviar(`/platos/${form.id}/`, "DELETE");
      dlg.current?.close();
      setOk(`${form.nombre} borrado.`);
      platos.recargar();
    } catch (err) {
      setErrorDialogo(err instanceof Error ? err.message : "No se pudo borrar.");
    }
  }

  const sinIngredientes = ingredientes.data && ingredientes.data.length === 0;

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1 className="titulo">Platos</h1>
          <p className="bajada">Cada plato lleva la cantidad promedio de cada ingrediente por porción.</p>
        </div>
        <button className="btn yema" onClick={() => abrir()} disabled={!ingredientes.data?.length}>
          Agregar plato
        </button>
      </div>

      <AvisoError texto={platos.error ?? ingredientes.error} />
      <AvisoOk texto={ok} />

      {sinIngredientes ? (
        <div className="panel vacio">
          <p>Para armar un plato primero cargá la mercadería que usa.</p>
          <Link className="btn" href="/mercaderia">
            Agregar mercadería
          </Link>
        </div>
      ) : platos.cargando && !platos.data ? (
        <Cargando />
      ) : !platos.data?.length ? (
        <div className="panel vacio">
          <p>Todavía no hay platos. Agregá el primero con su receta.</p>
          <button className="btn" onClick={() => abrir()}>
            Agregar plato
          </button>
        </div>
      ) : (
        <section className="panel">
          <div className="tabla-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plato</th>
                  <th>Ingredientes por porción</th>
                  <th className="num">Precio</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {platos.data.map((p) => (
                  <tr key={p.id}>
                    <td style={{ minWidth: "11rem" }}>
                      <strong>{p.nombre}</strong>
                      {!p.activo && <span className="etiqueta neutra" style={{ marginLeft: 8 }}>Inactivo</span>}
                    </td>
                    <td className="chico tenue">
                      {p.ingredientes.map((r) => `${r.ingrediente_nombre} ${fmt(Number(r.cantidad))} ${r.unidad_simbolo}`).join(", ")}
                    </td>
                    <td className="num">{fmtMoneda(p.precio_venta)}</td>
                    <td className="num">
                      <button className="btn sec mini" onClick={() => abrir(p)}>
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <dialog ref={dlg} aria-labelledby="t-plato" style={{ width: "min(720px, calc(100vw - 2rem))" }}>
        {form && (
          <form onSubmit={guardar}>
            <h2 id="t-plato">{form.id ? `Editar ${form.nombre}` : "Agregar plato"}</h2>
            <AvisoError texto={errorDialogo} />
            <div className="fila">
              <label className="campo" style={{ flex: 2, minWidth: "12rem" }}>
                Nombre
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required autoFocus />
              </label>
              <label className="campo" style={{ flex: 1, minWidth: "8rem" }}>
                Precio de venta (opcional)
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={form.precio_venta}
                  onChange={(e) => setForm({ ...form, precio_venta: e.target.value })}
                />
              </label>
            </div>

            <div>
              <h3>Receta, por porción</h3>
              <div className="tabla-wrap">
                <table>
                  <tbody>
                    {form.receta.map((r, idx) => (
                      <tr key={idx}>
                        <td style={{ paddingLeft: 0 }}>
                          <select
                            value={r.ingrediente}
                            onChange={(e) => cambiarRenglon(idx, "ingrediente", e.target.value)}
                            aria-label="Ingrediente"
                            style={{ width: "100%", minWidth: "10rem" }}
                          >
                            <option value="">Elegir ingrediente…</option>
                            {ingredientes.data
                              ?.filter((i) => i.activo || String(i.id) === r.ingrediente)
                              .map((i) => (
                                <option
                                  key={i.id}
                                  value={i.id}
                                  disabled={form.receta.some((o, j) => j !== idx && o.ingrediente === String(i.id))}
                                >
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
                            onChange={(e) => cambiarRenglon(idx, "cantidad", e.target.value)}
                            aria-label="Cantidad por porción"
                            style={{ width: "6rem" }}
                          />
                        </td>
                        <td>
                          <select
                            value={r.unidad}
                            onChange={(e) => cambiarRenglon(idx, "unidad", e.target.value)}
                            disabled={!r.ingrediente}
                            aria-label="Unidad"
                          >
                            {unidadesPara(r.ingrediente).map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.simbolo}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ paddingRight: 0 }}>
                          {form.receta.length > 1 && (
                            <button
                              type="button"
                              className="btn peligro mini"
                              onClick={() => setForm({ ...form, receta: form.receta.filter((_, i) => i !== idx) })}
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
              <button
                type="button"
                className="btn sec mini"
                style={{ marginTop: "0.5rem" }}
                onClick={() => setForm({ ...form, receta: [...form.receta, renglonVacio()] })}
              >
                Agregar ingrediente
              </button>
            </div>

            <label className="campo">
              Descripción
              <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
            </label>
            {form.id && (
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} style={{ minHeight: 0 }} />
                Activo (aparece en la carga del día)
              </label>
            )}
            <div className="fila" style={{ justifyContent: "space-between" }}>
              {form.id ? (
                <button type="button" className="btn peligro" onClick={borrar}>
                  Borrar
                </button>
              ) : (
                <span />
              )}
              <span className="fila">
                <button type="button" className="btn sec" onClick={() => dlg.current?.close()}>
                  Cancelar
                </button>
                <button type="submit" className="btn yema">
                  {form.id ? "Guardar cambios" : "Agregar plato"}
                </button>
              </span>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
