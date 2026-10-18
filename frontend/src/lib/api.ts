export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export type Dimension = "masa" | "volumen" | "unidad";

export interface Unidad {
  id: number;
  simbolo: string;
  nombre: string;
  dimension: Dimension;
  factor: number;
}

export interface Ingrediente {
  id: number;
  nombre: string;
  dimension: Dimension;
  unidad_preferida: number;
  unidad_simbolo: string;
  stock_minimo: number;
  stock_actual: number;
  activo: boolean;
  notas: string;
}

export interface RecetaItem {
  id?: number;
  ingrediente: number;
  ingrediente_nombre?: string;
  cantidad: number | string;
  unidad: number;
  unidad_simbolo?: string;
}

export interface Plato {
  id: number;
  nombre: string;
  descripcion: string;
  precio_venta: number | null;
  activo: boolean;
  ingredientes: RecetaItem[];
}

export interface CompraItem {
  id?: number;
  ingrediente: number;
  ingrediente_nombre?: string;
  cantidad: number | string;
  unidad: number;
  unidad_simbolo?: string;
  costo_total: number | string | null;
}

export interface Compra {
  id: number;
  fecha: string;
  proveedor: string;
  notas: string;
  items: CompraItem[];
  total: number | null;
}

export interface RegistroProduccion {
  id: number;
  fecha: string;
  plato: number;
  plato_nombre: string;
  cocinados: number;
  vendidos: number;
  descartados: number;
  notas: string;
}

export interface Alerta {
  ingrediente_id: number;
  ingrediente: string;
  unidad: string;
  nivel: "critico" | "bajo";
  motivos: string[];
  stock_actual: number;
  stock_minimo: number;
  consumo_semana_pasada: number;
  merma_semana_pasada: number;
  semana_pasada: { desde: string; hasta: string };
  salida_ultimos_7_dias: number;
  dias_cobertura: number | null;
  compra_sugerida: number;
}

export interface VentaPlato {
  plato_id: number;
  plato: string;
  cocinados: number;
  vendidos: number;
  descartados: number;
  porcentaje_descartado: number | null;
}

export interface Resumen {
  fecha: string;
  alertas_criticas: number;
  alertas_total: number;
  ingredientes_activos: number;
  platos_activos: number;
  produccion_hoy: { cocinados: number; vendidos: number; descartados: number };
  produccion_cargada_hoy: boolean;
  compras_ultimos_7_dias: number;
  ventas_semana_pasada: VentaPlato[];
  porciones_tiradas_semana_pasada: number;
  mermas_semana_pasada: number;
}

export type MotivoMerma = "vencido" | "mal_estado" | "rotura" | "error" | "otro";

export const MOTIVOS_MERMA: { valor: MotivoMerma; texto: string }[] = [
  { valor: "mal_estado", texto: "En mal estado" },
  { valor: "vencido", texto: "Vencido" },
  { valor: "rotura", texto: "Se cayó / se rompió" },
  { valor: "error", texto: "Error de preparación" },
  { valor: "otro", texto: "Otro" },
];

export interface Merma {
  id: number;
  fecha: string;
  ingrediente: number;
  ingrediente_nombre: string;
  cantidad: number;
  unidad: number;
  unidad_simbolo: string;
  motivo: MotivoMerma;
  motivo_display: string;
  nota: string;
}

export interface MermaIngrediente {
  ingrediente_id: number;
  ingrediente: string;
  unidad: string;
  cruda: number;
  en_platos_tirados: number;
  total: number;
  motivos: { motivo: MotivoMerma; motivo_display: string; cantidad: number }[];
}

export interface ResumenMermas {
  desde: string;
  hasta: string;
  ingredientes: MermaIngrediente[];
  platos: VentaPlato[];
  porciones_tiradas: number;
  registros_merma: number;
}

export interface ConsumoSerie {
  ingrediente_id: number;
  ingrediente: string;
  unidad: string;
  total: number;
  promedio_diario: number;
  promedio_semanal: number;
  valores: number[];
}

export interface Consumo {
  desde: string;
  hasta: string;
  agrupar: "dia" | "semana" | "mes";
  periodos: string[];
  series: ConsumoSerie[];
}

export interface Movimiento {
  id: number;
  fecha: string;
  tipo: "compra" | "produccion" | "merma" | "ajuste";
  tipo_display: string;
  cantidad: number;
  nota: string;
}

export interface Historial {
  ingrediente_id: number;
  ingrediente: string;
  unidad: string;
  stock_inicial: number;
  serie: { fecha: string; stock: number }[];
  movimientos: Movimiento[];
}

export interface Paginado<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data: unknown) {
    super(message);
  }
}

/** Convierte la respuesta de error de DRF en un texto legible. */
function mensajeDeError(data: unknown): string {
  if (!data || typeof data !== "object") return "No se pudo completar la operación.";
  const partes: string[] = [];
  const recorrer = (valor: unknown, campo?: string) => {
    if (Array.isArray(valor)) valor.forEach((v) => recorrer(v, campo));
    else if (valor && typeof valor === "object")
      Object.entries(valor).forEach(([k, v]) => recorrer(v, k === "non_field_errors" || k === "detail" ? campo : k));
    else if (valor != null) partes.push(campo ? `${campo}: ${valor}` : String(valor));
  };
  recorrer(data);
  return partes.join("; ") || "No se pudo completar la operación.";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      `No se pudo conectar con el servidor (${API_URL}). Revisá que el backend esté corriendo.`,
      0,
      null,
    );
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status >= 500)
      throw new ApiError(
        `El servidor tuvo un error (${res.status}). Si recién actualizaste la app, cortá el backend, corré ` +
          "python manage.py migrate y volvé a levantarlo. Si sigue, mirá el error en la terminal del backend.",
        res.status,
        data,
      );
    if (res.status === 404) throw new ApiError("No se encontró: puede que se haya borrado.", 404, data);
    throw new ApiError(mensajeDeError(data), res.status, data);
  }
  return data as T;
}

export const enviar = <T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown) =>
  api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
