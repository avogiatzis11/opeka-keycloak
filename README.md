# opeka-keycloak

The one central Keycloak for all OPEKA applications. Citizens log in with **TAXISnet** and staff with their
**Δημόσια Διοίκηση** credentials, both through the GSIS OAuth2 services of ΓΓΠΣΨΔ/ΚΕΔ («Αυθεντικοποίηση
Χρηστών με διαπιστευτήρια taxisnet» v6.7). Keycloak does the GSIS flow; the apps use standard OIDC.

| Realm | Who | GSIS provider | Clients |
|---|---|---|---|
| `opeka-citizens` | Citizens | `gsis-taxis-test` (`/oauth2server`) | `opeka-landpage`, `opeka-civil-web`, `opeka-portal` |
| `opeka-staff` | OPEKA staff | `gsis-govuser-test` (`/oauth2servergov`) | `opeka-landpage` (callback `public-admin`, `afm` + `roles` claims), `opeka-debtors` (confidential + PKCE, secret `local-debtors-secret`; Debtors-Register exchanges the code on its backend; UI on :5173; `aud=opeka-debtors`, `afm` + `roles`) |

Staff realm roles: `OPEKA_LAE`, `OPEKA_DOCUMENTS`, `OPEKA_DEBTORS`. The LandPage shows an app card only to holders
of its role. A staff member who logs in through GSIS for the first time has no role: an administrator assigns
roles in the admin console (opeka-staff → Users → Role mapping).

| Piece | What it is |
|-------|------------|
| `Dockerfile` | Keycloak **26.8.1** + the GSIS plugin, compiled against the same Keycloak version |
| `gsis-plugin/` | Copy (Apache 2.0) of [cti-nts/keycloak-gsis-providers](https://github.com/cti-nts/keycloak-gsis-providers) (via the [HellenicSpaceCenter](https://github.com/HellenicSpaceCenter/keycloak-gsis-providers) Keycloak 26 port, commit `d41d0a3`) with the INTRAWAY patches |
| `realms/opeka-staff.json` | Staff realm: `gsis-govuser-test` IdP, the three roles, clients `opeka-landpage` and `opeka-debtors` |
| `realms/opeka-citizens.json` | Realm: `gsis-taxis-test` IdP, attribute mappers, clients `opeka-landpage` (confidential; the LandPage, staff entry point), `opeka-civil-web` (confidential; the citizen portal `opeka-LandPage_Civil`, adds the `identity_provider` claim it requires) and `opeka-portal` (public PKCE), user profile |
| `mock-gsis/server.mjs` | Local GSIS mock with the ΚΕΔ test users (`Testked1`…`Testked5`, `Nomked1`), for both services. Dev only |
| `smoke-test.py` | End-to-end login check (stdlib Python) |

## Run locally

```bash
docker compose up --build -d     # Keycloak http://localhost:8280 (admin/admin), mock GSIS :8090
python3 smoke-test.py            # portal PKCE → TAXISnet (mock) → Keycloak → token with the afm claim
CLIENT=opeka-civil-web SECRET=local-civil-secret REDIRECT=http://localhost:8082/login/oauth2/code/taxisnet python3 smoke-test.py
LOCAL=1 python3 smoke-test.py    # same, with a Keycloak account instead of TAXISnet
# Staff realm (STAFF=1): GovUser (mock), then a Keycloak account with the three roles
STAFF=1 CLIENT=opeka-landpage SECRET=local-landpage-staff-secret REDIRECT=http://localhost:8082/login/oauth2/code/public-admin python3 smoke-test.py
STAFF=1 LOCAL=1 CLIENT=opeka-landpage SECRET=local-landpage-staff-secret REDIRECT=http://localhost:8082/login/oauth2/code/public-admin python3 smoke-test.py
STAFF=1 LOCAL=1 CLIENT=opeka-debtors SECRET=local-debtors-secret python3 smoke-test.py   # Debtors-Register client
```

LandPage against both realms: `PORTAL_TAXISNET_ISSUER=http://localhost:8280/realms/opeka-citizens`,
`PORTAL_TAXISNET_CLIENT_ID=opeka-landpage`, `PORTAL_TAXISNET_CLIENT_SECRET=local-landpage-secret`, and
`PORTAL_OIDC_ISSUER=http://localhost:8280/realms/opeka-staff`, `PORTAL_OIDC_CLIENT_ID=opeka-landpage`,
`PORTAL_OIDC_CLIENT_SECRET=local-landpage-staff-secret`, `PORTAL_OIDC_AFM_CLAIM=afm`. Leave
`PORTAL_TAXISNET_IDENTITY_PROVIDER` / `PORTAL_OIDC_IDENTITY_PROVIDER` empty for Keycloak accounts, or set them to
`gsis-taxis-test` / `gsis-govuser-test` for GSIS.

### Keycloak accounts until there is a server (decided 2026-10-29)

GSIS needs an https Keycloak host registered with ΓΓΠΣΨΔ, so for now people log in with accounts stored in
Keycloak. They are the ΚΕΔ test users of the GSIS OAuth2 document v6.7 §4, with the same username, password and ΑΦΜ:
the 5 natural persons are the citizens, the 3 legal persons are the staff (Δημόσια Διοίκηση) accounts. They carry the
attributes the GSIS userinfo returns: natural persons afm, names, father/mother name, birth year; legal persons only
afm and επωνυμία (as last name). Names are placeholders, as in `mock-gsis/`, which has the same 8 users. A GSIS login
of someone who already has a Keycloak account ends on "add to existing account" once (Keycloak's password), so an
ΑΦΜ never gets two users. The realms create them on import (dev only, the passwords are in the JSON):

| Realm | Username | Password | ΑΦΜ | Roles |
|---|---|---|---|---|
| citizens | `Testked1`…`Testked5` | `Testked1!`…`Testked5!` | 660074100 / 111 / 123 / 135 / 147 | — |
| staff | `Nomked1` | `Nomked1!` | 098120800 | all three |
| staff | `Nomked2` | `Nomked2!` | 090374553 | `OPEKA_LAE` |
| staff | `Foreas_parav2` | `Fparav2!` | 800050066 | `OPEKA_DOCUMENTS`, `OPEKA_DEBTORS` |

Both realms: https required except from localhost/private networks (`sslRequired: external`), account lockout
after 5 failed logins (brute-force detection), and a password policy for Keycloak accounts (8+ characters, not
the username or email; staff passwords also expire after 90 days, ΛΑΕ UC-01). Login pages default to Greek; English follows the browser's language.

They use the ΚΕΔ test ΑΦΜ, so they match `Testked1`–`3` once TAXISnet is on. An app shows Keycloak's login form
when it sends no `kc_idp_hint`: for the LandPage, leave `PORTAL_TAXISNET_IDENTITY_PROVIDER` empty. These accounts have
no `identity_provider` claim, so Civil rejects them until its code accepts Keycloak accounts.

The Keycloak port is set by `KC_PORT` (default 8280). Realms are imported only on the first start. After you edit
a file in `realms/`, run `docker compose down -v` to re-import (this wipes the local Keycloak database).

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
- `gsis-taxis-test` / `gsis-govuser-test` only: `GSIS_TEST_URL` / `GSIS_TEST_BACKCHANNEL_URL` and
  `GSIS_GOV_TEST_URL` / `GSIS_GOV_TEST_BACKCHANNEL_URL` redirect them to the mock. The production providers
  `gsis-taxis` / `gsis-govuser` stay hardcoded to `oauth2.gsis.gr`.

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

Staff (Δημόσια Διοίκηση) works the same way in realm `opeka-staff`: the registry's catalog lists ΕΣΠΑ request
56838 «OAuth2.0.PA υπαλλήλων» (submitted 15/10/2026). Redirect URL
`https://<keycloak-host>/realms/opeka-staff/broker/gsis-govuser-test/endpoint`; remove `GSIS_GOV_TEST_URL` /
`GSIS_GOV_TEST_BACKCHANNEL_URL`; production IdP `gsis-govuser`. The realm sends `scope=read` as for TAXISnet;
confirm it against the ΚΕΔ document for civil servants when it arrives (we only have the TAXISnet one).

## ΚΕΔ call-log requirement

Both realms store login events for 1 year: each has an id, a timestamp, the user (GSIS userid) and the IP. Behind a reverse
proxy, set `KC_PROXY_HEADERS=xforwarded`, otherwise the logged IP is the proxy's. Two open points:
the ΚΕΔ asks for an *ascending* sequence number, but Keycloak event ids are UUIDs; and the legal retention period
still needs to be confirmed.

## Not production-ready yet

`compose.yaml` runs `start-dev` with default admin credentials. A real deployment needs `start --optimized`,
TLS/hostname, secrets, and its own Postgres.
