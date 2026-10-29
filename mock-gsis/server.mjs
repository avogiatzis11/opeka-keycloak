// Τοπικό mock του GSIS OAuth2 server (TAXISnet) για ανάπτυξη χωρίς διαπιστευτήρια ΕΔΑ.
// Runs in compose.yaml; the patched gsis-taxis-test provider reaches it via GSIS_TEST_URL.
// Mirrors the 4 endpoints of the ΚΕΔ document v6.7 and its test users. Never deploy this.
import http from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.MOCK_GSIS_PORT ?? 8090);
const BASE = "/oauth2server";

// Usernames/passwords/ΑΦΜ from the ΚΕΔ document; names are placeholders.
const USERS = {
  Testked1: { password: "Testked1!", taxid: "660074100", lastname: "ΔΟΚΙΜΑΣΤΙΚΟΣ", firstname: "ΧΡΗΣΤΗΣ ΕΝΑ", fathername: "ΓΕΩΡΓΙΟΣ", mothername: "ΜΑΡΙΑ", birthyear: "1970" },
  Testked2: { password: "Testked2!", taxid: "660074111", lastname: "ΔΟΚΙΜΑΣΤΙΚΗ", firstname: "ΧΡΗΣΤΡΙΑ ΔΥΟ", fathername: "ΝΙΚΟΛΑΟΣ", mothername: "ΕΛΕΝΗ", birthyear: "1985" },
  Testked3: { password: "Testked3!", taxid: "660074123", lastname: "ΔΟΚΙΜΑΣΤΙΚΟΣ", firstname: "ΧΡΗΣΤΗΣ ΤΡΙΑ", fathername: "ΙΩΑΝΝΗΣ", mothername: "ΑΙΚΑΤΕΡΙΝΗ", birthyear: "1992" },
  Testked4: { password: "Testked4!", taxid: "660074135", lastname: "ΔΟΚΙΜΑΣΤΙΚΗ", firstname: "ΧΡΗΣΤΡΙΑ ΤΕΣΣΕΡΑ", fathername: "ΔΗΜΗΤΡΙΟΣ", mothername: "ΣΟΦΙΑ", birthyear: "1960" },
  Testked5: { password: "Testked5!", taxid: "660074147", lastname: "ΔΟΚΙΜΑΣΤΙΚΟΣ", firstname: "ΧΡΗΣΤΗΣ ΠΕΝΤΕ", fathername: "ΚΩΝΣΤΑΝΤΙΝΟΣ", mothername: "ΑΝΝΑ", birthyear: "2000" },
  Nomked1: { password: "Nomked1!", taxid: "098120800", lastname: "ΔΟΚΙΜΑΣΤΙΚΗ ΕΤΑΙΡΕΙΑ ΑΕ" },
};

const codes = new Map();  // code → { username, clientId, redirectUri }
const tokens = new Map(); // access token → username

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const pad = (value, width) => String(value ?? "").padEnd(width); // GSIS returns char-padded fields

function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(new URLSearchParams(data)));
  });
}

function send(res, status, body, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, ...headers });
  res.end(body);
}

function loginPage(query, error = "") {
  const hidden = ["client_id", "redirect_uri", "state"]
    .map(key => `<input type="hidden" name="${key}" value="${esc(query.get(key))}">`).join("");
  const rows = Object.entries(USERS).map(([name, u]) => `<tr><td>${name}</td><td>${u.password}</td><td>${u.taxid}</td></tr>`).join("");
  return `<!doctype html><html lang="el"><meta charset="utf-8"><title>MOCK GSIS — TAXISnet</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto">
<p style="background:#fef3c7;padding:8px;border-radius:6px"><b>MOCK</b> — τοπικός προσομοιωτής, όχι το πραγματικό TAXISnet.</p>
<h2>Σύνδεση TAXISnet</h2>${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ""}
<form method="post" action="${BASE}/oauth/authorize">${hidden}
<p><label>Χρήστης<br><input name="username" value="Testked1" autofocus></label></p>
<p><label>Κωδικός<br><input name="password" type="password" value="Testked1!"></label></p>
<button>Είσοδος</button></form>
<table style="margin-top:24px;font-size:12px" border="1" cellpadding="4"><tr><th>Χρήστης</th><th>Κωδικός</th><th>ΑΦΜ</th></tr>${rows}</table>
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path === `${BASE}/oauth/authorize` && req.method === "GET") {
    const q = url.searchParams;
    if (q.get("response_type") !== "code" || q.get("scope") !== "read" || !q.get("client_id") || !q.get("redirect_uri")) {
      return send(res, 400, "authorize: expected response_type=code, scope=read, client_id, redirect_uri");
    }
    return send(res, 200, loginPage(q), "text/html; charset=utf-8");
  }

  if (path === `${BASE}/oauth/authorize` && req.method === "POST") {
    const form = await readBody(req);
    const user = USERS[form.get("username")];
    if (!user || user.password !== form.get("password")) {
      return send(res, 200, loginPage(form, "Λάθος στοιχεία."), "text/html; charset=utf-8");
    }
    const code = randomBytes(4).toString("hex").toUpperCase();
    codes.set(code, { username: form.get("username"), clientId: form.get("client_id"), redirectUri: form.get("redirect_uri") });
    const back = new URL(form.get("redirect_uri"));
    back.searchParams.set("code", code);
    if (form.get("state")) back.searchParams.set("state", form.get("state"));
    return send(res, 302, "", "text/plain", { Location: back.toString() });
  }

  if (path === `${BASE}/oauth/token` && req.method === "POST") {
    const form = await readBody(req);
    const grant = codes.get(form.get("code"));
    codes.delete(form.get("code"));
    // scope is checked at authorize only: Keycloak's broker doesn't resend it here.
    if (form.get("grant_type") !== "authorization_code" || !form.get("client_secret")
      || !grant || grant.clientId !== form.get("client_id") || grant.redirectUri !== form.get("redirect_uri")) {
      return send(res, 400, JSON.stringify({ error: "invalid_grant" }), "application/json");
    }
    const token = randomBytes(16).toString("hex");
    tokens.set(token, grant.username);
    return send(res, 200, JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, scope: "read" }), "application/json");
  }

  if (path === `${BASE}/userinfo` && req.method === "GET") {
    const username = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!username) return send(res, 401, "invalid_token");
    const u = USERS[username];
    const attrs = u.firstname
      ? `userid="${esc(username)}" taxid="${pad(u.taxid, 12)}" lastname="${esc(u.lastname)}" firstname="${esc(u.firstname)}" fathername="${esc(u.fathername)}" mothername="${esc(u.mothername)}" birthyear="${u.birthyear}"`
      : `userid="${esc(username)}" taxid="${pad(u.taxid, 12)}" lastname="${esc(u.lastname)}"`;
    return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?><root><userinfo ${attrs}/></root>`, "application/xml; charset=utf-8");
  }

  if (path.startsWith(`${BASE}/logout/`) && req.method === "GET") {
    const target = url.searchParams.get("url");
    return target ? send(res, 302, "", "text/plain", { Location: target }) : send(res, 200, "logged out");
  }

  send(res, 404, "not found");
});

server.listen(PORT, () => console.log(`MOCK GSIS OAuth2 on http://localhost:${PORT}${BASE}`));
