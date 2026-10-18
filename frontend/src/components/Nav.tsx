"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Alerta } from "@/lib/api";

// `corto` es el texto de la barra inferior en el celular.
const SECCIONES = [
  { href: "/", texto: "Panel", corto: "Panel" },
  { href: "/produccion", texto: "Ventas del día", corto: "Ventas" },
  { href: "/compras", texto: "Compras", corto: "Compras" },
  { href: "/mermas", texto: "Mermas", corto: "Mermas" },
  { href: "/mercaderia", texto: "Mercadería", corto: "Stock" },
  { href: "/platos", texto: "Platos", corto: "Platos" },
  { href: "/insights", texto: "Consumo", corto: "Consumo" },
];

export default function Nav() {
  const pathname = usePathname();
  const [alertas, setAlertas] = useState<number | null>(null);

  useEffect(() => {
    api<Alerta[]>("/alertas/")
      .then((a) => setAlertas(a.length))
      .catch(() => setAlertas(null));
  }, [pathname]);

  const activo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="nav" aria-label="Secciones">
      <Link href="/" className="marca">
        Stock de cocina
        <small>Casa de comidas</small>
      </Link>
      <ul>
        {SECCIONES.map((s) => (
          <li key={s.href}>
            <Link href={s.href} aria-current={activo(s.href) ? "page" : undefined}>
              <span className="largo">{s.texto}</span>
              <span className="corto">{s.corto}</span>
              {s.href === "/" && alertas ? (
                <span className="contador" aria-label={`${alertas} alertas`}>
                  {alertas}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
