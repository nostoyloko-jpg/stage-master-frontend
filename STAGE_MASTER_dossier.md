# STAGE MASTER — Dossier del proyecto

Resumen de todo lo construido, las decisiones tomadas, lo que quedó aparcado y
lo que queda pendiente.

Última actualización: 3 de octubre de 2026

---

## 1. QUÉ ES

Aplicación de gestión de listas de canales y producción de festivales para
técnicos de sonido en directo.

- **Frontend**: un único archivo `index.html` (~12.700 líneas), publicado en
  GitHub Pages — repo `nostoyloko-jpg/stage-master-frontend`
- **Backend**: Express sobre Render — repo `nostoyloko-jpg/stage-master-backend`,
  en `stage-master-backend-1.onrender.com`
- **Base de datos**: Supabase (plan gratuito) — *actualmente sin uso, ver §6*
- **Coste**: cero. Todo en planes gratuitos.

Terminología del dominio usada en la app: FOH, MON, IEM, Sidefill, Backline,
Tarimas, Puentes, C&P, Toro.

---

## 2. FUNCIONALIDADES

### CH List (lista de canales)
- Una lista por artista, hasta 128 canales
- Por canal: manguera + conector, instrumento, canal de stage, micrófono, DI,
  48V, tipo de pie, observaciones
- **Micro "🎤 Propio"**: el artista trae el suyo, no cuenta como material
- **📌 Ya montado**: para ambientes fijos y similares, no se recuenta
- **Pares estéreo**: al enlazar dos canales, se fusionan las celdas de Micro,
  DI, 48V, Pie y Obs (una sola caja física para L+R)
- Columna PIE conmutable: desplegable de un tipo, o cuatro casillas. Se cambia
  pulsando en la cabecera. En modo casillas, marcar una desmarca las demás.
- Botones ⟲ en las cabeceras de Micro y Pie para vaciar la columna entera
- Modo visual o numérico para asignar conectores
- Campo de notas compartido, sincronizado con los resúmenes; recuerda el tamaño
  al que lo ajustes

### Importación de riders
- PDF, imagen, CSV y texto
- **Selector de páginas** con miniaturas, casillas y reordenación por arrastre
- Si el PDF no tiene texto (tabla escaneada), pasa automáticamente a
  **análisis visual** rasterizando las páginas
- Vista previa editable antes de aplicar, con botón para **insertar canales**
  entre los detectados

### Mangueras, cajetines y sistemas
- Mangueras A–H, con color y número de conectores configurables
- **Líneas fijas** (frontal, sidefill…): se montan una vez para todo el festival
- **Cajetines por artista**: cada uno decide cuántos usa de cada manguera, con
  nombre o posición para cada uno ("batería", "teclas"…)
- **Sistemas de mangueras** (Sistema A, B, C… o "Propio"): varios juegos que
  rotan entre bandas. Cada uno con su color. Se crean, renombran y borran desde
  Configuración o desde la propia CH list.
- **Cables de link**: N cajetines encadenados necesitan N−1 cables

### Escenarios
- Se definen en Configuración, cada uno con nombre y color
- Se asignan a cada artista por desplegable
- Aparecen en su color en el cronograma y en la ventana Live

### Recuento de material
Reglas (todas centralizadas, ver §4):

| Concepto | Regla |
|---|---|
| Micro propio / XLR / ya montado | Excluidos |
| Par estéreo con el mismo modelo | Una sola caja |
| Artista ♻ reutilizable | `suma(no reutilizables) + máx(reutilizables)` |
| Manguera variable | 1 por sistema que la use |
| Manguera fija | 1 para todo el festival |
| Cajetines y cables | Por banda, con la regla de reutilizable |
| Total del festival | Máximo entre días, nunca la suma |

### Vistas
- **Orden del día**: cronograma Gantt con zoom, alto de fila y de cabecera
  ajustables arrastrando
- **Resumen CH List**, **Resumen Cajetines** (diagrama visual),
  **Resumen material**, **Load Out** — todas con pestañas por día y pestaña
  de máximo del festival
- **Ventana Live**: reloj, EN ESCENA, SIGUIENTE y CALL en la mitad superior
  (anchos ajustables); barras por artista abajo, con alto individual y zoom de
  20 min a 6 h

### Aviso CALL
- Minutos de antelación configurables
- El artista aparece parpadeando en su color de escenario
- Botón **OK** para marcarlo como avisado
- Funciona aunque abras la ventana tarde: filtra por margen restante

### Exportación PDF
- Portada por sección con nombre del festival y apartado
- Secciones: Orden del día, CH lists, planos, Resumen CH List,
  Resumen Cajetines, Resumen material, Máximo festival, Load Out
- Botón 🖨 flotante para exportar solo la vista actual
- **Exportar por día**: genera un archivo por jornada, útil en festivales grandes

### Otros
- Hora de **cambio de día** configurable: un show a las 02:00 cuenta como del
  día anterior. Afecta a todas las agrupaciones por jornada.
- Planos de escenario con elementos arrastrables
- Guardado en Drive e importación / exportación de archivos

---

## 3. REFACTOR (octubre 2026)

### El problema
Las reglas de recuento estaban escritas en **5 sitios**: pantalla, PDF de Load
Out, PDF de Resumen, Resumen material y badges. Cada bug había que arreglarlo
cinco veces, y varias veces se quedó alguno sin arreglar — por eso los números
no cuadraban entre pantalla y PDF.

### Lo que se hizo
Se extrajo un **dominio puro** (`sm-core.js`, ~430 líneas) con todas las reglas,
sin dependencias del DOM ni de variables globales. Las cinco vistas se migraron
a leer de ahí mediante adaptadores finos.

| | Antes | Ahora |
|---|---|---|
| Sitios con reglas de recuento | 5 | 1 |
| Líneas duplicadas | ~400 | 0 |
| Tests | 0 | 44 |

### Bugs encontrados al migrar
1. Badge "propios" no contaba los canales con el micro 🎤 Propio
2. PDF de Load Out contaba las mangueras variables por artista, no por sistema
3. PDF de Load Out **sumaba todos los días** en vez de tomar el máximo
   (daba 81 pies donde la pantalla decía 32)
4. PDF de Resumen no excluía los canales "ya montado"
5. PDF de Resumen no emparejaba las DI estéreo

### Herramientas que quedan
- **`smCheck()`** en la consola: compara dominio contra vistas y lista
  diferencias. Validado con 20 artistas y 913 canales, sin discrepancias.
- **`node sm-core.test.js`**: 44 tests. Los marcados `[REGRESIÓN]` reproducen
  bugs que llegaron a producción — si uno falla, el bug ha vuelto.

---

## 4. ARCHIVOS DEL PROYECTO

| Archivo | Para qué |
|---|---|
| `index.html` | La aplicación. Lleva `sm-core.js` incrustado. |
| `sm-core.js` | Dominio suelto, por si se separa en el futuro |
| `sm-core.test.js` | Tests. `node sm-core.test.js` |
| `INTEGRACION.md` | Guía del refactor |
| `supabase-setup.sql` | Crea las tablas y el primer proyecto |
| `supabase-limpieza.sql` | Borra los proyectos duplicados de abril |
| `supabase-inventario.sql` | Consulta qué hay en la base de datos |

---

## 5. REGLA DE ORO

**Toda regla de recuento nueva va en `sm-core.js`, nunca en una vista.**

El procedimiento: primero el test, luego la regla, y las vistas solo pintan lo
que el dominio devuelve. Es lo que evita volver a tener cinco versiones de lo
mismo descuadrándose entre sí.

---

## 6. APARCADO — SINCRONIZACIÓN CON SUPABASE

### Estado: **desactivada**

En `index.html`:

    const SYNC_ENABLED = false;

Ese interruptor corta todas las llamadas al servidor desde un único punto
(`sbApiCall`). Ponerlo en `true` lo reactiva todo; el código sigue intacto.

### Por qué se desactivó
El flujo de trabajo actual es con archivos guardados en Drive, no con el
servidor. Teniéndolo activo:
- Al recargar se cargaba un proyecto de pruebas de abril por encima del actual
- Salía un error 500 en consola cuando Supabase se dormía

### Qué daría si se reactiva
Trabajo compartido: varios técnicos sobre el mismo festival, con códigos de
invitación, y acceso desde varios dispositivos.

### Qué hay que resolver ANTES de usarlo en un festival real
1. **No hay edición simultánea.** Cada uno guarda el proyecto entero; el último
   machaca al primero. Sirve para repartirse el trabajo por turnos, no para
   editar a la vez. Haría falta bloqueo por secciones o fusión de cambios.
2. **Supabase se duerme** tras unos días sin uso en plan gratuito. Hay que
   restaurarlo a mano. Opciones: ping automático con GitHub Actions, o plan de
   pago.
3. **Sin probar con dos personas de verdad.** Solo hay datos de pruebas.
4. **Limpiar los 9 proyectos duplicados de abril**, todos con 6 artistas, que
   son restos del desarrollo. El SQL está preparado.
5. **Revisar la seguridad**: RLS está desactivado y es el backend quien valida
   los tokens. La clave ANON no debe exponerse nunca en el frontend. Si se va en
   serio, mover el backend a SERVICE_ROLE y activar RLS.

---

## 7. PENDIENTE

### Deuda técnica
- **Ventana Live**: se genera como texto dentro de un template literal. Es
  frágil — un `\'` mal puesto la dejó en blanco. Debería construirse con
  `document.createElement` o cargarse de un archivo aparte. **Es lo más
  urgente si se le van a añadir más funciones.**
- **Tamaño del archivo**: 12.700 líneas en un solo HTML. Separar en módulos
  requiere un bundler. No es urgente, pero sí lo es no añadir más lógica de
  negocio al HTML.
- **Caché de selectores**: `SMCore.createSelectors()` está implementado y
  medido (0,60 ms → 0,003 ms) pero **sin conectar**. Vale la pena si el render
  se nota lento con festivales grandes.

### Ideas sin empezar
- Edición simultánea de verdad (ver §6)
- Histórico de versiones de un proyecto
- Plantillas de artista reutilizables entre festivales

---

## 8. AVISOS PRÁCTICOS

**Al subir una versión nueva**: GitHub Pages cachea de forma agresiva. Si no ves
los cambios, abre con `?v=` y un número distinto cada vez:

    https://nostoyloko-jpg.github.io/stage-master-frontend/?v=231

Ese número no elige versión — solo evita la copia en caché. La versión real es
la del archivo subido a GitHub.

**Después de tocar reglas de recuento**: ejecutar `node sm-core.test.js` y
`smCheck()` en la consola con un festival real cargado.

**Antes de tocar la base de datos**: exportar el festival a un archivo.
