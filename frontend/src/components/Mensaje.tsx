export function AvisoError({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div className="aviso error" role="alert">
      {texto}
    </div>
  );
}

export function AvisoOk({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div className="aviso ok" role="status">
      {texto}
    </div>
  );
}

export function Cargando() {
  return <p className="cargando">Cargando…</p>;
}
