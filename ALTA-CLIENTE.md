# Alta de un cliente nuevo

Guía para provisionar una instancia del producto para un cliente.

**Modelo:** multi-instancia. Cada cliente = **su propio** proyecto Railway + base de datos Postgres + bucket R2 + dominio + admin. Nada se comparte entre clientes (aislamiento total, igual que los datos).

---

## 0. Prerrequisitos
- Cuenta de Railway con acceso al repo privado `Joeltcm/service-desk-empresas`.
- Cuenta de Cloudflare con R2 habilitado.
- Un nombre corto para el cliente, ej. `acme` (se usa para nombrar recursos).

---

## 1. Proyecto en Railway
1. **New Project → Deploy from GitHub repo → `service-desk-empresas`**.
   - Si el repo no aparece: **Account Settings → GitHub → Configure** y dale acceso.
2. El primer build va a **fallar** (aún no hay DB ni variables) — es normal, seguimos.

## 2. Base de datos
1. En el proyecto: **+ New → Database → PostgreSQL**.
2. Railway crea el servicio (se llamará `Postgres`).

## 3. Bucket R2 (Cloudflare)
1. **R2 → Create bucket** → nombre `service-desk-<cliente>` (ej. `service-desk-acme`).
2. **R2 → Overview → { } API → Manage API Tokens → Create API Token**:
   - **Permissions: `Object Read & Write`** ← NO "Read only".
   - **Specify bucket(s):** el bucket del cliente.
   - Create → copia **Access Key ID** y **Secret Access Key** (la secret solo se muestra una vez).
3. Anota también el **Account ID** (sale en la misma página / en el endpoint S3).

## 4. Variables de entorno (en el servicio de la **app**, pestaña Variables)

| Variable | Valor |
|---|---|
| `SECRET_KEY` | Único por instancia. Generar: `python3 -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `DATABASE_URL` | ⚠️ **VALOR LITERAL** (ver nota abajo): `postgresql://postgres:<PGPASSWORD>@postgres.railway.internal:5432/railway` |
| `INITIAL_ADMIN_EMAIL` | Correo del admin del cliente |
| `INITIAL_ADMIN_PASSWORD` | Contraseña inicial fuerte — **sin el símbolo `$`** (Railway lo interpreta) |
| `R2_ACCOUNT_ID` | Account ID de Cloudflare |
| `R2_ACCESS_KEY_ID` | Access Key ID del token R2 (con Read & Write) |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key del token R2 |
| `R2_BUCKET_NAME` | `service-desk-<cliente>` |

**Opcionales (features):** `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` (tu cuenta de vendor), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_EMAIL` (push), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (calendar), `FRESHDESK_*`. El email/SMTP se configura **dentro de la app** (Ajustes), no por variables.

> **⚠️ Nota crítica sobre `DATABASE_URL`:** la referencia `${{Postgres.DATABASE_URL}}` **no resuelve** de forma confiable (la app la recibe vacía → cae a SQLite efímero → pierde datos en cada redeploy). Usa el **valor literal**: copia `PGPASSWORD` del servicio Postgres (pestaña Variables del Postgres) y arma la URL a mano. El host es siempre `postgres.railway.internal:5432/railway`.

## 5. Deploy y verificación
1. Con todas las variables puestas → en el servicio de la app: **Redeploy** (Railway **no** redespliega solo al cambiar variables).
2. Espera a que quede en **verde**.
3. Verifica: el sitio carga (login), y el título/branding sale neutro ("Service Desk" + ícono headset) porque aún no hay branding del cliente.
4. **⚠️ Verifica el admin:** entra con `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`. Si dice "email o contraseña incorrectos", probablemente el admin quedó con la contraseña de respaldo `changeme` (la variable no llegó) → ver troubleshooting.

## 6. Dominio del cliente
1. Servicio de la app → **Settings → Networking → Custom Domain** → escribe el dominio del cliente.
2. Railway te da un **CNAME** → cárgalo en el DNS del cliente.
3. (Para probar antes: **Generate Domain** da un `*.up.railway.app`.)

## 7. Branding y entrega
1. Login como admin → **cambia la contraseña**.
2. **Configuración → Branding:** sube logo, favicon, ícono PWA, nombre y colores del cliente.
3. Crea los usuarios del cliente (agentes, etc.).

---

## Troubleshooting (problemas reales que ya pasamos)

- **502 "Application failed to respond" al arrancar** → `DATABASE_URL` vacío (usa el literal) o falta `SECRET_KEY`. Mira los logs del deploy; el error de DB dice `Could not parse SQLAlchemy URL from string ''`.
- **Login rechaza la contraseña correcta del admin** → el admin se creó con `changeme` porque `INITIAL_ADMIN_PASSWORD` no llegó al contenedor. Solución: resetear la contraseña directo en la DB (abajo) o volver a setear la variable + redeploy antes de que exista el admin.
- **Adjuntos se pierden en el redeploy** → faltan las `R2_*` o el token R2 es de solo lectura. Verifica que el token sea **Object Read & Write** y que las 4 variables estén.
- **`$` en el valor de una variable** → Railway lo interpreta como interpolación. Evítalo en contraseñas.

### Conectarse a la DB para debug (desde tu máquina)
```bash
railway link --project <PROJECT_ID> --environment <ENV_ID>
railway variables --service Postgres --json   # sacar PGPASSWORD, RAILWAY_TCP_PROXY_DOMAIN/PORT
# URL pública = postgresql://postgres:<PGPASSWORD>@<PROXY_DOMAIN>:<PROXY_PORT>/railway
# (el DATABASE_PUBLIC_URL que muestra Railway puede apuntar a un proxy viejo — usa TCP_PROXY_*)
# Conectar con psycopg2 usando sslmode='require'
```
Para resetear una contraseña: hashear con `bcrypt` y `UPDATE users SET password_hash=%s WHERE email=%s`.

### Verificar que R2 quedó activo
```bash
# Con las credenciales del token, listar el bucket (boto3, endpoint https://<ACCOUNT>.r2.cloudflarestorage.com)
# Sube un adjunto en la app y confirma que aparece un objeto con llave {ticket_id}/{archivo}.
```
