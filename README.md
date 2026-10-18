# Stock de cocina — Calculadora de producción y proveedores

App web para una casa de comidas: define platos con sus recetas, carga la producción y las ventas de cada día, suma las compras al inventario y avisa cuándo salir a comprar, con el consumo de la semana pasada como referencia.

- **backend/** — Django + Django REST Framework, SQLite.
- **frontend/** — Next.js (App Router, TypeScript).

## Cómo correrlo

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate           # crea la base y las unidades (g, kg, ml, l, u, docena); correrlo también después de cada actualización
python manage.py cargar_demo       # opcional: 3 semanas de datos de ejemplo
python manage.py runserver         # http://localhost:8000/api/
```

Para borrar los datos de ejemplo: `python manage.py cargar_demo --borrar`.
Panel de administración de Django: `python manage.py createsuperuser` y entrar a http://localhost:8000/admin/.

Tests: `python manage.py test inventario`.

### Frontend

```bash
cd frontend
cp .env.example .env.local         # NEXT_PUBLIC_API_URL=http://localhost:8000/api
npm install
npm run dev                        # http://localhost:3000
```

## Cómo funciona

1. **Mercadería**: cada producto se mide en peso, volumen o unidades, se muestra en la unidad que elijas (kg, l, u…) y tiene un **stock mínimo**.
2. **Platos**: cada plato tiene la cantidad promedio de cada ingrediente **por porción**, en cualquier unidad compatible (250 g de papa, 50 ml de aceite, 2 huevos).
3. **Compras**: se suman al stock en la fecha de la compra.
4. **Ventas del día**: por cada plato se carga cuántas porciones se **vendieron** y cuántas se **tiraron**. Las dos descuentan del stock los ingredientes de la receta. "Cocinados" es opcional y sólo de referencia. Se cambia de día con un calendario semanal (flechas ‹ › por semana, o ← → del teclado); cada día muestra lo que ya está guardado y avisa si hay cambios sin guardar.
5. **Mermas**: todo lo que se tira.
   - *Mercadería*: producto que se tiró sin usar (vencido, en mal estado, se cayó, error de preparación). Se descuenta del stock con su motivo.
   - *Platos preparados*: porciones que se tiraron. Se suman a las tiradas de ese día y descuentan los ingredientes de la receta.
6. **Contar**: si al hacer inventario hay otra cantidad, se registra un ajuste por la diferencia.

### Historial

El stock nunca se pisa: cada compra, día cargado o ajuste genera movimientos en un libro (`MovimientoStock`). El stock a cualquier fecha es la suma de los movimientos hasta ese día, así que:

- se puede ver el stock día por día de cada producto, con compras, producción, mermas y ajustes;
- recargar o corregir un día reemplaza sólo sus movimientos;
- cambiar una receta no modifica los días ya cargados.

Todas las cantidades se guardan también en la unidad base (g, ml, u), por eso se pueden mezclar kg y g sin errores.

### Alertas

Un producto aparece en **Para salir a comprar** cuando:

- no tiene stock, o
- está por debajo de su stock mínimo, o
- con el consumo de los últimos 7 días alcanza para menos de 2 días.

Cada alerta muestra lo que se usó y lo que se tiró la **semana pasada** (lunes a domingo), los días de cobertura estimados y una **compra sugerida** = (usado + tirado) de la semana pasada (o de los últimos 7 días, el mayor) + mínimo − stock actual. Lo tirado entra en la cuenta porque también hay que reponerlo.

### Mermas

En la pantalla **Mermas**, "Cuánto se tiró" muestra por período:

- mercadería tirada sin usar, por producto y motivo;
- la mercadería que llevaban los platos tirados, calculada con la receta que se usó ese día;
- porciones tiradas por plato y qué porcentaje representan de lo que salió de la cocina (vendido + tirado).

## API

| Método | Ruta | Para qué |
|---|---|---|
| CRUD | `/api/unidades/` | Unidades de medida (se pueden agregar, ej.: "bolsa 25 kg" con factor 25000) |
| CRUD | `/api/ingredientes/` | Mercadería; `stock_actual` y `stock_minimo` en la unidad preferida |
| GET | `/api/ingredientes/{id}/historial/?desde=&hasta=` | Stock diario y movimientos |
| POST | `/api/ingredientes/ajuste/` | Conteo físico |
| CRUD | `/api/platos/` | Platos con receta anidada (`ingredientes`) |
| CRUD | `/api/compras/` | Compras con ítems anidados |
| CRUD | `/api/produccion/?fecha=&desde=&hasta=&con_descartados=1` | Registros de producción |
| POST | `/api/produccion/dia/` | Carga completa de un día `{fecha, registros: [{plato, vendidos, descartados, cocinados?}]}` |
| CRUD | `/api/mermas/?desde=&hasta=&ingrediente=` | Mercadería tirada (motivo: `vencido`, `mal_estado`, `rotura`, `error`, `otro`) |
| GET | `/api/movimientos/?ingrediente=&tipo=` | Libro de movimientos |
| GET | `/api/alertas/` | Lista para salir a comprar |
| GET | `/api/insights/consumo/?desde=&hasta=&agrupar=dia\|semana\|mes` | Consumo por período |
| GET | `/api/insights/ventas/?desde=&hasta=` | Vendido y tirado por plato |
| GET | `/api/insights/mermas/?desde=&hasta=` | Todo lo tirado en el período |
| GET | `/api/resumen/` | Datos del panel |

## Próximos pasos posibles

- Login y usuarios (dueño / cocina) — la API ya tiene el punto de enganche en `REST_FRAMEWORK`.
- Pasar a PostgreSQL para producción.
- Costos: con `costo_total` en las compras se puede calcular el costo por plato y cuánta plata se va en mermas.
