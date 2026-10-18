const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const moneda = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export const fmt = (n: number | null | undefined) => (n == null ? "—" : numero.format(n));
export const fmtMoneda = (n: number | null | undefined) => (n == null ? "—" : moneda.format(n));
export const fmtCant = (n: number | null | undefined, unidad: string) => (n == null ? "—" : `${numero.format(n)} ${unidad}`);

/** Fecha local en formato AAAA-MM-DD (sin corrimiento por zona horaria). */
export function isoLocal(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function desdeIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function sumarDias(s: string, dias: number): string {
  const d = desdeIso(s);
  d.setDate(d.getDate() + dias);
  return isoLocal(d);
}

const fechaCorta = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });
const fechaLarga = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" });

export const fmtFecha = (s: string) => fechaCorta.format(desdeIso(s));
export const fmtFechaLarga = (s: string) => {
  const t = fechaLarga.format(desdeIso(s));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const DIMENSIONES = {
  masa: "Peso",
  volumen: "Volumen",
  unidad: "Unidades",
} as const;
