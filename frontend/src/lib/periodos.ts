import { desdeIso, sumarDias } from "./format";

export type Agrupar = "dia" | "semana" | "mes";

export interface Preset {
  id: string;
  texto: string;
  desde: string;
  hasta: string;
  agrupar: Agrupar;
}

/** Períodos rápidos, con las semanas de lunes a domingo. */
export function presets(hoy: string): Preset[] {
  const d = desdeIso(hoy);
  const lunes = sumarDias(hoy, -((d.getDay() + 6) % 7));
  return [
    { id: "esta", texto: "Esta semana", desde: lunes, hasta: hoy, agrupar: "dia" },
    { id: "pasada", texto: "Semana pasada", desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1), agrupar: "dia" },
    { id: "4s", texto: "Últimas 4 semanas", desde: sumarDias(lunes, -21), hasta: hoy, agrupar: "semana" },
    { id: "mes", texto: "Este mes", desde: hoy.slice(0, 8) + "01", hasta: hoy, agrupar: "semana" },
    { id: "3m", texto: "3 meses", desde: sumarDias(hoy, -89), hasta: hoy, agrupar: "mes" },
  ];
}
