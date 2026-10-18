/** Barra de stock: el relleno es el stock actual y la marca vertical el mínimo.
 *  La escala llega hasta el doble del mínimo (o el stock, si es mayor). */
export default function BarraStock({
  stock,
  minimo,
  nivel: forzado,
}: {
  stock: number;
  minimo: number;
  nivel?: "critico" | "bajo";
}) {
  const tope = Math.max(minimo * 2, stock, 1);
  const pct = Math.max(0, Math.min(100, (stock / tope) * 100));
  const marca = minimo > 0 ? (minimo / tope) * 100 : null;
  const nivel = forzado ?? (stock <= 0 ? "critico" : minimo > 0 && stock <= minimo ? "bajo" : "");
  return (
    <div className={`barra ${nivel}`} role="img" aria-label={`Stock ${stock}, mínimo ${minimo}`}>
      <span style={{ width: `${pct}%` }} />
      {marca != null && <i style={{ left: `calc(${marca}% - 1px)` }} />}
    </div>
  );
}
