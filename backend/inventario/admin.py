from django.contrib import admin

from . import services
from .models import (
    Compra,
    CompraItem,
    Ingrediente,
    Merma,
    MovimientoStock,
    Plato,
    PlatoIngrediente,
    RegistroProduccion,
    UnidadMedida,
)


@admin.register(UnidadMedida)
class UnidadMedidaAdmin(admin.ModelAdmin):
    list_display = ["simbolo", "nombre", "dimension", "factor"]


@admin.register(Ingrediente)
class IngredienteAdmin(admin.ModelAdmin):
    list_display = ["nombre", "dimension", "unidad_preferida", "stock_minimo", "activo"]
    list_filter = ["dimension", "activo"]
    search_fields = ["nombre"]


class PlatoIngredienteInline(admin.TabularInline):
    model = PlatoIngrediente
    extra = 1


@admin.register(Plato)
class PlatoAdmin(admin.ModelAdmin):
    list_display = ["nombre", "precio_venta", "activo"]
    inlines = [PlatoIngredienteInline]


class CompraItemInline(admin.TabularInline):
    model = CompraItem
    extra = 1


@admin.register(Compra)
class CompraAdmin(admin.ModelAdmin):
    list_display = ["fecha", "proveedor"]
    inlines = [CompraItemInline]

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        services.sincronizar_compra(form.instance)


@admin.register(RegistroProduccion)
class RegistroProduccionAdmin(admin.ModelAdmin):
    list_display = ["fecha", "plato", "cocinados", "vendidos", "descartados"]
    list_filter = ["fecha", "plato"]

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        services.sincronizar_produccion(obj)


@admin.register(Merma)
class MermaAdmin(admin.ModelAdmin):
    list_display = ["fecha", "ingrediente", "cantidad", "unidad", "motivo", "nota"]
    list_filter = ["motivo", "ingrediente"]

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        services.sincronizar_merma(obj)


@admin.register(MovimientoStock)
class MovimientoStockAdmin(admin.ModelAdmin):
    list_display = ["fecha", "ingrediente", "tipo", "cantidad_base", "nota"]
    list_filter = ["tipo", "ingrediente"]
