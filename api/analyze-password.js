const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 8;
const requestsByClient = new Map();

function getClientKey(req) {
  const forwarded = req.headers["x-vercel-forwarded-for"] || req.headers["x-forwarded-for"];
  return String(forwarded || "unknown").split(",")[0].trim();
}

function isAllowedOrigin(req) {
  const requestHost = req.headers["x-forwarded-host"] || req.headers.host;
  const requestProtocol = req.headers["x-forwarded-proto"];
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestHost || "");
  if (!isLocalHost && requestProtocol !== "https") return false;

  const origin = req.headers.origin;
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const isLocal = originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1";
    return originUrl.host === requestHost &&
      ((originUrl.protocol === "https:" && requestProtocol === "https") ||
       (isLocal && originUrl.protocol === "http:"));
  } catch {
    return false;
  }
}

function takeRateLimitToken(clientKey, now) {
  for (const [key, bucket] of requestsByClient) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) requestsByClient.delete(key);
  }

  const bucket = requestsByClient.get(clientKey);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    requestsByClient.set(clientKey, { startedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count++;
  return true;
}

function cleanText(value, password) {
  if (typeof value !== "string") return "";
  const escapedPassword = password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value
    .replace(new RegExp(escapedPassword, "gi"), "[contraseña oculta]")
    .slice(0, 400);
}

function cleanList(value, password) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4)
    .map(item => cleanText(item, password))
    .filter(Boolean);
}

function redactSecrets(value, secrets) {
  let text = String(value || "");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[redactado]");
  }
  return text.slice(0, 300);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    return res.status(415).json({ error: "Se requiere una petición JSON." });
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: "Origen no permitido." });
  }
  if (Number(req.headers["content-length"] || 0) > 2048) {
    return res.status(413).json({ error: "La petición es demasiado grande." });
  }
  if (!takeRateLimitToken(getClientKey(req), Date.now())) {
    return res.status(429).json({ error: "Has hecho varios análisis seguidos. Espera un minuto y prueba de nuevo." });
  }

  const password = req.body && req.body.password;
  if (typeof password !== "string" || password.length < 1 || password.length > 128) {
    return res.status(400).json({ error: "La contraseña de prueba debe tener entre 1 y 128 caracteres." });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) {
    return res.status(503).json({ error: "El análisis con IA no está configurado todavía." });
  }

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" },
        provider: {
          // data_collection: "deny",
          // zdr: true,
          allow_fallbacks: false
        },
        messages: [
          {
            role: "system",
            content: "Eres un tutor de ciberseguridad. Analiza una contraseña de prueba solo para dar consejos generales, amables y breves. No calcules tiempos de descifrado ni afirmes que una contraseña sea invulnerable. Nunca repitas, cites ni incluyas la contraseña original en tu respuesta. Devuelve únicamente JSON válido con estas claves: summary (cadena), strengths (lista de cadenas), weaknesses (lista de cadenas), recommendations (lista de cadenas). Máximo 4 elementos en cada lista."
          },
          {
            role: "user",
            content: `Analiza esta contraseña de prueba sin volver a escribirla: ${JSON.stringify(password)}`
          }
        ]
      })
    });

    if (!upstream.ok) {
      let upstreamError = "";
      try {
        const errorPayload = await upstream.json();
        upstreamError = errorPayload.error && (errorPayload.error.message || errorPayload.error.code);
      } catch {
        upstreamError = "";
      }
      const safeError = redactSecrets(upstreamError, [password, apiKey]);
      console.error("OpenRouter request failed", {
        status: upstream.status,
        model,
        error: safeError || "No error message returned"
      });
      return res.status(502).json({
        error: safeError
          ? `OpenRouter respondió ${upstream.status}: ${safeError}`
          : `OpenRouter respondió con HTTP ${upstream.status}.`,
        upstreamStatus: upstream.status
      });
    }

    const payload = await upstream.json();
    const content = payload.choices && payload.choices[0] &&
      payload.choices[0].message && payload.choices[0].message.content;
    if (typeof content !== "string") {
      return res.status(502).json({ error: "El servicio de IA devolvió una respuesta no válida." });
    }

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch {
      return res.status(502).json({ error: "El servicio de IA devolvió una respuesta no válida." });
    }
    if (typeof analysis.summary !== "string" || !analysis.summary.trim()) {
      return res.status(502).json({ error: "El servicio de IA devolvió una respuesta no válida." });
    }

    return res.status(200).json({
      analysis: {
        summary: cleanText(analysis.summary, password),
        strengths: cleanList(analysis.strengths, password),
        weaknesses: cleanList(analysis.weaknesses, password),
        recommendations: cleanList(analysis.recommendations, password)
      }
    });
  } catch (error) {
    const safeError = redactSecrets(error && error.message, [password, apiKey]);
    console.error("OpenRouter request error", {
      model,
      error: safeError || "Unknown network error"
    });
    return res.status(502).json({
      error: safeError
        ? `No se pudo completar la petición a OpenRouter: ${safeError}`
        : "No se pudo conectar con el servicio de IA.",
      upstreamStatus: null
    });
  }
};
