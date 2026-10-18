"""Carga datos de ejemplo (3 semanas) para probar la app.

    python manage.py cargar_demo           # agrega datos demo
    python manage.py cargar_demo --borrar  # borra todo lo cargado antes
"""

import random
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from inventario import services
from inventario.models import (
    Compra,
    CompraItem,
    Ingrediente,
    Merma,
    MotivoMerma,
    Plato,
    PlatoIngrediente,
    RegistroProduccion,
    UnidadMedida,
)

INGREDIENTES = [
    # nombre, dimension, unidad preferida, stock mínimo (en esa unidad)
    ("Papa", "masa", "kg", 8),
    ("Cebolla", "masa", "kg", 4),
    ("Carne picada", "masa", "kg", 5),
    ("Pollo", "masa", "kg", 6),
    ("Harina", "masa", "kg", 3),
    ("Queso muzzarella", "masa", "kg", 2),
    ("Aceite", "volumen", "l", 3),
    ("Leche", "volumen", "l", 2),
    ("Huevo", "unidad", "u", 24),
]

PLATOS = {
    "Empanadas de carne (docena)": [("Carne picada", 400, "g"), ("Cebolla", 200, "g"), ("Harina", 350, "g"), ("Huevo", 2, "u"), ("Aceite", 30, "ml")],
    "Tortilla de papa": [("Papa", 600, "g"), ("Cebolla", 150, "g"), ("Huevo", 5, "u"), ("Aceite", 80, "ml")],
    "Milanesa de pollo con puré": [("Pollo", 220, "g"), ("Huevo", 1, "u"), ("Harina", 40, "g"), ("Papa", 250, "g"), ("Leche", 50, "ml"), ("Aceite", 40, "ml")],
    "Pastel de papa": [("Carne picada", 200, "g"), ("Papa", 300, "g"), ("Cebolla", 80, "g"), ("Leche", 40, "ml"), ("Queso muzzarella", 40, "g")],
}

class Command(BaseCommand):
    help = "Carga datos de ejemplo para probar la app."

    def add_arguments(self, parser):
        parser.add_argument("--borrar", action="store_true", help="Borra todos los datos cargados.")

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["borrar"]:
            RegistroProduccion.objects.all().delete()
            Merma.objects.all().delete()
            Compra.objects.all().delete()
            PlatoIngrediente.objects.all().delete()
            Plato.objects.all().delete()
            Ingrediente.objects.all().delete()
            self.stdout.write(self.style.SUCCESS("Datos borrados."))
            return

        random.seed(42)
        u = {x.simbolo: x for x in UnidadMedida.objects.all()}
        ing = {}
        for nombre, dim, unidad, minimo in INGREDIENTES:
            ing[nombre], _ = Ingrediente.objects.get_or_create(
                nombre=nombre,
                defaults={"dimension": dim, "unidad_preferida": u[unidad], "stock_minimo": u[unidad].a_base(minimo)},
            )
        platos = []
        for nombre, receta in PLATOS.items():
            plato, creado = Plato.objects.get_or_create(nombre=nombre)
            if creado:
                for i_nombre, cant, unidad in receta:
                    PlatoIngrediente.objects.create(plato=plato, ingrediente=ing[i_nombre], cantidad=Decimal(cant), unidad=u[unidad])
            platos.append(plato)

        hoy = timezone.localdate()
        inicio = hoy - timedelta(days=21)
        dia = inicio
        while dia < hoy:
            if dia.weekday() != 6:  # cerrado los domingos
                for plato in platos:
                    cocinados = random.randint(6, 14)
                    vendidos = cocinados - random.randint(0, 2)
                    # A veces lo que sobra se tira al cierre
                    descartados = (cocinados - vendidos) if random.random() < 0.35 else 0
                    reg, _ = RegistroProduccion.objects.update_or_create(
                        fecha=dia, plato=plato,
                        defaults={"cocinados": cocinados, "vendidos": vendidos, "descartados": descartados},
                    )
                    services.sincronizar_produccion(reg)
            dia += timedelta(days=1)

        # Algunas mermas de mercadería cruda
        for dias_atras, nombre, cant, unidad, motivo, nota in [
            (19, "Cebolla", 800, "g", MotivoMerma.MAL_ESTADO, "Venían golpeadas"),
            (15, "Leche", 1, "l", MotivoMerma.VENCIDO, ""),
            (12, "Huevo", 6, "u", MotivoMerma.ROTURA, "Se cayó la maple"),
            (8, "Papa", 2, "kg", MotivoMerma.MAL_ESTADO, "Brotadas"),
            (6, "Pollo", 600, "g", MotivoMerma.VENCIDO, ""),
            (4, "Carne picada", 500, "g", MotivoMerma.ERROR, "Se quemó un relleno"),
            (2, "Queso muzzarella", 300, "g", MotivoMerma.MAL_ESTADO, "Con hongos"),
        ]:
            merma = Merma.objects.create(
                fecha=hoy - timedelta(days=dias_atras), ingrediente=ing[nombre],
                cantidad=Decimal(cant), unidad=u[unidad], motivo=motivo, nota=nota,
            )
            services.sincronizar_merma(merma)

        # Una compra por semana que cubre ~lo consumido. La última semana se
        # compra menos a propósito para que aparezcan alertas.
        for semana in range(3):
            desde = inicio + timedelta(days=7 * semana)
            hasta = min(desde + timedelta(days=6), hoy)
            consumo = services.consumo_por_ingrediente(desde, hasta)
            for k, v in services.merma_por_ingrediente(desde, hasta).items():
                consumo[k] = consumo.get(k, Decimal("0")) + v
            factor = Decimal("0.85") if semana == 2 else Decimal("1.12")
            compra = Compra.objects.create(fecha=desde, proveedor="Mercado Central")
            for ingrediente in ing.values():
                base = consumo.get(ingrediente.id, Decimal("0")) * factor
                if base <= 0:
                    continue
                unidad = ingrediente.unidad_preferida
                cantidad = (base / unidad.factor).quantize(Decimal("1"))
                CompraItem.objects.create(compra=compra, ingrediente=ingrediente, cantidad=cantidad, unidad=unidad)
            services.sincronizar_compra(compra)

        self.stdout.write(self.style.SUCCESS(f"Demo cargada desde {inicio} hasta ayer."))
