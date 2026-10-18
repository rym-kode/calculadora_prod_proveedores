"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AvisoError, AvisoOk, Cargando } from "@/components/Mensaje";
import { enviar, type Plato, type RegistroProduccion } from "@/lib/api";
import { desdeIso, fmtFechaLarga, isoLocal, sumarDias } from "@/lib/format";
import { useApi } from "@/lib/useApi";

type Campo = "vendidos" | "descartados" | "cocinados";
type Fila = Record<Campo, string>;

const VACIA: Fila = { vendidos: "", descartados: "", cocinados: "" };
const COLUMNAS: { campo: Campo; titulo: string }[] = [
  { campo: "vendidos", titulo: "Vendidos" },
  { campo: "descartados", titulo: "Tirados" },
  { campo: "cocinados", titulo: "Cocinados" },
];

const nombreDia = new Intl.DateTimeFormat("es-AR", { weekday: "short" });
const nombreMes = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" });

const n = (s: string | undefined) => (s ? Math.max(0, Math.floor(Number(s))) : 0);
const lunesDe = (iso: string) => sumarDias(iso, -((desdeIso(iso).getDay() + 6) % 7));

function filaDesde(r: RegistroProduccion): Fila {
  const t = (x: number) => (x ? String(x) : "");
  return { vendidos: t(r.vendidos), descartados: t(r.descartados), cocinados: t(r.cocinados) };
}

/** Normaliza para comparar si hay cambios sin guardar ("" y "0" son lo mismo). */
const clave = (filas: Record<number, Fila>) =>
  JSON.stringify(
    Object.entries(filas)
      .map(([id, f]) => [id, n(f.vendidos), n(f.descartados), n(f.cocinados)])
      .filter(([, a, b, c]) => a || b || c)
      .sort(),
  );

function fechaInicial(hoy: string) {
  if (typeof window === "undefined") return hoy;
  const f = new URLSearchParams(window.location.search).get("fecha");
  return f && /^\d{4}-\d{2}-\d{2}$/.test(f) && f <= hoy ? f : hoy;
}

export default function Produccion() {
  const hoy = isoLocal();
  const [fecha, setFechaEstado] = useState(hoy);
  useEffect(() => setFechaEstado(fechaInicial(hoy)), [hoy]);

  const lunes = lunesDe(fecha);
  const domingo = sumarDias(lunes, 6);
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes]);

  const platos = useApi<Plato[]>("/platos/?activos=1");
  const rutaDia = `/produccion/?fecha=${fecha}`;
  const registros = useApi<RegistroProduccion[]>(rutaDia);
  const semana = useApi<RegistroProduccion[]>(`/produccion/?desde=${lunes}&hasta=${domingo}`);

  const [filas, setFilas] = useState<Record<number, Fila>>({});
  const [guardadas, setGuardadas] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Sólo se usan los registros si son de la fecha elegida (nunca los de otro día).
  const delDia = registros.dataPath === rutaDia ? registros.data : null;

  useEffect(() => {
    if (!platos.data || !delDia) return;
    const base: Record<number, Fila> = {};
    for (const p of platos.data) base[p.id] = { ...VACIA };
    for (const r of delDia) base[r.plato] = filaDesde(r);
    setFilas(base);
    setGuardadas(clave(base));
  }, [platos.data, delDia]);

  const hayCambios = guardadas !== null && clave(filas) !== guardadas;

  // Aviso del navegador si se cierra o recarga con cambios sin guardar.
  useEffect(() => {
    if (!hayCambios) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [hayCambios]);

  // Lo mismo al ir a otra sección de la app con un link.
  useEffect(() => {
    if (!hayCambios) return;
    const clic = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!confirm("Tenés cambios sin guardar en este día. ¿Salir sin guardar?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", clic, true);
    return () => document.removeEventListener("click", clic, true);
  }, [hayCambios]);

  const irA = useCallback(
    (nueva: string) => {
      if (nueva > hoy || nueva === fecha) return;
      if (hayCambios && !confirm(`Tenés cambios sin guardar del ${fmtFechaLarga(fecha).toLowerCase()}. ¿Salir sin guardar?`))
        return;
      setFechaEstado(nueva);
      setGuardadas(null);
      setOk(null);
      setError(null);
      const url = new URL(window.location.href);
      if (nueva === hoy) url.searchParams.delete("fecha");
      else url.searchParams.set("fecha", nueva);
      window.history.replaceState(null, "", url);
    },
    [fecha, hoy, hayCambios],
  );

  // Flechas del teclado ← → para cambiar de día (fuera de los campos).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, dialog")) return;
      if (e.key === "ArrowLeft") irA(sumarDias(fecha, -1));
      if (e.key === "ArrowRight") irA(sumarDias(fecha, 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [fecha, irA]);

  const cambiar = (id: number, campo: Campo, valor: string) =>
    setFilas((f) => ({ ...f, [id]: { ...(f[id] ?? VACIA), [campo]: valor } }));

  // Platos cargados ese día que hoy están inactivos también se muestran.
  const listaPlatos: { id: number; nombre: string }[] = [
    ...(platos.data ?? []),
    ...(delDia ?? []).filter((r) => !platos.data?.some((p) => p.id === r.plato)).map((r) => ({ id: r.plato, nombre: r.plato_nombre })),
  ];

  const total = (campo: Campo) => listaPlatos.reduce((t, p) => t + n(filas[p.id]?.[campo]), 0);
  const totalVendidos = total("vendidos");
  const totalTirados = total("descartados");

  const diasCargados = new Set((semana.data ?? []).map((r) => r.fecha));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setOk(null);
    try {
      await enviar("/produccion/dia/", "POST", {
        fecha,
        registros: listaPlatos.map((p) => ({
          plato: p.id,
          vendidos: n(filas[p.id]?.vendidos),
          descartados: n(filas[p.id]?.descartados),
          cocinados: n(filas[p.id]?.cocinados),
        })),
      });
      setGuardadas(clave(filas));
      setOk(
        `Guardado. Se descontó del stock la mercadería de ${totalVendidos} ${totalVendidos === 1 ? "porción vendida" : "porciones vendidas"}` +
          (totalTirados ? ` y ${totalTirados} ${totalTirados === 1 ? "tirada" : "tiradas"}.` : "."),
      );
      registros.recargar();
      semana.recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  const cargandoDia = !delDia && !registros.error;

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1 className="titulo">Ventas del día</h1>
          <p className="bajada">
            Por cada plato, cuántas porciones se vendieron y cuántas se tiraron. Las dos descuentan del stock los
            ingredientes de la receta.
          </p>
        </div>
      </div>

      <nav className="semana" aria-label="Elegir día">
        <div className="semana-cabeza">
          <strong>{nombreMes.format(desdeIso(fecha)).replace(/^./, (c) => c.toUpperCase())}</strong>
          {fecha !== hoy && (
            <button type="button" className="btn sec mini" onClick={() => irA(hoy)}>
              Ir a hoy
            </button>
          )}
        </div>
        <div className="semana-tira">
          <button type="button" className="btn sec flecha" onClick={() => irA(sumarDias(fecha, -7))} aria-label="Semana anterior">
            ‹
          </button>
          <ol>
            {dias.map((d) => {
              const futuro = d > hoy;
              return (
                <li key={d}>
                  <button
                    type="button"
                    className="dia"
                    aria-current={d === fecha ? "date" : undefined}
                    aria-label={`${fmtFechaLarga(d)}${diasCargados.has(d) ? ", cargado" : ""}`}
                    disabled={futuro}
                    onClick={() => irA(d)}
                  >
                    <span className="dia-nombre">{nombreDia.format(desdeIso(d)).replace(".", "")}</span>
                    <span className="dia-numero">{desdeIso(d).getDate()}</span>
                    <span className={`marca-carga ${diasCargados.has(d) ? "si" : ""}`} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="btn sec flecha"
            onClick={() => irA(sumarDias(fecha, 7) > hoy ? hoy : sumarDias(fecha, 7))}
            disabled={lunesDe(hoy) === lunes}
            aria-label="Semana siguiente"
          >
            ›
          </button>
        </div>
        <p className="chico tenue semana-ayuda">
          El punto marca los días ya cargados. También podés usar las flechas ← → del teclado.
        </p>
      </nav>

      <div className="fila" style={{ margin: "1.25rem 0 1rem", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{fmtFechaLarga(fecha)}</h2>
        {delDia && delDia.length > 0 && <span className="etiqueta ok">Cargado</span>}
        {hayCambios && <span className="etiqueta bajo">Cambios sin guardar</span>}
      </div>

      <AvisoError texto={error ?? platos.error ?? registros.error} />
      <AvisoOk texto={ok} />

      {platos.cargando && !platos.data ? (
        <Cargando />
      ) : listaPlatos.length === 0 && platos.data ? (
        <div className="panel vacio">
          <p>Primero cargá los platos con sus ingredientes.</p>
          <Link className="btn" href="/platos">
            Cargar platos
          </Link>
        </div>
      ) : cargandoDia ? (
        <div className="panel">
          <Cargando />
        </div>
      ) : registros.error ? null : (
        <form className="panel tabla-carga" onSubmit={guardar}>
          <div className="tabla-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plato</th>
                  {COLUMNAS.map((c) => (
                    <th key={c.campo} className={`num ${c.campo === "cocinados" ? "referencia" : ""}`}>
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listaPlatos.map((p) => {
                  const f = filas[p.id] ?? VACIA;
                  return (
                    <tr key={p.id}>
                      <td>{p.nombre}</td>
                      {COLUMNAS.map((c) => (
                        <td key={c.campo} className={`num ${c.campo === "cocinados" ? "referencia" : ""}`}>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            value={f[c.campo]}
                            placeholder="0"
                            onChange={(e) => cambiar(p.id, c.campo, e.target.value)}
                            aria-label={`${c.titulo} de ${p.nombre}`}
                            className={c.campo === "descartados" && n(f.descartados) > 0 ? "tirado" : undefined}
                            style={{ width: "5.5rem" }}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="num">{totalVendidos}</th>
                  <th className="num">{totalTirados}</th>
                  <th className="num referencia">{total("cocinados")}</th>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="chico tenue" style={{ margin: "0.75rem 0 0" }}>
            &ldquo;Cocinados&rdquo; es opcional y sólo de referencia: no descuenta mercadería.
          </p>
          <div className="fila" style={{ marginTop: "1rem", justifyContent: "space-between", alignItems: "center" }}>
            <span className="chico tenue">
              ¿Se tiró mercadería sin cocinar? <Link href="/mermas">Cargala en Mermas</Link>.
            </span>
            <button className="btn yema" type="submit" disabled={guardando || !hayCambios}>
              {guardando ? "Guardando…" : !hayCambios && delDia?.length ? "Guardado" : "Guardar día"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
