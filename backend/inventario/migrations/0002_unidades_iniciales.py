from decimal import Decimal

from django.db import migrations

UNIDADES = [
    ("g", "gramo", "masa", "1"),
    ("kg", "kilogramo", "masa", "1000"),
    ("ml", "mililitro", "volumen", "1"),
    ("l", "litro", "volumen", "1000"),
    ("u", "unidad", "unidad", "1"),
    ("doc", "docena", "unidad", "12"),
]


def crear(apps, schema_editor):
    UnidadMedida = apps.get_model("inventario", "UnidadMedida")
    for simbolo, nombre, dimension, factor in UNIDADES:
        UnidadMedida.objects.get_or_create(
            simbolo=simbolo,
            defaults={"nombre": nombre, "dimension": dimension, "factor": Decimal(factor)},
        )


class Migration(migrations.Migration):
    dependencies = [("inventario", "0001_initial")]
    operations = [migrations.RunPython(crear, migrations.RunPython.noop)]
