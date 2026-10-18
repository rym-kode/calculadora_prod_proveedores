from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

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


def _check_unidad(ingrediente, unidad):
    if ingrediente.dimension != unidad.dimension:
        raise serializers.ValidationError(
            f"La unidad '{unidad.simbolo}' no sirve para '{ingrediente.nombre}' "
            f"({ingrediente.get_dimension_display()})."
        )


class UnidadMedidaSerializer(serializers.ModelSerializer):
    class Meta:
        model = UnidadMedida
        fields = ["id", "simbolo", "nombre", "dimension", "factor"]

    def validate_factor(self, v):
        if v <= 0:
            raise serializers.ValidationError("Debe ser mayor a 0.")
        return v


class IngredienteSerializer(serializers.ModelSerializer):
    """`stock_minimo` y `stock_actual` se exponen en la unidad preferida."""

    unidad_simbolo = serializers.CharField(source="unidad_preferida.simbolo", read_only=True)
    stock_actual = serializers.SerializerMethodField()
    stock_minimo = serializers.DecimalField(max_digits=14, decimal_places=3, required=False)

    class Meta:
        model = Ingrediente
        fields = [
            "id",
            "nombre",
            "dimension",
            "unidad_preferida",
            "unidad_simbolo",
            "stock_minimo",
            "stock_actual",
            "activo",
            "notas",
        ]

    def get_stock_actual(self, obj):
        base = getattr(obj, "stock_base", None)
        if base is None:
            base = services.stock_a_fecha(obj)
        return round(float(obj.unidad_preferida.desde_base(base)), 3)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        data["stock_minimo"] = round(float(obj.unidad_preferida.desde_base(obj.stock_minimo)), 3)
        return data

    def validate(self, attrs):
        dimension = attrs.get("dimension", getattr(self.instance, "dimension", None))
        unidad = attrs.get("unidad_preferida", getattr(self.instance, "unidad_preferida", None))
        if unidad and unidad.dimension != dimension:
            raise serializers.ValidationError(
                {"unidad_preferida": "La unidad no corresponde a la dimensión elegida."}
            )
        if self.instance and "dimension" in attrs and attrs["dimension"] != self.instance.dimension:
            if self.instance.movimientos.exists() or self.instance.en_platos.exists():
                raise serializers.ValidationError(
                    {"dimension": "No se puede cambiar la dimensión de un ingrediente ya usado."}
                )
        if "stock_minimo" in attrs:
            if attrs["stock_minimo"] < 0:
                raise serializers.ValidationError({"stock_minimo": "No puede ser negativo."})
            attrs["stock_minimo"] = unidad.a_base(attrs["stock_minimo"])
        return attrs


class PlatoIngredienteSerializer(serializers.ModelSerializer):
    ingrediente_nombre = serializers.CharField(source="ingrediente.nombre", read_only=True)
    unidad_simbolo = serializers.CharField(source="unidad.simbolo", read_only=True)

    class Meta:
        model = PlatoIngrediente
        fields = ["id", "ingrediente", "ingrediente_nombre", "cantidad", "unidad", "unidad_simbolo"]

    def validate(self, attrs):
        if attrs["cantidad"] <= 0:
            raise serializers.ValidationError({"cantidad": "Debe ser mayor a 0."})
        _check_unidad(attrs["ingrediente"], attrs["unidad"])
        return attrs


class PlatoSerializer(serializers.ModelSerializer):
    ingredientes = PlatoIngredienteSerializer(many=True)

    class Meta:
        model = Plato
        fields = ["id", "nombre", "descripcion", "precio_venta", "activo", "ingredientes"]

    def validate_ingredientes(self, items):
        ids = [i["ingrediente"].id for i in items]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Hay ingredientes repetidos en la receta.")
        return items

    def _guardar_receta(self, plato, items):
        plato.ingredientes.all().delete()
        for item in items:
            PlatoIngrediente.objects.create(plato=plato, **item)

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("ingredientes")
        plato = Plato.objects.create(**validated_data)
        self._guardar_receta(plato, items)
        return plato

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("ingredientes", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if items is not None:
            self._guardar_receta(instance, items)
        return instance


class CompraItemSerializer(serializers.ModelSerializer):
    ingrediente_nombre = serializers.CharField(source="ingrediente.nombre", read_only=True)
    unidad_simbolo = serializers.CharField(source="unidad.simbolo", read_only=True)

    class Meta:
        model = CompraItem
        fields = [
            "id",
            "ingrediente",
            "ingrediente_nombre",
            "cantidad",
            "unidad",
            "unidad_simbolo",
            "costo_total",
        ]

    def validate(self, attrs):
        if attrs["cantidad"] <= 0:
            raise serializers.ValidationError({"cantidad": "Debe ser mayor a 0."})
        _check_unidad(attrs["ingrediente"], attrs["unidad"])
        return attrs


class CompraSerializer(serializers.ModelSerializer):
    items = CompraItemSerializer(many=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = Compra
        fields = ["id", "fecha", "proveedor", "notas", "items", "total", "creado"]
        read_only_fields = ["creado"]

    def get_total(self, obj):
        costos = [i.costo_total for i in obj.items.all() if i.costo_total is not None]
        return float(sum(costos, Decimal("0"))) if costos else None

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError("La compra necesita al menos un ítem.")
        return items

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        compra = Compra.objects.create(**validated_data)
        for item in items:
            CompraItem.objects.create(compra=compra, **item)
        services.sincronizar_compra(compra)
        return compra

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if items is not None:
            instance.items.all().delete()
            for item in items:
                CompraItem.objects.create(compra=instance, **item)
        services.sincronizar_compra(instance)
        return instance


class RegistroProduccionSerializer(serializers.ModelSerializer):
    plato_nombre = serializers.CharField(source="plato.nombre", read_only=True)

    class Meta:
        model = RegistroProduccion
        fields = ["id", "fecha", "plato", "plato_nombre", "cocinados", "vendidos", "descartados", "notas"]

    def save(self, **kwargs):
        registro = super().save(**kwargs)
        services.sincronizar_produccion(registro)
        return registro


class ProduccionDiaItemSerializer(serializers.Serializer):
    plato = serializers.PrimaryKeyRelatedField(queryset=Plato.objects.all())
    cocinados = serializers.IntegerField(min_value=0, required=False, default=0)
    vendidos = serializers.IntegerField(min_value=0, required=False, default=0)
    descartados = serializers.IntegerField(min_value=0, required=False, default=0)
    notas = serializers.CharField(required=False, allow_blank=True, default="")


class ProduccionDiaSerializer(serializers.Serializer):
    """Carga completa de un día: crea/actualiza un registro por plato.
    Un plato con todo en 0 borra su registro de ese día."""

    fecha = serializers.DateField()
    registros = ProduccionDiaItemSerializer(many=True)

    def validate_registros(self, registros):
        ids = [r["plato"].id for r in registros]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Hay platos repetidos.")
        return registros

    @transaction.atomic
    def save(self):
        fecha = self.validated_data["fecha"]
        guardados = []
        for r in self.validated_data["registros"]:
            if r["cocinados"] == 0 and r["vendidos"] == 0 and r["descartados"] == 0:
                RegistroProduccion.objects.filter(fecha=fecha, plato=r["plato"]).delete()
                continue
            reg, _ = RegistroProduccion.objects.update_or_create(
                fecha=fecha,
                plato=r["plato"],
                defaults={
                    "cocinados": r["cocinados"],
                    "vendidos": r["vendidos"],
                    "descartados": r["descartados"],
                    "notas": r.get("notas", ""),
                },
            )
            services.sincronizar_produccion(reg)
            guardados.append(reg)
        return guardados


class MermaSerializer(serializers.ModelSerializer):
    ingrediente_nombre = serializers.CharField(source="ingrediente.nombre", read_only=True)
    unidad_simbolo = serializers.CharField(source="unidad.simbolo", read_only=True)
    motivo_display = serializers.CharField(source="get_motivo_display", read_only=True)

    class Meta:
        model = Merma
        fields = [
            "id",
            "fecha",
            "ingrediente",
            "ingrediente_nombre",
            "cantidad",
            "unidad",
            "unidad_simbolo",
            "motivo",
            "motivo_display",
            "nota",
            "creado",
        ]
        read_only_fields = ["creado"]

    def validate(self, attrs):
        cantidad = attrs.get("cantidad", getattr(self.instance, "cantidad", None))
        if cantidad is not None and cantidad <= 0:
            raise serializers.ValidationError({"cantidad": "Debe ser mayor a 0."})
        ingrediente = attrs.get("ingrediente", getattr(self.instance, "ingrediente", None))
        unidad = attrs.get("unidad", getattr(self.instance, "unidad", None))
        _check_unidad(ingrediente, unidad)
        return attrs

    @transaction.atomic
    def save(self, **kwargs):
        merma = super().save(**kwargs)
        services.sincronizar_merma(merma)
        return merma


class MovimientoStockSerializer(serializers.ModelSerializer):
    ingrediente_nombre = serializers.CharField(source="ingrediente.nombre", read_only=True)
    tipo_display = serializers.CharField(source="get_tipo_display", read_only=True)
    cantidad = serializers.SerializerMethodField()
    unidad = serializers.CharField(source="ingrediente.unidad_preferida.simbolo", read_only=True)

    class Meta:
        model = MovimientoStock
        fields = [
            "id",
            "fecha",
            "ingrediente",
            "ingrediente_nombre",
            "tipo",
            "tipo_display",
            "cantidad",
            "unidad",
            "nota",
        ]

    def get_cantidad(self, obj):
        return round(float(obj.ingrediente.unidad_preferida.desde_base(obj.cantidad_base)), 3)


class AjusteSerializer(serializers.Serializer):
    """Conteo físico: se informa cuánto hay realmente y se ajusta la diferencia."""

    ingrediente = serializers.PrimaryKeyRelatedField(queryset=Ingrediente.objects.all())
    fecha = serializers.DateField()
    stock_real = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=Decimal("0"))
    unidad = serializers.PrimaryKeyRelatedField(queryset=UnidadMedida.objects.all())
    nota = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        _check_unidad(attrs["ingrediente"], attrs["unidad"])
        return attrs
