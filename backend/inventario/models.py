"""
Modelo de datos.

Idea central: el stock NUNCA se guarda como un número que se pisa. Cada compra,
producción o ajuste genera filas en `MovimientoStock` (positivas o negativas).
El stock de un ingrediente a cualquier fecha es la suma de sus movimientos hasta
esa fecha, así el historial de días anteriores queda intacto.

Todas las cantidades se guardan también en la unidad BASE de su dimensión
(g para masa, ml para volumen, u para unidades), para poder sumar sin importar
si se cargó en kg, g, litros, etc.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models


class Dimension(models.TextChoices):
    MASA = "masa", "Masa (base: g)"
    VOLUMEN = "volumen", "Volumen (base: ml)"
    UNIDAD = "unidad", "Unidades (base: u)"


class UnidadMedida(models.Model):
    """Unidad de medida configurable. `factor` convierte a la unidad base:
    cantidad_base = cantidad * factor (ej.: kg -> factor 1000)."""

    simbolo = models.CharField(max_length=20, unique=True)
    nombre = models.CharField(max_length=60)
    dimension = models.CharField(max_length=10, choices=Dimension.choices)
    factor = models.DecimalField(max_digits=14, decimal_places=6)

    class Meta:
        ordering = ["dimension", "factor"]
        verbose_name = "unidad de medida"
        verbose_name_plural = "unidades de medida"

    def __str__(self):
        return self.simbolo

    def clean(self):
        if self.factor is not None and self.factor <= 0:
            raise ValidationError({"factor": "El factor debe ser mayor a 0."})

    def a_base(self, cantidad) -> Decimal:
        return Decimal(cantidad) * self.factor

    def desde_base(self, cantidad_base) -> Decimal:
        return Decimal(cantidad_base) / self.factor


class Ingrediente(models.Model):
    """Mercadería / insumo."""

    nombre = models.CharField(max_length=120, unique=True)
    dimension = models.CharField(max_length=10, choices=Dimension.choices)
    unidad_preferida = models.ForeignKey(
        UnidadMedida,
        on_delete=models.PROTECT,
        related_name="+",
        help_text="Unidad en la que se muestra el stock (ej.: kg).",
    )
    stock_minimo = models.DecimalField(
        max_digits=14,
        decimal_places=3,
        default=0,
        help_text="Umbral de alerta, en unidad base.",
    )
    activo = models.BooleanField(default=True)
    notas = models.TextField(blank=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre

    def clean(self):
        if self.unidad_preferida_id and self.unidad_preferida.dimension != self.dimension:
            raise ValidationError(
                {"unidad_preferida": "La unidad no corresponde a la dimensión del ingrediente."}
            )


class Plato(models.Model):
    nombre = models.CharField(max_length=120, unique=True)
    descripcion = models.TextField(blank=True)
    precio_venta = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


def _validar_unidad(ingrediente, unidad):
    if ingrediente and unidad and ingrediente.dimension != unidad.dimension:
        raise ValidationError(
            f"La unidad '{unidad.simbolo}' no sirve para '{ingrediente.nombre}' "
            f"({ingrediente.get_dimension_display()})."
        )


class PlatoIngrediente(models.Model):
    """Receta: cantidad promedio de un ingrediente por porción del plato."""

    plato = models.ForeignKey(Plato, on_delete=models.CASCADE, related_name="ingredientes")
    ingrediente = models.ForeignKey(Ingrediente, on_delete=models.PROTECT, related_name="en_platos")
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    unidad = models.ForeignKey(UnidadMedida, on_delete=models.PROTECT, related_name="+")
    cantidad_base = models.DecimalField(max_digits=14, decimal_places=3, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["plato", "ingrediente"], name="uniq_plato_ingrediente"),
        ]

    def __str__(self):
        return f"{self.plato}: {self.cantidad} {self.unidad} de {self.ingrediente}"

    def clean(self):
        _validar_unidad(self.ingrediente, self.unidad)

    def save(self, *args, **kwargs):
        self.cantidad_base = self.unidad.a_base(self.cantidad)
        super().save(*args, **kwargs)


class Compra(models.Model):
    fecha = models.DateField()
    proveedor = models.CharField(max_length=120, blank=True)
    notas = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"Compra {self.fecha} {self.proveedor}".strip()


class CompraItem(models.Model):
    compra = models.ForeignKey(Compra, on_delete=models.CASCADE, related_name="items")
    ingrediente = models.ForeignKey(Ingrediente, on_delete=models.PROTECT, related_name="compras")
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    unidad = models.ForeignKey(UnidadMedida, on_delete=models.PROTECT, related_name="+")
    cantidad_base = models.DecimalField(max_digits=14, decimal_places=3, editable=False)
    costo_total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    def clean(self):
        _validar_unidad(self.ingrediente, self.unidad)

    def save(self, *args, **kwargs):
        self.cantidad_base = self.unidad.a_base(self.cantidad)
        super().save(*args, **kwargs)


class RegistroProduccion(models.Model):
    """Porciones de un plato vendidas y tiradas en un día.

    Lo vendido y lo tirado descuentan del stock los ingredientes de la receta.
    `cocinados` es opcional y sólo de referencia: no mueve mercadería.
    """

    fecha = models.DateField()
    plato = models.ForeignKey(Plato, on_delete=models.PROTECT, related_name="registros")
    cocinados = models.PositiveIntegerField(default=0, help_text="Sólo de referencia.")
    vendidos = models.PositiveIntegerField(default=0)
    descartados = models.PositiveIntegerField(
        default=0, help_text="Porciones que se prepararon y se tiraron."
    )
    notas = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-fecha", "plato__nombre"]
        constraints = [
            models.UniqueConstraint(fields=["fecha", "plato"], name="uniq_produccion_fecha_plato"),
        ]

    def __str__(self):
        return (
            f"{self.fecha} {self.plato}: {self.cocinados} cocinados / "
            f"{self.vendidos} vendidos / {self.descartados} tirados"
        )


class MotivoMerma(models.TextChoices):
    VENCIDO = "vencido", "Vencido"
    MAL_ESTADO = "mal_estado", "En mal estado"
    ROTURA = "rotura", "Se cayó / se rompió"
    ERROR = "error", "Error de preparación"
    OTRO = "otro", "Otro"


class Merma(models.Model):
    """Mercadería cruda que se tiró (no llegó a usarse en un plato)."""

    fecha = models.DateField()
    ingrediente = models.ForeignKey(Ingrediente, on_delete=models.PROTECT, related_name="mermas")
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    unidad = models.ForeignKey(UnidadMedida, on_delete=models.PROTECT, related_name="+")
    cantidad_base = models.DecimalField(max_digits=14, decimal_places=3, editable=False)
    motivo = models.CharField(max_length=12, choices=MotivoMerma.choices, default=MotivoMerma.MAL_ESTADO)
    nota = models.CharField(max_length=255, blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"{self.fecha} merma {self.cantidad} {self.unidad} de {self.ingrediente}"

    def clean(self):
        _validar_unidad(self.ingrediente, self.unidad)

    def save(self, *args, **kwargs):
        self.cantidad_base = self.unidad.a_base(self.cantidad)
        super().save(*args, **kwargs)


class TipoMovimiento(models.TextChoices):
    COMPRA = "compra", "Compra"
    PRODUCCION = "produccion", "Producción"
    MERMA = "merma", "Merma"
    AJUSTE = "ajuste", "Ajuste por conteo"


class MovimientoStock(models.Model):
    """Libro de movimientos. cantidad_base > 0 entra, < 0 sale."""

    ingrediente = models.ForeignKey(Ingrediente, on_delete=models.CASCADE, related_name="movimientos")
    fecha = models.DateField(db_index=True)
    tipo = models.CharField(max_length=12, choices=TipoMovimiento.choices)
    cantidad_base = models.DecimalField(max_digits=14, decimal_places=3)
    compra_item = models.ForeignKey(
        CompraItem, on_delete=models.CASCADE, null=True, blank=True, related_name="movimientos"
    )
    registro = models.ForeignKey(
        RegistroProduccion, on_delete=models.CASCADE, null=True, blank=True, related_name="movimientos"
    )
    merma = models.ForeignKey(
        Merma, on_delete=models.CASCADE, null=True, blank=True, related_name="movimientos"
    )
    nota = models.CharField(max_length=255, blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha", "-id"]
        indexes = [models.Index(fields=["ingrediente", "fecha"])]

    def __str__(self):
        return f"{self.fecha} {self.tipo} {self.ingrediente}: {self.cantidad_base}"
