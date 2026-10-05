(() => {
  if (globalThis.__plurallLicenseReady) return;

  const SITE_ORIGIN = "https://plurall-licencas.slaybvitor.chatgpt.site";
  const HOST_ID = "plurall-license-gate-host";
  const SESSION_KEY = "plurallLicenseSessionV1";
  const ACTIVITY_ACCESS_KEY = "plurallActivityAccessV1";

  globalThis.__plurallLicenseReady = new Promise((resolve) => {
    void startGate(resolve);
  });

  async function startGate(resolve) {
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    const state = {
      view: "loading",
      mode: "signin",
      busy: false,
      config: null,
      session: null,
      entitlement: null,
      error: "",
      notice: "",
    };

    function render() {
      const isAuth = state.view === "auth";
      const isActivation = state.view === "activation";
      const isSetup = state.view === "setup";
      const isUnlocked = state.view === "unlocked";
      const title = isAuth
        ? state.mode === "signin" ? "Entre na sua conta" : "Crie sua conta"
        : isActivation
          ? "Ative sua chave"
          : isSetup
            ? "Configuração pendente"
            : isUnlocked
              ? "Acesso liberado"
              : "Verificando sua licença";
      const subtitle = isAuth
        ? "Use seu e-mail e uma senha de pelo menos 8 caracteres."
        : isActivation
          ? `Conta: ${state.session?.email || ""}`
          : isSetup
            ? "O serviço de login ainda precisa ser conectado pelo vendedor."
            : isUnlocked
              ? "Abrindo o assistente local..."
              : "Só leva alguns segundos.";

      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; }
          .backdrop {
            min-height: 100vh; display: grid; place-items: center; padding: 20px;
            background: rgba(37, 20, 61, .38); backdrop-filter: blur(8px);
            font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #2b2340;
          }
          .card {
            width: min(440px, calc(100vw - 32px)); overflow: hidden; border: 1px solid #ddd6fe;
            border-radius: 24px; background: #fff; box-shadow: 0 28px 90px rgba(76, 29, 149, .28);
          }
          .top { padding: 24px 24px 18px; background: radial-gradient(circle at 90% 0, #ede9fe, transparent 48%), #fff; }
          .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 22px; }
          .logo { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 13px; color: #fff; background: linear-gradient(135deg, #7c3aed, #9333ea); font-size: 20px; font-weight: 900; box-shadow: 0 9px 24px rgba(124,58,237,.28); }
          .brand strong { display: block; color: #3b1d68; font-size: 14px; }
          .brand span { display: block; color: #7c3aed; font-size: 11px; }
          h1 { margin: 0; color: #281a3d; font-size: 26px; line-height: 1.15; letter-spacing: -.03em; }
          .subtitle { margin: 8px 0 0; color: #6b6475; }
          .body { padding: 0 24px 24px; }
          form { display: grid; gap: 13px; }
          label { display: grid; gap: 6px; color: #4b3d5f; font-size: 12px; font-weight: 750; }
          input {
            width: 100%; height: 44px; border: 1px solid #ddd6fe; border-radius: 11px; padding: 0 12px;
            color: #281a3d; background: #fff; font: inherit; outline: none;
          }
          input:focus { border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139,92,246,.15); }
          input.license { text-transform: uppercase; letter-spacing: .08em; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
          button { appearance: none; border: 0; border-radius: 11px; min-height: 43px; padding: 0 15px; cursor: pointer; font: inherit; font-weight: 800; }
          button:disabled { cursor: wait; opacity: .62; }
          .primary { width: 100%; color: #fff; background: linear-gradient(135deg, #7c3aed, #9333ea); box-shadow: 0 10px 24px rgba(124,58,237,.22); }
          .link { min-height: auto; padding: 3px; color: #6d28d9; background: transparent; }
          .switch { margin: 14px 0 0; color: #746d7d; text-align: center; font-size: 12px; }
          .message { margin: 0 0 14px; padding: 11px 12px; border-radius: 11px; font-size: 12px; }
          .message.error { color: #9f1239; background: #fff1f2; border: 1px solid #fecdd3; }
          .message.notice { color: #5b21b6; background: #f5f3ff; border: 1px solid #ddd6fe; }
          .account { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 15px; padding: 11px 12px; border-radius: 11px; background: #faf5ff; color: #5b21b6; font-size: 12px; }
          .account button { min-height: auto; padding: 2px; color: #7c3aed; background: transparent; font-size: 11px; }
          .loader { width: 30px; height: 30px; margin: 6px auto 20px; border: 3px solid #ede9fe; border-top-color: #7c3aed; border-radius: 50%; animation: spin .8s linear infinite; }
          .success { display: grid; place-items: center; width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 18px; color: #fff; background: linear-gradient(135deg, #7c3aed, #9333ea); font-size: 28px; font-weight: 900; }
          .center { text-align: center; }
          .setup { padding: 13px; border-radius: 12px; color: #5b21b6; background: #f5f3ff; border: 1px solid #ddd6fe; }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
        <div class="backdrop">
          <section class="card" role="dialog" aria-modal="true" aria-labelledby="plurall-license-title">
            <div class="top">
              <div class="brand"><div class="logo">P</div><div><strong>Assistente local</strong><span>Licença protegida</span></div></div>
              <h1 id="plurall-license-title">${escapeHtml(title)}</h1>
              <p class="subtitle">${escapeHtml(subtitle)}</p>
            </div>
            <div class="body">
              ${state.error ? `<p class="message error">${escapeHtml(state.error)}</p>` : ""}
              ${state.notice ? `<p class="message notice">${escapeHtml(state.notice)}</p>` : ""}
              ${state.view === "loading" ? '<div class="loader" aria-label="Carregando"></div>' : ""}
              ${isSetup ? '<div class="setup">A extensão já está instalada corretamente. Assim que o vendedor concluir a conexão do login, esta tela será liberada.</div>' : ""}
              ${isAuth ? `
                <form id="license-auth-form">
                  <label>E-mail<input id="license-email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></label>
                  <label>Senha<input id="license-password" type="password" minlength="8" autocomplete="${state.mode === "signin" ? "current-password" : "new-password"}" required placeholder="Mínimo de 8 caracteres"></label>
                  <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "Aguarde..." : state.mode === "signin" ? "Entrar" : "Criar conta"}</button>
                </form>
                <p class="switch">${state.mode === "signin" ? "Primeiro acesso?" : "Já tem uma conta?"} <button id="license-switch-mode" class="link" type="button">${state.mode === "signin" ? "Criar conta" : "Entrar"}</button></p>
              ` : ""}
              ${isActivation ? `
                <div class="account"><span>${escapeHtml(state.session?.email || "")}</span><button id="license-logout" type="button">Sair</button></div>
                <form id="license-activation-form">
                  <label>Chave de licença<input id="license-key" class="license" required maxlength="24" placeholder="PLR-XXXX-XXXX-XXXX-XXXX"></label>
                  <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "Validando..." : "Ativar neste computador"}</button>
                </form>
              ` : ""}
              ${isUnlocked ? '<div class="center"><div class="success">✓</div><strong>Licença válida</strong></div>' : ""}
            </div>
          </section>
        </div>
      `;

      shadow.getElementById("license-switch-mode")?.addEventListener("click", () => {
        state.mode = state.mode === "signin" ? "signup" : "signin";
        state.error = "";
        state.notice = "";
        render();
      });
      shadow.getElementById("license-logout")?.addEventListener("click", async () => {
        await storageRemove(SESSION_KEY);
        await storageRemove(ACTIVITY_ACCESS_KEY);
        state.session = null;
        state.entitlement = null;
        state.view = "auth";
        state.error = "";
        state.notice = "";
        render();
      });
      shadow.getElementById("license-auth-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitAuth(shadow.getElementById("license-email")?.value, shadow.getElementById("license-password")?.value);
      });
      shadow.getElementById("license-activation-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        void activateLicense(shadow.getElementById("license-key")?.value);
      });
    }

    async function submitAuth(rawEmail, rawPassword) {
      const email = String(rawEmail || "").trim().toLowerCase();
      const password = String(rawPassword || "");
      if (!email || password.length < 8) return;
      state.busy = true;
      state.error = "";
      state.notice = "";
      render();
      try {
        const path = state.mode === "signin"
          ? "/auth/v1/token?grant_type=password"
          : "/auth/v1/signup";
        const payload = await supabaseRequest(path, { email, password });
        if (!payload.access_token || !payload.refresh_token) {
          state.mode = "signin";
          state.notice = "Conta criada. Confirme seu e-mail e depois entre.";
          return;
        }
        state.session = toSession(payload, email);
        await storageSet({ [SESSION_KEY]: state.session });
        await checkEntitlement();
      } catch (error) {
        state.error = friendlyError(error, "Não foi possível acessar a conta.");
      } finally {
        state.busy = false;
        render();
      }
    }

    async function activateLicense(rawKey) {
      const licenseKey = String(rawKey || "").trim().toUpperCase();
      if (!licenseKey) return;
      state.busy = true;
      state.error = "";
      render();
      try {
        state.session = await ensureFreshSession(state.session);
        const response = await fetch(`${SITE_ORIGIN}/api/licenses/activate`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${state.session.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ licenseKey }),
        });
        const payload = await readJson(response);
        if (!response.ok || !payload?.entitlement?.valid) {
          throw new Error(payload?.error || "Não foi possível ativar essa chave.");
        }
        state.entitlement = payload.entitlement;
        unlock();
      } catch (error) {
        state.error = friendlyError(error, "Não foi possível ativar essa chave.");
      } finally {
        state.busy = false;
        if (state.view !== "unlocked") render();
      }
    }

    async function checkEntitlement() {
      try {
        state.session = await ensureFreshSession(state.session);
        await storageSet({ [SESSION_KEY]: state.session });
        const response = await fetch(`${SITE_ORIGIN}/api/licenses/entitlement`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${state.session.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        });
        const payload = await readJson(response);
        if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente.");
        if (!response.ok) throw new Error(payload?.error || "Não foi possível consultar a licença.");
        state.entitlement = payload.entitlement || null;
        if (state.entitlement?.valid) unlock();
        else state.view = "activation";
      } catch (error) {
        await storageRemove(SESSION_KEY);
        state.session = null;
        state.view = "auth";
        state.error = friendlyError(error, "Entre novamente para continuar.");
      }
    }

    function unlock() {
      void rememberActivityAccess();
      state.view = "unlocked";
      state.error = "";
      state.notice = "";
      render();
      window.setTimeout(() => {
        host.remove();
        resolve(true);
      }, 650);
    }

    async function rememberActivityAccess() {
      await storageSet({
        [ACTIVITY_ACCESS_KEY]: {
          email: state.session?.email || "",
          verifiedAt: Date.now(),
        },
      });
    }

    async function bootstrap() {
      render();
      try {
        const response = await fetch(`${SITE_ORIGIN}/api/config`, { cache: "no-store" });
        const payload = await readJson(response);
        state.config = payload?.auth || null;
        if (!response.ok || !state.config?.configured) {
          state.view = "setup";
          return;
        }
        const stored = await storageGet(SESSION_KEY);
        state.session = stored?.[SESSION_KEY] || null;
        if (!state.session?.accessToken || !state.session?.refreshToken) {
          state.session = null;
          state.view = "auth";
          return;
        }
        const cached = await storageGet(ACTIVITY_ACCESS_KEY);
        const access = cached?.[ACTIVITY_ACCESS_KEY];
        const cameFromActivities = (() => {
          try { return new URL(document.referrer).origin === location.origin; } catch { return false; }
        })();
        if (
          cameFromActivities &&
          access?.email === state.session.email &&
          Date.now() - Number(access.verifiedAt || 0) < 12 * 60 * 60 * 1000
        ) {
          unlock();
          return;
        }
        await checkEntitlement();
      } catch (error) {
        state.view = "setup";
        state.error = friendlyError(error, "Não foi possível conectar ao serviço de licenças.");
      } finally {
        if (state.view !== "unlocked") render();
      }
    }

    async function supabaseRequest(path, body) {
      const response = await fetch(`${cleanUrl(state.config.supabaseUrl)}${path}`, {
        method: "POST",
        headers: {
          apikey: state.config.supabaseAnonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(payload?.error_description || payload?.msg || "Não foi possível acessar a conta.");
      }
      return payload;
    }

    function toSession(payload, fallbackEmail) {
      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt: payload.expires_at || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600),
        email: payload.user?.email || fallbackEmail,
      };
    }

    async function ensureFreshSession(session) {
      if (!session) throw new Error("Entre na sua conta para continuar.");
      if (Number(session.expiresAt) > Math.floor(Date.now() / 1000) + 90) return session;
      const payload = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
        refresh_token: session.refreshToken,
      });
      return toSession(payload, session.email);
    }

    await bootstrap();
  }

  function storageGet(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], resolve));
  }

  function storageSet(value) {
    return new Promise((resolve) => chrome.storage.local.set(value, resolve));
  }

  function storageRemove(key) {
    return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      throw new Error("O serviço retornou uma resposta inválida.");
    }
  }

  function cleanUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function friendlyError(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
