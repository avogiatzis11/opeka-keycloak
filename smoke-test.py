#!/usr/bin/env python3
"""End-to-end TAXISnet login through Keycloak against the mock GSIS (stdlib only).

Portal (PKCE, kc_idp_hint) → Keycloak → mock GSIS login form → Keycloak broker (token + XML userinfo)
→ portal redirect with code → token exchange → checks the ΑΦΜ claim. Run with `docker compose up` first:
    python3 smoke-test.py [KEYCLOAK_URL]
"""
import base64
import hashlib
import http.cookiejar
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

KC = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8280").rstrip("/")
# STAFF=1: the opeka-staff realm (Δημόσια Διοίκηση provider, roles) instead of opeka-citizens.
STAFF = os.environ.get("STAFF") == "1"
REALM = f"{KC}/realms/{'opeka-staff' if STAFF else 'opeka-citizens'}/protocol/openid-connect"
IDP = "gsis-govuser-test" if STAFF else "gsis-taxis-test"
# Default: the public opeka-portal client. A confidential client: CLIENT=… SECRET=… REDIRECT=… python3 smoke-test.py
CLIENT = os.environ.get("CLIENT", "opeka-portal")
SECRET = os.environ.get("SECRET")
PORTAL = os.environ.get("REDIRECT", "http://localhost:5173/")
USER, PASSWORD, AFM = "Testked1", "Testked1!", "660074100"
# LOCAL=1: log in with a Keycloak account (polites1 / ypallilos1) instead of GSIS.
LOCAL = os.environ.get("LOCAL") == "1"
if LOCAL:
    USER, PASSWORD, AFM = ("ypallilos1", "Ypallilos1!", "056272436") if STAFF else ("polites1", "Polites1!", AFM)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


# Keycloak's cookies are Secure; browsers still send them to http://localhost (secure context), urllib doesn't.
jar = http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(secure_protocols=("https", "http")))
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)


def request(url, data=None):
    """Returns (status, location, body) without following redirects."""
    body = urllib.parse.urlencode(data).encode() if data else None
    try:
        res = opener.open(url, body)
        return res.status, None, res.read().decode()
    except urllib.error.HTTPError as err:
        return err.code, err.headers.get("Location"), err.read().decode(errors="replace")


def follow(url, data=None, stop_prefix=None):
    """Follows redirects until a page renders or a Location starts with stop_prefix."""
    status, location, body = request(url, data)
    while location:
        location = urllib.parse.urljoin(url, location)
        if stop_prefix and location.startswith(stop_prefix):
            return location, None
        url = location
        status, location, body = request(url)
    assert status == 200, f"{status} at {url}: {body[:300]}"
    return url, body


verifier = secrets.token_urlsafe(48)
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
auth = f"{REALM}/auth?" + urllib.parse.urlencode({
    "client_id": CLIENT, "redirect_uri": PORTAL, "response_type": "code", "scope": "openid",
    "state": "smoke", "code_challenge": challenge, "code_challenge_method": "S256",
    **({} if LOCAL else {"kc_idp_hint": IDP}),
})

if LOCAL:
    # 1–2. Keycloak's own login form; Keycloak redirects back to the portal with a code.
    _, page = follow(auth)
    action = re.search(r'id="kc-form-login"[^>]*action="([^"]+)"', page)
    assert action, "no Keycloak login form"
    back, page = follow(action.group(1).replace("&amp;", "&"), {"username": USER, "password": PASSWORD}, stop_prefix=PORTAL)
    assert back, f"local login failed:\n{re.sub(r'<[^>]+>', ' ', page)[:800]}"
    print("1–2. Keycloak account login, code returned to portal")
else:
    # 1. Keycloak hands the browser to the (mock) GSIS login page.
    gsis_url, page = follow(auth)
    assert ("/oauth2servergov/" if STAFF else "/oauth2server/") + "oauth/authorize" in gsis_url and "TAXISnet" in page, f"not on GSIS login: {gsis_url}"
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(gsis_url).query))
    assert query["scope"] == "read", f"ΚΕΔ requires scope=read, got {query['scope']!r}"
    print("1. GSIS login page, scope=read")

    # 2. Submit TAXISnet credentials; Keycloak brokers and redirects back to the portal with a code.
    form = {"client_id": query["client_id"], "redirect_uri": query["redirect_uri"], "state": query["state"],
            "username": USER, "password": PASSWORD}
    back, page = follow(gsis_url.split("?")[0], form, stop_prefix=PORTAL)
    assert back, f"no redirect to portal; Keycloak showed a page instead:\n{re.sub(r'<[^>]+>', ' ', page)[:800]}"
    print("2. brokered login, code returned to portal")
code = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(back).query))["code"]

# 3. Portal exchanges the code (PKCE, public client) and reads the claims.
token_form = {"grant_type": "authorization_code", "client_id": CLIENT,
              "code": code, "redirect_uri": PORTAL, "code_verifier": verifier}
if SECRET:
    token_form["client_secret"] = SECRET
status, _, body = request(f"{REALM}/token", token_form)
assert status == 200, f"token exchange {status}: {body}"
payload = json.loads(base64.urlsafe_b64decode(json.loads(body)["access_token"].split(".")[1] + "=="))
assert payload.get("afm") == AFM, f"afm claim {payload.get('afm')!r} != {AFM}"
print(f"3. access token: afm={payload['afm']} name={payload.get('family_name')} {payload.get('given_name')}"
      f" fatherName={payload.get('fatherName')} birthYear={payload.get('birthYear')}")
if LOCAL:
    assert "identity_provider" not in payload, "a Keycloak account must not look like a TAXISnet login"
if "identity_provider" in payload:
    assert payload["identity_provider"] == IDP, payload["identity_provider"]
    print(f"4. identity_provider={payload['identity_provider']}")
if STAFF:
    print(f"5. roles={payload.get('roles')}")
    if LOCAL:
        assert set(payload.get("roles", [])) >= {"OPEKA_LAE", "OPEKA_DOCUMENTS", "OPEKA_DEBTORS"}, payload.get("roles")
print("OK")
