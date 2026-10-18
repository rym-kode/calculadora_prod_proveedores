"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import BarraStock from "@/components/BarraStock";
import { AvisoError, AvisoOk, Cargando } from "@/components/Mensaje";
import { enviar, type Dimension, type Ingrediente, type Unidad } from "@/lib/api";
import { DIMENSIONES, fmtCant, isoLocal } from "@/lib/format";
import { useApi } from "@/lib/useApi";

type Form = { id?: number; nombre: string; dimension: Dimension; unidad_preferida: string; stock_minimo: string; activo: boolean; notas: string };
type Conteo = { ingrediente: Ingrediente; stock_real: string; unidad: string; fecha: string; nota: string };

export default function Mercaderia() {
  const router = useRouter();
  const ingredientes = useApi<Ingrediente[]>("/ingredientes/");
  const unidades = useApi<Unidad[]>("/unidades/");
  const [form, setForm] = useState<Form | null>(null);
  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const dlgForm = useRef<HTMLDialogElement>(null);
  const dlgConteo = useRef<HTMLDialogElement>(null);

  const unidadesDe = (d: Dimension) => (unidades.data ?? []).filter((u) => u.dimension === d);
  const preferidaDe = (d: Dimension) => {
    const us = unidadesDe(d);
    return String((us.find((u) => ["kg", "l", "u"].includes(u.simbolo)) ?? us[0])?.id ?? "");
  };

  function abrirNuevo() {
    setErrorDialogo(null);
    setForm({ nombre: "", dimension: "masa", unidad_preferida: preferidaDe("masa"), stock_minimo: "", activo: true, notas: "" });
    dlgForm.current?.showModal();
  }

  function abrirEditar(i: Ingrediente) {
    setErrorDialogo(null);
    setForm({
      id: i.id,
      nombre: i.nombre,
      dimension: i.dimension,
      unidad_preferida: String(i.unidad_preferida),
      stock_minimo: String(i.stock_minimo),
      activo: i.activo,
      notas: i.notas,
    });
    dlgForm.current?.showModal();
  }

  function abrirConteo(i: Ingrediente) {
    setErrorDialogo(null);
    setConteo({ ingrediente: i, stock_real: "", unidad: String(i.unidad_preferida), fecha: isoLocal(), nota: "" });
    dlgConteo.current?.showModal();
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErrorDialogo(null);
    const body = {
      nombre: form.nombre.trim(),
      dimension: form.dimension,
      unidad_preferida: Number(form.unidad_preferida),
      stock_minimo: form.stock_minimo || "0",
      activo: form.activo,
      notas: form.notas,
    };
    try {
      if (form.id) await enviar(`/ingredientes/${form.id}/`, "PATCH", body);
      else await enviar("/ingredientes/", "POST", body);
      dlgForm.current?.close();
      setOk(form.id ? `${body.nombre} actualizado.` : `${body.nombre} agregado.`);
      ingredientes.recargar();
    } catch (err) {
      setErrorDialogo(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  async function borrar() {
    if (!form?.id || !confirm(`¿Borrar ${form.nombre}?`)) return;
    try {
      await enviar(`/ingredientes/${form.id}/`, "DELETE");
      dlgForm.current?.close();
      setOk(`${form.nombre} borrado.`);
      ingredientes.recargar();
    } catch (err) {
      setErrorDialogo(err instanceof Error ? err.message : "No se pudo borrar.");
    }
  }

  async function guardarConteo(e: React.FormEvent) {
    e.preventDefault();
    if (!conteo) return;
    setErrorDialogo(null);
    try {
      const r = await enviar<{ detail?: string }>("/ingredientes/ajuste/", "POST", {
        ingrediente: conteo.ingrediente.id,
        fecha: conteo.fecha,
        stock_real: conteo.stock_real,
        unidad: Number(conteo.unidad),
        nota: conteo.nota,
      });
      dlgConteo.current?.close();
      setOk(r?.detail ?? `Stock de ${conteo.ingrediente.nombre} ajustado al conteo.`);
      ingredientes.recargar();
    } catch (err) {
      setErrorDialogo(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  const lista = (ingredientes.data ?? []).filter((i) => verInactivos || i.activo);

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1 className="titulo">Mercadería</h1>
          <p className="bajada">
            Cada producto tiene un stock mínimo: cuando queda menos, aparece en la lista para salir a comprar.
          </p>
        </div>
        <button className="btn yema" onClick={abrirNuevo} disabled={!unidades.data}>
          Agregar mercadería
        </button>
      </div>

      <AvisoError texto={error ?? ingredientes.error} />
      <AvisoOk texto={ok} />

      <section className="panel">
        {ingredientes.cargando && !ingredientes.data ? (
          <Cargando />
        ) : !ingredientes.data?.length ? (
          <div className="vacio">
            <p>Empezá cargando los productos que comprás: papa, carne, aceite…</p>
            <button className="btn" onClick={abrirNuevo}>
              Agregar mercadería
            </button>
          </div>
        ) : (
          <>
            <div className="tabla-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Stock</th>
                    <th style={{ width: "22%" }}>Nivel</th>
                    <th className="num">Mínimo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((i) => (
                    <tr key={i.id} className="clic" onClick={() => router.push(`/mercaderia/${i.id}`)}>
                      <td>
                        <strong>{i.nombre}</strong>
                        {!i.activo && <span className="etiqueta neutra" style={{ marginLeft: 8 }}>Inactivo</span>}
                        <div className="chico tenue">{DIMENSIONES[i.dimension]}</div>
                      </td>
                      <td className="num">{fmtCant(i.stock_actual, i.unidad_simbolo)}</td>
                      <td>
                        <BarraStock stock={i.stock_actual} minimo={i.stock_minimo} />
                      </td>
                      <td className="num tenue">{fmtCant(i.stock_minimo, i.unidad_simbolo)}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <button className="btn sec mini" onClick={() => abrirConteo(i)}>
                          Contar
                        </button>{" "}
                        <button className="btn sec mini" onClick={() => abrirEditar(i)}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="chico tenue" style={{ display: "inline-flex", gap: 6, marginTop: "1rem", alignItems: "center" }}>
              <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} style={{ minHeight: 0 }} />
              Mostrar inactivos
            </label>
          </>
        )}
      </section>

      <dialog ref={dlgForm} aria-labelledby="t-form">
        {form && (
          <form onSubmit={guardar}>
            <h2 id="t-form">{form.id ? `Editar ${form.nombre}` : "Agregar mercadería"}</h2>
            <AvisoError texto={errorDialogo} />
            <label className="campo">
              Nombre
              <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required autoFocus />
            </label>
            <div className="fila">
              <label className="campo" style={{ flex: 1 }}>
                Se mide en
                <select
                  value={form.dimension}
                  onChange={(e) => {
                    const d = e.target.value as Dimension;
                    setForm({ ...form, dimension: d, unidad_preferida: preferidaDe(d) });
                  }}
                >
                  {Object.entries(DIMENSIONES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo" style={{ flex: 1 }}>
                Mostrar en
                <select value={form.unidad_preferida} onChange={(e) => setForm({ ...form, unidad_preferida: e.target.value })}>
                  {unidadesDe(form.dimension).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre} ({u.simbolo})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="campo">
              Stock mínimo, en {unidadesDe(form.dimension).find((u) => String(u.id) === form.unidad_preferida)?.simbolo}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={form.stock_minimo}
                onChange={(e) => setForm({ ...form, stock_minimo: e.target.value })}
                placeholder="0"
              />
            </label>
            <label className="campo">
              Notas
              <textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} />
            </label>
            {form.id && (
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} style={{ minHeight: 0 }} />
                Activo
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
                <button type="button" className="btn sec" onClick={() => dlgForm.current?.close()}>
                  Cancelar
                </button>
                <button type="submit" className="btn yema">
                  {form.id ? "Guardar cambios" : "Agregar"}
                </button>
              </span>
            </div>
          </form>
        )}
      </dialog>

      <dialog ref={dlgConteo} aria-labelledby="t-conteo">
        {conteo && (
          <form onSubmit={guardarConteo}>
            <h2 id="t-conteo">Contar {conteo.ingrediente.nombre}</h2>
            <p className="tenue" style={{ margin: 0 }}>
              El sistema calcula que hay {fmtCant(conteo.ingrediente.stock_actual, conteo.ingrediente.unidad_simbolo)}. Si al
              contar hay otra cantidad, la diferencia se guarda como ajuste. Si sabés que se tiró algo, cargalo mejor en
              Mermas para que quede el motivo.
            </p>
            <AvisoError texto={errorDialogo} />
            <div className="fila">
              <label className="campo" style={{ flex: 1 }}>
                Cantidad contada
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  required
                  autoFocus
                  value={conteo.stock_real}
                  onChange={(e) => setConteo({ ...conteo, stock_real: e.target.value })}
                />
              </label>
              <label className="campo">
                Unidad
                <select value={conteo.unidad} onChange={(e) => setConteo({ ...conteo, unidad: e.target.value })}>
                  {unidadesDe(conteo.ingrediente.dimension).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.simbolo}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                Fecha
                <input type="date" value={conteo.fecha} max={isoLocal()} onChange={(e) => setConteo({ ...conteo, fecha: e.target.value })} />
              </label>
            </div>
            <label className="campo">
              Motivo
              <input value={conteo.nota} onChange={(e) => setConteo({ ...conteo, nota: e.target.value })} placeholder="Ej.: se echó a perder" />
            </label>
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn sec" onClick={() => dlgConteo.current?.close()}>
                Cancelar
              </button>
              <button type="submit" className="btn yema">
                Guardar conteo
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
