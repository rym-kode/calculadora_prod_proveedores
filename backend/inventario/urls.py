from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("unidades", views.UnidadMedidaViewSet)
router.register("ingredientes", views.IngredienteViewSet, basename="ingrediente")
router.register("platos", views.PlatoViewSet, basename="plato")
router.register("compras", views.CompraViewSet, basename="compra")
router.register("mermas", views.MermaViewSet, basename="merma")
router.register("produccion", views.RegistroProduccionViewSet, basename="produccion")
router.register("movimientos", views.MovimientoStockViewSet, basename="movimiento")

urlpatterns = [
    path("alertas/", views.alertas, name="alertas"),
    path("resumen/", views.resumen, name="resumen"),
    path("insights/consumo/", views.insight_consumo, name="insight-consumo"),
    path("insights/ventas/", views.insight_ventas, name="insight-ventas"),
    path("insights/mermas/", views.insight_mermas, name="insight-mermas"),
    path("", include(router.urls)),
]
