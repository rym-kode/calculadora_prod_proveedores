"""
Lógica de negocio: movimientos de stock, consumo, alertas e insights.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q, Sum

from .models import (
    Compra,
    Ingrediente,
    Merma,
    MotivoMerma,
    MovimientoStock,
    RegistroProduccion,
    TipoMovimiento,
)

CERO = Decimal("0")
# Si el stock alcanza para menos de estos días (según el consumo de los últimos
# 7 días), se alerta aunque no se haya llegado al stock mínimo.
DIAS_COBERTURA_ALERTA = 2


# --- Generación de movimientos ---------------------------------------------------


@transaction.atomic
def sincronizar_compra(compra: Compra) -> None:
    """(Re)genera los movimientos de entrada de una compra."""
    MovimientoStock.objects.filter(compra_item__compra=compra).delete()
    MovimientoStock.objects.bulk_create(
        [
            MovimientoStock(
                ingrediente_id=item.ingrediente_id,
                fecha=compra.fecha,
                tipo=TipoMovimiento.COMPRA,
                cantidad_base=item.cantidad_base,
                compra_item=item,
                nota=compra.proveedor,
            )
            for item in compra.items.all()
        ]
    )


@transaction.atomic
def sincronizar_produccion(registro: RegistroProduccion) -> None:
    """(Re)genera los movimientos de salida de un registro del día: los
    ingredientes de las porciones vendidas y tiradas, con la receta vigente del
    plato. Los registros de días anteriores no se tocan aunque después cambie
    la receta."""
    registro.movimientos.all().delete()
    porciones = porciones_descontadas(registro)
    if not porciones:
        return
    partes = [f"{registro.vendidos} vendidas"] if registro.vendidos else []
    if registro.descartados:
        partes.append(f"{registro.descartados} tiradas")
    nota = f"{' + '.join(partes)} de {registro.plato.nombre}"
    MovimientoStock.objects.bulk_create(
        [
            MovimientoStock(
                ingrediente_id=pi.ingrediente_id,
                fecha=registro.fecha,
                tipo=TipoMovimiento.PRODUCCION,
                cantidad_base=-(pi.cantidad_base * porciones),
                registro=registro,
                nota=nota,
            )
            for pi in registro.plato.ingredientes.all()
        ]
    )


def porciones_descontadas(registro: RegistroProduccion) -> int:
    """Porciones cuyos ingredientes salen del stock: las vendidas y las tiradas.
    Lo cocinado es sólo de referencia y no mueve mercadería."""
    return registro.vendidos + registro.descartados


@transaction.atomic
def sincronizar_merma(merma: Merma) -> None:
    """(Re)genera el movimiento de salida de una merma de mercadería."""
    merma.movimientos.all().delete()
    MovimientoStock.objects.create(
        ingrediente_id=merma.ingrediente_id,
        fecha=merma.fecha,
        tipo=TipoMovimiento.MERMA,
        cantidad_base=-merma.cantidad_base,
        merma=merma,
        nota=merma.get_motivo_display() + (f": {merma.nota}" if merma.nota else ""),
    )


@transaction.atomic
def ajustar_stock(ingrediente: Ingrediente, fecha: date, stock_real_base: Decimal, nota: str = ""):
    """Registra un conteo físico: crea un ajuste por la diferencia entre el
    stock teórico a esa fecha y el contado."""
    teorico = stock_a_fecha(ingrediente, fecha)
    diferencia = Decimal(stock_real_base) - teorico
    if diferencia == 0:
        return None
    return MovimientoStock.objects.create(
        ingrediente=ingrediente,
        fecha=fecha,
        tipo=TipoMovimiento.AJUSTE,
        cantidad_base=diferencia,
        nota=nota or "Conteo físico",
    )


# --- Consultas --------------------------------------------------------------------


def stock_a_fecha(ingrediente: Ingrediente, fecha: date | None = None) -> Decimal:
    qs = ingrediente.movimientos.all()
    if fecha:
        qs = qs.filter(fecha__lte=fecha)
    return qs.aggregate(t=Sum("cantidad_base"))["t"] or CERO


def stocks_actuales(hasta: date | None = None) -> dict[int, Decimal]:
    qs = MovimientoStock.objects.all()
    if hasta:
        qs = qs.filter(fecha__lte=hasta)
    return {
        r["ingrediente_id"]: r["t"]
        for r in qs.values("ingrediente_id").annotate(t=Sum("cantidad_base"))
    }


def _salidas_por_ingrediente(tipo: str, desde: date, hasta: date) -> dict[int, Decimal]:
    qs = (
        MovimientoStock.objects.filter(tipo=tipo, fecha__gte=desde, fecha__lte=hasta)
        .values("ingrediente_id")
        .annotate(t=Sum("cantidad_base"))
    )
    return {r["ingrediente_id"]: -r["t"] for r in qs}


def consumo_por_ingrediente(desde: date, hasta: date) -> dict[int, Decimal]:
    """Consumo (positivo) por producción en [desde, hasta]."""
    return _salidas_por_ingrediente(TipoMovimiento.PRODUCCION, desde, hasta)


def merma_por_ingrediente(desde: date, hasta: date) -> dict[int, Decimal]:
    """Mercadería cruda tirada (positivo) en [desde, hasta]."""
    return _salidas_por_ingrediente(TipoMovimiento.MERMA, desde, hasta)


def semana_pasada(hoy: date) -> tuple[date, date]:
    """Lunes a domingo de la semana calendario anterior."""
    lunes_actual = hoy - timedelta(days=hoy.weekday())
    return lunes_actual - timedelta(days=7), lunes_actual - timedelta(days=1)


def _en_unidad(ingrediente: Ingrediente, cantidad_base: Decimal) -> float:
    return round(float(ingrediente.unidad_preferida.desde_base(cantidad_base)), 3)


def calcular_alertas(hoy: date) -> list[dict]:
    ingredientes = list(Ingrediente.objects.filter(activo=True).select_related("unidad_preferida"))
    stocks = stocks_actuales(hoy)
    sp_desde, sp_hasta = semana_pasada(hoy)
    consumo_sp = consumo_por_ingrediente(sp_desde, sp_hasta)
    merma_sp = merma_por_ingrediente(sp_desde, sp_hasta)
    consumo_7d = consumo_por_ingrediente(hoy - timedelta(days=6), hoy)
    merma_7d = merma_por_ingrediente(hoy - timedelta(days=6), hoy)

    alertas = []
    for ing in ingredientes:
        stock = stocks.get(ing.id, CERO)
        c_sp = consumo_sp.get(ing.id, CERO)
        m_sp = merma_sp.get(ing.id, CERO)
        # Lo que sale del stock incluye lo que se tira: hay que reponerlo igual.
        c_sp_total = c_sp + m_sp
        c_7d = consumo_7d.get(ing.id, CERO) + merma_7d.get(ing.id, CERO)
        diario = c_7d / 7 if c_7d > 0 else (c_sp_total / 7 if c_sp_total > 0 else CERO)
        cobertura = float(max(stock, CERO) / diario) if diario > 0 else None

        motivos = []
        if stock <= 0:
            motivos.append("Sin stock")
        elif ing.stock_minimo > 0 and stock <= ing.stock_minimo:
            motivos.append("Por debajo del stock mínimo")
        if stock > 0 and cobertura is not None and cobertura < DIAS_COBERTURA_ALERTA:
            motivos.append(f"Alcanza para menos de {DIAS_COBERTURA_ALERTA} días")
        # Ingredientes sin uso ni mínimo configurado y sin stock no molestan.
        if motivos == ["Sin stock"] and c_sp_total == 0 and c_7d == 0 and ing.stock_minimo == 0:
            continue
        if not motivos:
            continue

        # Sugerencia: cubrir una semana como la pasada + volver al mínimo.
        referencia = max(c_sp_total, c_7d)
        sugerido = max(referencia + ing.stock_minimo - max(stock, CERO), CERO)

        alertas.append(
            {
                "ingrediente_id": ing.id,
                "ingrediente": ing.nombre,
                "unidad": ing.unidad_preferida.simbolo,
                "nivel": "critico" if stock <= 0 or (cobertura is not None and cobertura < 1) else "bajo",
                "motivos": motivos,
                "stock_actual": _en_unidad(ing, stock),
                "stock_minimo": _en_unidad(ing, ing.stock_minimo),
                "consumo_semana_pasada": _en_unidad(ing, c_sp),
                "merma_semana_pasada": _en_unidad(ing, m_sp),
                "semana_pasada": {"desde": sp_desde, "hasta": sp_hasta},
                "salida_ultimos_7_dias": _en_unidad(ing, c_7d),
                "dias_cobertura": round(cobertura, 1) if cobertura is not None else None,
                "compra_sugerida": _en_unidad(ing, sugerido),
            }
        )
    alertas.sort(key=lambda a: (a["nivel"] != "critico", a["dias_cobertura"] or 0))
    return alertas


def _clave_periodo(f: date, agrupar: str) -> date:
    if agrupar == "semana":
        return f - timedelta(days=f.weekday())
    if agrupar == "mes":
        return f.replace(day=1)
    return f


def _periodos(desde: date, hasta: date, agrupar: str) -> list[date]:
    claves, f = [], desde
    while f <= hasta:
        k = _clave_periodo(f, agrupar)
        if not claves or claves[-1] != k:
            claves.append(k)
        f += timedelta(days=1)
    return claves


def consumo_agrupado(desde: date, hasta: date, agrupar: str, ingrediente_ids=None) -> dict:
    """Consumo por ingrediente y período (día/semana/mes), en unidad preferida."""
    filtro = Q(tipo=TipoMovimiento.PRODUCCION, fecha__gte=desde, fecha__lte=hasta)
    if ingrediente_ids:
        filtro &= Q(ingrediente_id__in=ingrediente_ids)
    filas = (
        MovimientoStock.objects.filter(filtro)
        .values("ingrediente_id", "fecha")
        .annotate(t=Sum("cantidad_base"))
    )
    acumulado = defaultdict(lambda: defaultdict(lambda: CERO))
    for r in filas:
        acumulado[r["ingrediente_id"]][_clave_periodo(r["fecha"], agrupar)] += -r["t"]

    periodos = _periodos(desde, hasta, agrupar)
    ingredientes = Ingrediente.objects.filter(id__in=acumulado.keys()).select_related("unidad_preferida")
    dias = (hasta - desde).days + 1
    series = []
    for ing in ingredientes:
        valores = acumulado[ing.id]
        total = sum(valores.values(), CERO)
        series.append(
            {
                "ingrediente_id": ing.id,
                "ingrediente": ing.nombre,
                "unidad": ing.unidad_preferida.simbolo,
                "total": _en_unidad(ing, total),
                "promedio_diario": _en_unidad(ing, total / dias),
                "promedio_semanal": _en_unidad(ing, total / dias * 7),
                "valores": [_en_unidad(ing, valores.get(p, CERO)) for p in periodos],
            }
        )
    series.sort(key=lambda s: s["ingrediente"])
    return {"desde": desde, "hasta": hasta, "agrupar": agrupar, "periodos": periodos, "series": series}


def ventas_por_plato(desde: date, hasta: date) -> list[dict]:
    filas = (
        RegistroProduccion.objects.filter(fecha__gte=desde, fecha__lte=hasta)
        .values("plato_id", "plato__nombre")
        .annotate(cocinados=Sum("cocinados"), vendidos=Sum("vendidos"), descartados=Sum("descartados"))
        .order_by("-vendidos")
    )
    resultado = []
    for r in filas:
        coc, ven, desc = r["cocinados"] or 0, r["vendidos"] or 0, r["descartados"] or 0
        salieron = ven + desc
        resultado.append(
            {
                "plato_id": r["plato_id"],
                "plato": r["plato__nombre"],
                "cocinados": coc,
                "vendidos": ven,
                "descartados": desc,
                # De todas las porciones que salieron de la cocina, cuántas se tiraron.
                "porcentaje_descartado": round(desc / salieron * 100, 1) if salieron else None,
            }
        )
    return resultado


def resumen_mermas(desde: date, hasta: date) -> dict:
    """Todo lo que se tiró en el período:
    - mercadería cruda (mermas cargadas a mano), por ingrediente y motivo;
    - platos tirados, por plato;
    - la mercadería que había adentro de esos platos tirados, calculada con la
      receta que se usó ese día (los movimientos de producción guardados).
    """
    # 1) Mercadería cruda
    mermas = Merma.objects.filter(fecha__gte=desde, fecha__lte=hasta).select_related(
        "ingrediente__unidad_preferida"
    )
    cruda = defaultdict(lambda: {"total": CERO, "motivos": defaultdict(lambda: CERO)})
    ingredientes = {}
    for m in mermas:
        ingredientes[m.ingrediente_id] = m.ingrediente
        cruda[m.ingrediente_id]["total"] += m.cantidad_base
        cruda[m.ingrediente_id]["motivos"][m.motivo] += m.cantidad_base

    # 2) y 3) Platos tirados y su mercadería
    registros = (
        RegistroProduccion.objects.filter(fecha__gte=desde, fecha__lte=hasta, descartados__gt=0)
        .select_related("plato")
        .prefetch_related("movimientos__ingrediente__unidad_preferida")
    )
    en_platos = defaultdict(lambda: CERO)
    for reg in registros:
        porciones = porciones_descontadas(reg)
        if not porciones:
            continue
        fraccion = Decimal(reg.descartados) / Decimal(porciones)
        for mov in reg.movimientos.all():
            ingredientes[mov.ingrediente_id] = mov.ingrediente
            en_platos[mov.ingrediente_id] += -mov.cantidad_base * fraccion

    filas = []
    for ing_id, ing in ingredientes.items():
        c = cruda.get(ing_id)
        cruda_total = c["total"] if c else CERO
        en_plato = en_platos.get(ing_id, CERO)
        filas.append(
            {
                "ingrediente_id": ing_id,
                "ingrediente": ing.nombre,
                "unidad": ing.unidad_preferida.simbolo,
                "cruda": _en_unidad(ing, cruda_total),
                "en_platos_tirados": _en_unidad(ing, en_plato),
                "total": _en_unidad(ing, cruda_total + en_plato),
                "motivos": [
                    {"motivo": k, "motivo_display": MotivoMerma(k).label, "cantidad": _en_unidad(ing, v)}
                    for k, v in sorted(c["motivos"].items(), key=lambda kv: -kv[1])
                ]
                if c
                else [],
            }
        )
    filas.sort(key=lambda f: f["ingrediente"])

    platos = [p for p in ventas_por_plato(desde, hasta) if p["descartados"] > 0]
    platos.sort(key=lambda p: -p["descartados"])
    return {
        "desde": desde,
        "hasta": hasta,
        "ingredientes": filas,
        "platos": platos,
        "porciones_tiradas": sum(p["descartados"] for p in platos),
        "registros_merma": mermas.count(),
    }


def historial_stock(ingrediente: Ingrediente, desde: date, hasta: date) -> dict:
    """Stock al cierre de cada día del rango + movimientos del rango."""
    inicial = stock_a_fecha(ingrediente, desde - timedelta(days=1))
    movs = list(
        ingrediente.movimientos.filter(fecha__gte=desde, fecha__lte=hasta).order_by("fecha", "id")
    )
    por_dia = defaultdict(lambda: CERO)
    for m in movs:
        por_dia[m.fecha] += m.cantidad_base

    serie, saldo, f = [], inicial, desde
    while f <= hasta:
        saldo += por_dia.get(f, CERO)
        serie.append({"fecha": f, "stock": _en_unidad(ingrediente, saldo)})
        f += timedelta(days=1)

    return {
        "ingrediente_id": ingrediente.id,
        "ingrediente": ingrediente.nombre,
        "unidad": ingrediente.unidad_preferida.simbolo,
        "stock_inicial": _en_unidad(ingrediente, inicial),
        "serie": serie,
        "movimientos": [
            {
                "id": m.id,
                "fecha": m.fecha,
                "tipo": m.tipo,
                "tipo_display": m.get_tipo_display(),
                "cantidad": _en_unidad(ingrediente, m.cantidad_base),
                "nota": m.nota,
            }
            for m in reversed(movs)
        ],
    }
