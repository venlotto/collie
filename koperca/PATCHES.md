# Inventario de la cola histórica

La fuente de verdad de la personalización Koperca es el rango de commits
`koperca/UPSTREAM_BASE..<overlay-ref>` del fork. La candidata normal reproduce
ese overlay completo; no reconstruye el producto desde esta cola.

Los siete correos externos documentados aquí son una entrada heredada para
migración y auditoría. Nunca se aplican por defecto. Solo se inspeccionan cuando
el operador pasa `--legacy-migration`, y una aplicación limpia no convierte el
resultado en la variante vigente del fork.

La cola vive, por defecto, en
`~/.config/herdr/plugins/config/herdr.collie/patches`. No se copia aquí porque
esa carpeta pertenece a la configuración operativa de Collie y comparte su
entorno con archivos privados. `PATCH_QUEUE.sha256` identifica exactamente los
parches revisados sin registrar su contenido.

## Parches conocidos

Cada fila describe el efecto visible y las superficies que deben revisarse al
cambiar de versión upstream.

| orden | objetivo | estado frente a upstream actual | decisión |
| --- | --- | --- | --- |
| 0001 | Abrir New en Shell y elegir un workspace nuevo o existente | la intención falta; el contrato antiguo `spaceId` fue reemplazado por `besidePaneId` | reescribir solo la UI sobre las APIs actuales; no portar servidor/body antiguo |
| 0002 | Quitar Launch y borrar un space | intención parcial; upstream ya tiene un `SpaceActionsSheet` más completo y no existe `closeSpace` atómico | separar presentación y borrado; preservar Rename y no aceptar borrado parcial implícito |
| 0003 | Shell rápido y tira de pestañas fijada/desplazable | parte absorbida; falta el picker global rápido y wheel horizontal | reescritura mínima sobre `newTab` y `TabStrip` actuales |
| 0004 | Acciones manteniendo pulsado el chip | absorbido por `SpaceStrip`, `Chip.onLongPress` y `SpaceActionsSheet` | retirar |
| 0005 | Reconocer una caja Claude desplazada | absorbido y superado por `boxMatchesTail`, `boxHolds` y pruebas Claude actuales | retirar; no restaurar perfiles 2.1.310 |
| 0006 | Filtrar spaces en la barra ancha | falta compartir preferencias con `ThreadSidebar`; el límite Vite de 3 MiB ya fue absorbido | reescribir con store compartido; no tocar Vite |
| 0007 | Cerrar pane desde la barra ancha | falta en la fila, pero `PaneActionsSheet` ya posee gates, errores y limpieza actuales | componer/reutilizar la acción actual; no duplicar `CloseRow` |

La migración reduce la cola histórica a tres temas: creación/navegación
(0001+0003), acciones composables (0002+0007) y filtro compartido (0006). Los
parches 0004 y 0005 deben salir de la cola. Una aplicación limpia nunca demuestra
compatibilidad funcional por sí sola.

## Regla de mantenimiento

Las funciones nuevas o conservadas se implementan como commits lineales del
overlay, nunca añadiendo otro parche operativo a esta cola. Un cambio
intencional de la cola histórica se hace fuera del repositorio, se revisa como
código y después actualiza este inventario y `PATCH_QUEUE.sha256` en el mismo
cambio. Nunca se apunta el helper a una carpeta que contenga algo distinto de
los correos `*.patch` inventariados.

Después de reproducir y aprobar el overlay sobre una base nueva se registra el
OID upstream completo en `UPSTREAM_BASE`. La punta del overlay debe estar
limpia y comprometida antes de preparar otra candidata; de lo contrario el
helper se niega a continuar para no omitir la interfaz del fork. El destino
nuevo también debe ser la base registrada o descender de ella: una versión
estable anterior nunca es un punto válido para reconstruir la candidata.

Para revisar rutas afectadas sin aplicar nada:

```bash
for patch in ~/.config/herdr/plugins/config/herdr.collie/patches/*.patch; do
  printf '\n%s\n' "$(basename "$patch")"
  rg '^diff --git ' "$patch"
done
```
