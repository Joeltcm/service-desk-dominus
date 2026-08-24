# Dominus Tech — instancia entregada

Este repo es **la instancia de Dominus Tech**, un proyecto ya entregado y en
producción. Está **aislado a propósito**: no comparte repo ni remote con
`service-desk-empresas`, del que se separó el 2026-08-24.

- **Producción:** https://servicedesk.dominuspty.com
- **Railway:** proyecto `sde-dominus-tech` (`afb11b9b-03d5-4d63-9431-55fdfcbb3fc6`), servicio `app`
- **Base de datos, bucket R2, dominio y admin:** propios, no compartidos con nadie

## Desplegar

```bash
./deploy.sh
```

**Nunca corras `railway up` a mano.** `railway up` sube la carpeta al proyecto que
el CLI tenga enlazado para ese directorio, y ese enlace vive fuera del repo
(`~/.railway/config.json`): puede cambiar sin que te enteres. Ya pasó una vez —
la carpeta de empresas quedó enlazada a Dominus, así que un deploy "de empresas"
iba directo a producción del cliente.

`deploy.sh` comprueba el destino antes de subir nada y aborta si no es Dominus.

## Cambios que vienen de empresas

No hay puente automático ni remote `upstream`: el aislamiento es total. Si el
cliente pide una mejora hecha en `service-desk-empresas`, se porta a mano, usando
el `PORTING-LOG.md` de aquel repo como referencia.

Los cambios propios de Dominus se quedan aquí y no vuelven a empresas.
