"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Carga un recurso de la API y expone estado + recarga.
 *
 * Al cambiar `path`, `data` sigue mostrando lo anterior hasta que llega lo
 * nuevo (útil para gráficos). `dataPath` dice a qué ruta corresponde `data`,
 * para las pantallas que no pueden mostrar datos de otra ruta ni un instante
 * (por ejemplo, el formulario del día). Las respuestas que llegan tarde, de
 * una ruta que ya no es la actual, se descartan.
 */
export function useApi<T>(path: string | null) {
  const [estado, setEstado] = useState<{ data: T | null; dataPath: string | null }>({ data: null, dataPath: null });
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(Boolean(path));
  const actual = useRef(path);
  actual.current = path;

  const recargar = useCallback(async () => {
    if (!path) return;
    setCargando(true);
    try {
      const data = await api<T>(path);
      if (actual.current !== path) return;
      setEstado({ data, dataPath: path });
      setError(null);
    } catch (e) {
      if (actual.current !== path) return;
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      if (actual.current === path) setCargando(false);
    }
  }, [path]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const setData = useCallback((data: T | null) => setEstado((e) => ({ ...e, data })), []);

  return { data: estado.data, dataPath: estado.dataPath, error, cargando, recargar, setData };
}
