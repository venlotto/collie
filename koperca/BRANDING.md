# Inventario de marca de Koperca Agent Hub

La variante alojada usa **Koperca Agent Hub** y un monograma geométrico K/hub propio. La atribución
discreta es **“Based on ColliePWA”**. No se reutiliza el perro ni el wordmark de ColliePWA en ningún
call site de producción.

## Seam mantenible

- `web/src/lib/koperca-brand.ts`: nombre, nombre corto, variante dev y atribución.
- `web/src/components/hub-mark.tsx`: `HubMark` implementa `MarkProps`/`useMark`; `HubWordmark` es la
  identidad textual del sidebar.
- `web/src/components/hub-mark.tsx`: el registro alojado conserva los ids históricos `collie*` de
  temas y preferencias guardadas, pero los resuelve al monograma Koperca y excluye los componentes
  caninos del grafo de producción. Los componentes generados upstream no se modifican.
- `web/src/lib/i18n/index.ts`: solo las claves que expresan identidad de la app sustituyen el nombre
  upstream. Los mensajes técnicos, comandos, API y almacenamiento conservan su terminología.

## Assets runtime

Los nombres de archivo se conservan para minimizar conflicto con upstream, pero su contenido es
Koperca: favicon release/dev/playground, apple touch icon, manifest 192/512, icono de notificación,
badge y splash claro/oscuro. `web/index.html` y `web/vite-icons.ts` publican el nombre nuevo.

## Identificadores preservados

No se renombran el binario, variables `COLLIE_*`, headers, endpoints, storage keys, ids de tema ni
protocolos. Son contratos técnicos internos, no identidad visual.

