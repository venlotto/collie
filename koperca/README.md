# Overlay Koperca para Collie

Esta carpeta mantiene las diferencias de Koperca como commits pequeños encima
de `AltanS/collie`. El flujo de actualización reproduce esos commits sobre una
referencia upstream nueva en un worktree desechable. No despliega, reinicia ni
modifica el servicio Collie.

## Fuentes y límites

| elemento | ubicación | función |
| --- | --- | --- |
| upstream | remote `upstream`, `https://github.com/AltanS/collie` | código base y tags autoritativos |
| fork | remote `origin`, `venlotto/collie` | historial revisado de Koperca |
| base exacta | `koperca/UPSTREAM_BASE` | commit upstream del que parte el overlay actual |
| overlay | `UPSTREAM_BASE..<overlay-ref>` | todos los commits que deben sobrevivir una actualización |
| cola histórica | ruta externa + `PATCH_QUEUE.sha256` | migración/auditoría optativa de las siete modificaciones antiguas |

`UPSTREAM_BASE` contiene siempre un OID completo de 40 caracteres. No puede ser
un tag mutable, una rama ni una versión humana. La referencia del overlay es
local y vale `HEAD` por defecto; también puede fijarse con `--overlay-ref` o
`COLLIE_KOPERCA_OVERLAY_REF`.

La navegación compacta Chats/Workspaces forma parte del overlay. Por eso el
helper se niega a usar `HEAD` si el checkout tiene cambios sin commit: una
candidata construida así omitiría exactamente el trabajo que se quiere
conservar. También rechaza overlays vacíos, sin cambios de árbol, con merges o
cuya base registrada no sea ancestro de la punta.

## Preparar una candidata

La ejecución normal es un dry-run:

```bash
koperca/bin/update-collie --target main
```

`--target` sin prefijo se resuelve **solo en el remote upstream**. Un tag o rama
local obsoleto con el mismo nombre no puede ganar silenciosamente. Las únicas
formas locales son deliberadas y visibles:

```bash
koperca/bin/update-collie --target local:mi-rama
koperca/bin/update-collie --target commit:<oid-completo-de-40-hex>
```

Sin `--target`, el helper consulta upstream y elige su tag estable `vX.Y.Z` más
reciente. El dry-run valida la base, el overlay y el destino, e imprime cada
commit que reproduciría; no crea refs ni worktrees. Descarga el objeto elegido
en `FETCH_HEAD` para comprobar su historia: el destino debe ser
`UPSTREAM_BASE` o un descendiente suyo. Un tag anterior o una historia
divergente se rechazan, incluso si esa referencia es el último estable
publicado, para impedir un downgrade silencioso.

Solo `--apply` crea la rama y el worktree y ejecuta un `git cherry-pick` ordenado
de **todos** los commits `UPSTREAM_BASE..<overlay-ref>`:

```bash
koperca/bin/update-collie --apply --target main
```

Ante un conflicto aborta el cherry-pick y deja la candidata en el commit
upstream. No resuelve conflictos, no promueve y no despliega.

## Cola histórica: solo migración o auditoría

Los siete parches operativos antiguos no forman parte del camino normal. Varios
ya fueron absorbidos o reemplazados por upstream; aplicarlos automáticamente
puede duplicar o degradar funciones. Para medirlos de forma explícita después
del overlay:

```bash
koperca/bin/update-collie \
  --target v1.30.1 \
  --legacy-migration \
  --patch-dir ~/.config/herdr/plugins/config/herdr.collie/patches
```

En este modo se validan los nombres y hashes de `PATCH_QUEUE.sha256` y, con
`--apply`, se ejecuta `git am --3way` después del overlay. Si falla, `git am`
se aborta y el overlay reproducido queda disponible para inspección. Este modo
no convierte la cola en fuente de verdad ni en una candidata promocionable.

## Revisar y probar

Una reproducción limpia es solo el primer control. En el worktree candidato:

```bash
git log --oneline --decorate <commit-upstream>..HEAD
git diff --stat <commit-upstream>...HEAD
bun run gate
bun run typecheck
(cd web && bun run typecheck)
bun run build
koperca/bin/check-hosted-build
```

Los cambios visuales se revisan en teléfono y tablet. Los cambios de harness o
Surface requieren las pruebas de `CLAUDE.md`. Ninguna candidata se promueve con
una prueba omitida, roja o saltada. La instancia activa no es un entorno de
pruebas y no se construye ni reinicia desde este flujo.

## Promoción y siguiente ciclo

El helper no promueve. Tras revisión humana y pruebas verdes se abre un PR desde
la rama candidata. Antes de promover se actualiza `koperca/UPSTREAM_BASE` al
OID upstream exacto que imprimió el helper, como un commit revisado dentro de la
candidata. Así el siguiente ciclo delimita únicamente el overlay vigente.

La descripción del PR registra:

- commit upstream exacto y referencia humana consultada;
- base y punta del overlay de origen;
- lista de commits reproducidos;
- resultado de cada prueba obligatoria;
- cualquier migración o retiro de un parche histórico.

No se mezcla a mano ni se fuerza una rama protegida.

## Rollback y limpieza

Antes de desplegar una candidata aprobada se conserva la referencia inmutable de
la versión anterior. El rollback operativo vuelve a esa referencia mediante el
proceso de despliegue; nunca edita archivos dentro del contenedor o checkout
instalado.

Una candidata descartada se limpia manualmente después de comprobar las rutas
que imprimió el helper:

```bash
git worktree remove <ruta-candidata>
git branch -D <rama-candidata>
git worktree prune
```

Los datos, el servicio de usuario y la configuración operativa quedan fuera.

## Marca

`TRADEMARKS.md` exige nombre y logo propios para un fork modificado distribuido
o un servicio hospedado. Esta variante publica la identidad Koperca Agent Hub,
excluye los componentes del logo canino de su grafo de producción y conserva la
atribución “Based on ColliePWA”. Los identificadores internos se mantienen para
reducir la divergencia técnica.

El inventario de call sites, assets e identificadores preservados está en
[`BRANDING.md`](BRANDING.md).
