# opeka-keycloak

Central Keycloak for the OPEKA applications. Citizens log in with **TAXISnet** through the GSIS OAuth2
service (ΓΓΠΣΨΔ/ΚΕΔ, «Αυθεντικοποίηση Χρηστών με διαπιστευτήρια taxisnet» v6.7). Keycloak does the GSIS
flow, and the apps (portal, registry) use standard OIDC.

| Piece | What it is |
|-------|------------|
| `Dockerfile` | Keycloak **26.8.1** + the GSIS plugin, compiled against the same Keycloak version |
| `gsis-plugin/` | Copy (Apache 2.0) of [cti-nts/keycloak-gsis-providers](https://github.com/cti-nts/keycloak-gsis-providers) (via the [HellenicSpaceCenter](https://github.com/HellenicSpaceCenter/keycloak-gsis-providers) Keycloak 26 port, commit `d41d0a3`) with the INTRAWAY patches |
| `realms/opeka-citizens.json` | Realm: `gsis-taxis-test` IdP, attribute mappers, clients `opeka-landpage` (confidential; the LandPage, staff entry point), `opeka-civil-web` (confidential; the citizen portal `opeka-LandPage_Civil`, adds the `identity_provider` claim it requires) and `opeka-portal` (public PKCE), user profile |
| `mock-gsis/server.mjs` | Local GSIS mock with the ΚΕΔ test users (`Testked1`…`Testked5`, `Nomked1`). Dev only |
| `smoke-test.py` | End-to-end login check (stdlib Python) |

## Run locally

```bash
docker compose up --build -d     # Keycloak http://localhost:8280 (admin/admin), mock GSIS :8090
python3 smoke-test.py            # portal PKCE → TAXISnet (mock) → Keycloak → token with the afm claim
CLIENT=opeka-civil-web SECRET=local-civil-secret REDIRECT=http://localhost:8082/login/oauth2/code/taxisnet python3 smoke-test.py
LOCAL=1 python3 smoke-test.py    # same, with a Keycloak account instead of TAXISnet
```

### Keycloak accounts until there is a server (decided 2026-10-29)

TAXISnet needs an https Keycloak host registered with ΓΓΠΣΨΔ, so for now citizens log in with accounts stored in
Keycloak. The realm creates them on import (dev only, the passwords are in the JSON):

| Username | Password | ΑΦΜ |
|---|---|---|
| `polites1` | `Polites1!` | 660074100 |
| `polites2` | `Polites2!` | 660074111 |
| `polites3` | `Polites3!` | 660074123 |

They use the ΚΕΔ test ΑΦΜ, so they match `Testked1`–`3` once TAXISnet is on. An app shows Keycloak's login form
when it sends no `kc_idp_hint`: for the LandPage, leave `PORTAL_TAXISNET_IDENTITY_PROVIDER` empty. These accounts have
no `identity_provider` claim, so Civil rejects them until its code accepts Keycloak accounts.

The Keycloak port is set by `KC_PORT` (default 8280). The realm is imported only on the first start. After you edit
`realms/opeka-citizens.json`, run `docker compose down -v` to re-import it.

## How login works

1. The app sends the browser to `…/realms/opeka-citizens/protocol/openid-connect/auth?client_id=opeka-portal&kc_idp_hint=gsis-taxis-test`
   (authorization code + PKCE S256). The hint skips the Keycloak login page.
2. Keycloak redirects to GSIS `oauth/authorize` with `scope=read`. The ΚΕΔ document requires it, and the plugin's
   default scope is empty, so the realm sets `defaultScope`.
3. Keycloak calls `oauth/token` and `userinfo?format=xml` itself, then imports `taxid → afm`, `fathername`,
   `mothername` and `birthyear` (sync mode FORCE: refreshed on every login).
4. The tokens carry the claims `afm`, `fatherName`, `motherName`, `birthYear`, `given_name`, `family_name`.
   Citizens can see these attributes but not edit them. There are no local passwords and no self-registration.
5. Keycloak logout also logs the user out of GSIS (`logout/{clientId}/?url=…`), as the ΚΕΔ document recommends.

## Plugin changes in `gsis-plugin/` (`INTRAWAY:` comments)

- Compiled against Keycloak 26.8.1: `SimpleHttp` moved to `org.keycloak.http.simple`.
- The profile JSON is built with Jackson instead of string concatenation (escaping), absent attributes are skipped
  (no `"null"` names for legal persons), and the char-padded `taxid` is trimmed. DOCTYPE in userinfo XML is refused.
- `gsis-taxis-test` only: `GSIS_TEST_URL` / `GSIS_TEST_BACKCHANNEL_URL` redirect it to the mock. The production
  provider `gsis-taxis` stays hardcoded to `oauth2.gsis.gr`.

When you upgrade Keycloak, bump `KEYCLOAK_VERSION` (Dockerfile) and `<keycloak.version>` (plugin pom.xml) together.
The image build fails if the plugin no longer compiles.

## Going to the GSIS pilot

1. ΕΔΑ request for TAXISnet OAuth2.0. The registry's interop catalog already lists ΚΕΔ request 36392 (ΛΑΕ) and
   ΕΣΠΑ request 51339 (submitted 19/05/2026), so check those first. Register this redirect URL:
   `https://<keycloak-host>/realms/opeka-citizens/broker/gsis-taxis-test/endpoint`
2. Remove `GSIS_TEST_URL` / `GSIS_TEST_BACKCHANNEL_URL` from the environment.
3. Put the pilot `clientId` / `clientSecret` into the IdP in the admin console (not in git).
4. Production: add a `gsis-taxis` IdP with the same mappers. It has its own credentials and redirect URL
   (`…/broker/gsis-taxis/endpoint`).

## ΚΕΔ call-log requirement

The realm stores login events for 1 year: each has an id, a timestamp, the user (TAXISnet userid) and the IP. Behind a reverse
proxy, set `KC_PROXY_HEADERS=xforwarded`, otherwise the logged IP is the proxy's. Two open points:
the ΚΕΔ asks for an *ascending* sequence number, but Keycloak event ids are UUIDs; and the legal retention period
still needs to be confirmed.

## Not production-ready yet

`compose.yaml` runs `start-dev` with default admin credentials. A real deployment needs `start --optimized`,
TLS/hostname, secrets, and its own Postgres.
