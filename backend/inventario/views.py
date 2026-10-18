from datetime import date, timedelta
from decimal import Decimal

from django.db.models import DecimalField, ProtectedError, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from . import services
from .models import (
    Compra,
    Ingrediente,
    Merma,
    MovimientoStock,
    Plato,
    RegistroProduccion,
    UnidadMedida,
)
from .serializers import (
    AjusteSerializer,
    CompraSerializer,
    IngredienteSerializer,
    MermaSerializer,
    MovimientoStockSerializer,
    PlatoSerializer,
    ProduccionDiaSerializer,
    RegistroProduccionSerializer,
    UnidadMedidaSerializer,
)


def _hoy() -> date:
    return timezone.localdate()


def _fecha(request, nombre, default):
    valor = request.query_params.get(nombre)
    if not valor:
        return default
    try:
        return date.fromisoformat(valor)
    except ValueError:
        return None


def _rango(request, dias_default=28):
    hoy = _hoy()
    hasta = _fecha(request, "hasta", hoy)
    desde = _fecha(request, "desde", (hasta or hoy) - timedelta(days=dias_default - 1))
    if desde is None or hasta is None:
        return None, None, Response({"detail": "Fecha inválida, usar AAAA-MM-DD."}, status=400)
    if desde > hasta:
        return None, None, Response({"detail": "'desde' no puede ser posterior a 'hasta'."}, status=400)
    if (hasta - desde).days > 730:
        return None, None, Response({"detail": "El rango máximo es de 2 años."}, status=400)
    return desde, hasta, None


class ProtegidoMixin:
    """Devuelve un 409 legible en vez de un 500 cuando algo está en uso."""

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {"detail": "No se puede borrar porque está en uso. Podés desactivarlo."},
                status=status.HTTP_409_CONFLICT,
            )


class UnidadMedidaViewSet(ProtegidoMixin, viewsets.ModelViewSet):
    queryset = UnidadMedida.objects.all()
    serializer_class = UnidadMedidaSerializer
    pagination_class = None


class IngredienteViewSet(ProtegidoMixin, viewsets.ModelViewSet):
    serializer_class = IngredienteSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Ingrediente.objects.select_related("unidad_preferida").annotate(
            stock_base=Coalesce(
                Sum("movimientos__cantidad_base"),
                Value(Decimal("0")),
                output_field=DecimalField(max_digits=14, decimal_places=3),
            )
        )
        if self.request.query_params.get("activos") == "1":
            qs = qs.filter(activo=True)
        return qs

    @action(detail=True, methods=["get"])
    def historial(self, request, pk=None):
        desde, hasta, error = _rango(request, dias_default=30)
        if error:
            return error
        return Response(services.historial_stock(self.get_object(), desde, hasta))

    @action(detail=False, methods=["post"])
    def ajuste(self, request):
        s = AjusteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        mov = services.ajustar_stock(
            d["ingrediente"], d["fecha"], d["unidad"].a_base(d["stock_real"]), d["nota"]
        )
        if mov is None:
            return Response({"detail": "El stock ya coincidía, no se registró ajuste."})
        return Response(MovimientoStockSerializer(mov).data, status=status.HTTP_201_CREATED)


class PlatoViewSet(ProtegidoMixin, viewsets.ModelViewSet):
    serializer_class = PlatoSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Plato.objects.prefetch_related(
            "ingredientes__ingrediente", "ingredientes__unidad"
        )
        if self.request.query_params.get("activos") == "1":
            qs = qs.filter(activo=True)
        return qs


class CompraViewSet(viewsets.ModelViewSet):
    serializer_class = CompraSerializer

    def get_queryset(self):
        qs = Compra.objects.prefetch_related("items__ingrediente", "items__unidad")
        desde = _fecha(self.request, "desde", None)
        hasta = _fecha(self.request, "hasta", None)
        if desde:
            qs = qs.filter(fecha__gte=desde)
        if hasta:
            qs = qs.filter(fecha__lte=hasta)
        return qs


class RegistroProduccionViewSet(ProtegidoMixin, viewsets.ModelViewSet):
    serializer_class = RegistroProduccionSerializer
    pagination_class = None

    def get_queryset(self):
        qs = RegistroProduccion.objects.select_related("plato")
        fecha = _fecha(self.request, "fecha", None)
        desde = _fecha(self.request, "desde", None)
        hasta = _fecha(self.request, "hasta", None)
        if fecha:
            qs = qs.filter(fecha=fecha)
        if desde:
            qs = qs.filter(fecha__gte=desde)
        if hasta:
            qs = qs.filter(fecha__lte=hasta)
        if self.request.query_params.get("con_descartados") == "1":
            qs = qs.filter(descartados__gt=0)
        return qs

    @action(detail=False, methods=["post"])
    def dia(self, request):
        s = ProduccionDiaSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        registros = s.save()
        return Response(RegistroProduccionSerializer(registros, many=True).data)


class MermaViewSet(viewsets.ModelViewSet):
    serializer_class = MermaSerializer

    def get_queryset(self):
        qs = Merma.objects.select_related("ingrediente", "unidad")
        desde = _fecha(self.request, "desde", None)
        hasta = _fecha(self.request, "hasta", None)
        if desde:
            qs = qs.filter(fecha__gte=desde)
        if hasta:
            qs = qs.filter(fecha__lte=hasta)
        if self.request.query_params.get("ingrediente"):
            qs = qs.filter(ingrediente_id=self.request.query_params["ingrediente"])
        return qs


class MovimientoStockViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MovimientoStockSerializer

    def get_queryset(self):
        qs = MovimientoStock.objects.select_related("ingrediente__unidad_preferida")
        p = self.request.query_params
        if p.get("ingrediente"):
            qs = qs.filter(ingrediente_id=p["ingrediente"])
        if p.get("tipo"):
            qs = qs.filter(tipo=p["tipo"])
        return qs


@api_view(["GET"])
def alertas(request):
    hoy = _fecha(request, "fecha", _hoy())
    if hoy is None:
        return Response({"detail": "Fecha inválida."}, status=400)
    return Response(services.calcular_alertas(hoy))


@api_view(["GET"])
def insight_consumo(request):
    desde, hasta, error = _rango(request)
    if error:
        return error
    agrupar = request.query_params.get("agrupar", "semana")
    if agrupar not in ("dia", "semana", "mes"):
        return Response({"detail": "agrupar debe ser dia, semana o mes."}, status=400)
    ids = [int(i) for i in request.query_params.getlist("ingrediente") if i.isdigit()]
    return Response(services.consumo_agrupado(desde, hasta, agrupar, ids or None))


@api_view(["GET"])
def insight_ventas(request):
    desde, hasta, error = _rango(request)
    if error:
        return error
    return Response({"desde": desde, "hasta": hasta, "platos": services.ventas_por_plato(desde, hasta)})


@api_view(["GET"])
def insight_mermas(request):
    desde, hasta, error = _rango(request)
    if error:
        return error
    return Response(services.resumen_mermas(desde, hasta))


@api_view(["GET"])
def resumen(request):
    hoy = _hoy()
    alertas_hoy = services.calcular_alertas(hoy)
    produccion_hoy = RegistroProduccion.objects.filter(fecha=hoy).aggregate(
        cocinados=Coalesce(Sum("cocinados"), 0),
        vendidos=Coalesce(Sum("vendidos"), 0),
        descartados=Coalesce(Sum("descartados"), 0),
    )
    mermas_sp = services.resumen_mermas(*services.semana_pasada(hoy))
    sp_desde, sp_hasta = services.semana_pasada(hoy)
    return Response(
        {
            "fecha": hoy,
            "alertas_criticas": sum(1 for a in alertas_hoy if a["nivel"] == "critico"),
            "alertas_total": len(alertas_hoy),
            "ingredientes_activos": Ingrediente.objects.filter(activo=True).count(),
            "platos_activos": Plato.objects.filter(activo=True).count(),
            "produccion_hoy": produccion_hoy,
            "produccion_cargada_hoy": RegistroProduccion.objects.filter(fecha=hoy).exists(),
            "compras_ultimos_7_dias": Compra.objects.filter(fecha__gte=hoy - timedelta(days=6)).count(),
            "ventas_semana_pasada": services.ventas_por_plato(sp_desde, sp_hasta)[:5],
            "porciones_tiradas_semana_pasada": mermas_sp["porciones_tiradas"],
            "mermas_semana_pasada": mermas_sp["registros_merma"],
        }
    )
