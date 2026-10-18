from datetime import date, timedelta
from unittest.mock import patch


from rest_framework.test import APITestCase

from .models import Ingrediente, MovimientoStock, UnidadMedida

HOY = date(2026, 10, 15)  # jueves


class BaseInventario(APITestCase):
    """Papa, aceite, huevo y una tortilla que los usa."""

    def setUp(self):
        self.u = {u.simbolo: u.id for u in UnidadMedida.objects.all()}
        self.papa = self._ingrediente("Papa", "masa", "kg", 5)
        self.aceite = self._ingrediente("Aceite", "volumen", "l", 1)
        self.huevo = self._ingrediente("Huevo", "unidad", "u", 12)
        r = self.client.post(
            "/api/platos/",
            {
                "nombre": "Tortilla",
                "ingredientes": [
                    {"ingrediente": self.papa, "cantidad": "250", "unidad": self.u["g"]},
                    {"ingrediente": self.aceite, "cantidad": "50", "unidad": self.u["ml"]},
                    {"ingrediente": self.huevo, "cantidad": "2", "unidad": self.u["u"]},
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.tortilla = r.data["id"]

    def _ingrediente(self, nombre, dim, unidad, minimo):
        r = self.client.post(
            "/api/ingredientes/",
            {"nombre": nombre, "dimension": dim, "unidad_preferida": self.u[unidad], "stock_minimo": minimo},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        return r.data["id"]

    def _comprar(self, fecha, items):
        r = self.client.post(
            "/api/compras/",
            {"fecha": fecha.isoformat(), "proveedor": "Mercado Central", "items": items},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def _producir(self, fecha, cocinados, vendidos, descartados=0):
        r = self.client.post(
            "/api/produccion/dia/",
            {
                "fecha": fecha.isoformat(),
                "registros": [
                    {
                        "plato": self.tortilla,
                        "cocinados": cocinados,
                        "vendidos": vendidos,
                        "descartados": descartados,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)

    def _stock(self, ing_id):
        return self.client.get(f"/api/ingredientes/{ing_id}/").data["stock_actual"]

class FlujoCompletoTests(BaseInventario):
    def test_unidad_incompatible_rechazada(self):
        r = self.client.post(
            "/api/compras/",
            {
                "fecha": HOY.isoformat(),
                "items": [{"ingrediente": self.papa, "cantidad": "1", "unidad": self.u["l"]}],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_compra_suma_y_produccion_descuenta_con_conversion(self):
        self._comprar(
            HOY,
            [
                {"ingrediente": self.papa, "cantidad": "10", "unidad": self.u["kg"]},
                {"ingrediente": self.aceite, "cantidad": "2", "unidad": self.u["l"]},
                {"ingrediente": self.huevo, "cantidad": "3", "unidad": self.u["doc"]},
            ],
        )
        self.assertEqual(self._stock(self.papa), 10.0)
        self.assertEqual(self._stock(self.huevo), 36.0)

        self._producir(HOY, cocinados=10, vendidos=8)  # descuenta lo vendido, no lo cocinado
        self.assertEqual(self._stock(self.papa), 8.0)  # 10kg - 8*250g
        self.assertEqual(self._stock(self.aceite), 1.6)
        self.assertEqual(self._stock(self.huevo), 20.0)

        # Re-cargar el mismo día reemplaza, no duplica
        self._producir(HOY, cocinados=4, vendidos=4)
        self.assertEqual(self._stock(self.papa), 9.0)

    def test_historial_se_mantiene_al_cambiar_receta(self):
        d1 = HOY - timedelta(days=2)
        self._comprar(d1, [{"ingrediente": self.papa, "cantidad": "10", "unidad": self.u["kg"]}])
        self._producir(d1, 4, 4)  # -1kg
        # Cambiar la receta después no reescribe días anteriores
        self.client.patch(
            f"/api/platos/{self.tortilla}/",
            {"ingredientes": [{"ingrediente": self.papa, "cantidad": "500", "unidad": self.u["g"]}]},
            format="json",
        )
        self._producir(HOY, 2, 2)  # -1kg con la receta nueva
        r = self.client.get(
            f"/api/ingredientes/{self.papa}/historial/",
            {"desde": d1.isoformat(), "hasta": HOY.isoformat()},
        )
        serie = [p["stock"] for p in r.data["serie"]]
        self.assertEqual(serie, [9.0, 9.0, 8.0])

    def test_ajuste_por_conteo(self):
        self._comprar(HOY, [{"ingrediente": self.papa, "cantidad": "10", "unidad": self.u["kg"]}])
        r = self.client.post(
            "/api/ingredientes/ajuste/",
            {"ingrediente": self.papa, "fecha": HOY.isoformat(), "stock_real": "9.5", "unidad": self.u["kg"]},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["cantidad"], -0.5)
        self.assertEqual(self._stock(self.papa), 9.5)

    @patch("inventario.views._hoy", return_value=HOY)
    def test_alerta_informa_consumo_semana_pasada(self, _):
        lunes_pasado = date(2026, 10, 5)
        self._comprar(lunes_pasado, [{"ingrediente": self.papa, "cantidad": "12", "unidad": self.u["kg"]}])
        for i in range(7):  # 20 porciones/día x 250 g = 5 kg/día... semana pasada
            self._producir(lunes_pasado + timedelta(days=i), 4, 4)  # 1 kg/día -> 7 kg
        self._producir(HOY, 4, 4)  # 1 kg hoy -> quedan 4 kg (< mínimo 5)

        r = self.client.get("/api/alertas/")
        alerta = next(a for a in r.data if a["ingrediente"] == "Papa")
        self.assertEqual(alerta["stock_actual"], 4.0)
        self.assertEqual(alerta["consumo_semana_pasada"], 7.0)
        self.assertIn("Por debajo del stock mínimo", alerta["motivos"])
        self.assertEqual(alerta["compra_sugerida"], 8.0)  # 7 + 5 - 4
        # Huevo y aceite nunca se compraron pero tienen consumo -> sin stock
        self.assertTrue(any(a["ingrediente"] == "Huevo" and a["nivel"] == "critico" for a in r.data))

    def test_insights_consumo_y_ventas(self):
        lunes = date(2026, 10, 5)
        self._producir(lunes, 4, 3)
        self._producir(lunes + timedelta(days=7), 8, 8)
        r = self.client.get(
            "/api/insights/consumo/",
            {"desde": lunes.isoformat(), "hasta": (lunes + timedelta(days=13)).isoformat(), "agrupar": "semana"},
        )
        papa = next(s for s in r.data["series"] if s["ingrediente"] == "Papa")
        self.assertEqual(papa["valores"], [0.75, 2.0])  # sólo lo vendido
        self.assertEqual(papa["promedio_semanal"], 1.375)

        r = self.client.get(
            "/api/insights/ventas/",
            {"desde": lunes.isoformat(), "hasta": (lunes + timedelta(days=13)).isoformat()},
        )
        self.assertEqual(r.data["platos"][0]["cocinados"], 12)
        self.assertEqual(r.data["platos"][0]["vendidos"], 11)
        self.assertNotIn("sobrante", r.data["platos"][0])

    def test_no_borra_ingrediente_en_uso(self):
        r = self.client.delete(f"/api/ingredientes/{self.papa}/")
        self.assertEqual(r.status_code, 409)
        self.assertTrue(Ingrediente.objects.filter(id=self.papa).exists())

    def test_borrar_compra_revierte_stock(self):
        compra = self._comprar(HOY, [{"ingrediente": self.papa, "cantidad": "3", "unidad": self.u["kg"]}])
        self.client.delete(f"/api/compras/{compra['id']}/")
        self.assertEqual(self._stock(self.papa), 0.0)
        self.assertFalse(MovimientoStock.objects.exists())


class MermasTests(BaseInventario):
    def _merma(self, fecha, ing, cantidad, unidad, motivo="vencido"):
        r = self.client.post(
            "/api/mermas/",
            {"fecha": fecha.isoformat(), "ingrediente": ing, "cantidad": cantidad,
             "unidad": self.u[unidad], "motivo": motivo},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def test_merma_descuenta_stock_y_se_revierte_al_borrar(self):
        self._comprar(HOY, [{"ingrediente": self.papa, "cantidad": "10", "unidad": self.u["kg"]}])
        m = self._merma(HOY, self.papa, "1500", "g")
        self.assertEqual(self._stock(self.papa), 8.5)
        self.assertEqual(m["motivo_display"], "Vencido")
        # editar la cantidad regenera el movimiento
        self.client.patch(f"/api/mermas/{m['id']}/", {"cantidad": "2", "unidad": self.u["kg"]}, format="json")
        self.assertEqual(self._stock(self.papa), 8.0)
        self.client.delete(f"/api/mermas/{m['id']}/")
        self.assertEqual(self._stock(self.papa), 10.0)

    def test_merma_con_unidad_incompatible(self):
        r = self.client.post(
            "/api/mermas/",
            {"fecha": HOY.isoformat(), "ingrediente": self.papa, "cantidad": "1", "unidad": self.u["l"]},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_vendidos_y_tirados_descuentan_y_cocinados_no(self):
        self._comprar(HOY, [{"ingrediente": self.papa, "cantidad": "10", "unidad": self.u["kg"]}])
        self._producir(HOY, cocinados=8, vendidos=5, descartados=2)
        self.assertEqual(self._stock(self.papa), 8.25)  # (5 + 2) x 250 g
        mov = MovimientoStock.objects.filter(ingrediente_id=self.papa, tipo="produccion").get()
        self.assertEqual(mov.nota, "5 vendidas + 2 tiradas de Tortilla")

    def test_cocinados_es_opcional(self):
        r = self.client.post(
            "/api/produccion/dia/",
            {"fecha": HOY.isoformat(), "registros": [{"plato": self.tortilla, "vendidos": 4}]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self._stock(self.papa), -1.0)

    def test_el_dia_guardado_se_recupera(self):
        self._producir(HOY, cocinados=6, vendidos=4, descartados=1)
        r = self.client.get("/api/produccion/", {"fecha": HOY.isoformat()})
        self.assertEqual(
            [(x["plato"], x["cocinados"], x["vendidos"], x["descartados"]) for x in r.data],
            [(self.tortilla, 6, 4, 1)],
        )
        self.assertEqual(self.client.get("/api/produccion/", {"fecha": "2026-10-14"}).data, [])

    def test_resumen_mermas(self):
        self._comprar(HOY, [{"ingrediente": self.papa, "cantidad": "10", "unidad": self.u["kg"]}])
        self._producir(HOY, cocinados=8, vendidos=5, descartados=2)
        self._merma(HOY, self.papa, "1", "kg", "mal_estado")
        r = self.client.get("/api/insights/mermas/", {"desde": HOY.isoformat(), "hasta": HOY.isoformat()})
        papa = next(i for i in r.data["ingredientes"] if i["ingrediente"] == "Papa")
        self.assertEqual(papa["cruda"], 1.0)
        self.assertEqual(papa["en_platos_tirados"], 0.5)  # 2 tortillas x 250 g
        self.assertEqual(papa["total"], 1.5)
        self.assertEqual(papa["motivos"][0]["motivo_display"], "En mal estado")
        huevo = next(i for i in r.data["ingredientes"] if i["ingrediente"] == "Huevo")
        self.assertEqual(huevo["en_platos_tirados"], 4.0)
        self.assertEqual(r.data["porciones_tiradas"], 2)
        plato = r.data["platos"][0]
        # 2 tiradas de 7 que salieron de la cocina (5 vendidas + 2 tiradas)
        self.assertEqual((plato["descartados"], plato["porcentaje_descartado"]), (2, 28.6))

    def test_merma_tirada_despues_de_cambiar_receta_usa_receta_del_dia(self):
        self._producir(HOY, cocinados=4, vendidos=2, descartados=2)
        self.client.patch(
            f"/api/platos/{self.tortilla}/",
            {"ingredientes": [{"ingrediente": self.papa, "cantidad": "1", "unidad": self.u["kg"]}]},
            format="json",
        )
        r = self.client.get("/api/insights/mermas/", {"desde": HOY.isoformat(), "hasta": HOY.isoformat()})
        papa = next(i for i in r.data["ingredientes"] if i["ingrediente"] == "Papa")
        self.assertEqual(papa["en_platos_tirados"], 0.5)  # receta vieja: 250 g

    @patch("inventario.views._hoy", return_value=HOY)
    def test_alerta_suma_merma_a_la_referencia(self, _):
        lunes_pasado = date(2026, 10, 5)
        self._comprar(lunes_pasado, [{"ingrediente": self.papa, "cantidad": "12", "unidad": self.u["kg"]}])
        self._producir(lunes_pasado, 25, 20)  # 5 kg (lo vendido)
        self._merma(lunes_pasado + timedelta(days=2), self.papa, "3", "kg")
        alerta = next(a for a in self.client.get("/api/alertas/").data if a["ingrediente"] == "Papa")
        self.assertEqual(alerta["stock_actual"], 4.0)
        self.assertEqual(alerta["consumo_semana_pasada"], 5.0)
        self.assertEqual(alerta["merma_semana_pasada"], 3.0)
        self.assertEqual(alerta["compra_sugerida"], 9.0)  # 5 + 3 + 5 (mínimo) - 4

    def test_no_borra_ingrediente_con_mermas(self):
        self._merma(HOY, self.aceite, "100", "ml")
        r = self.client.delete(f"/api/ingredientes/{self.aceite}/")
        self.assertEqual(r.status_code, 409)
