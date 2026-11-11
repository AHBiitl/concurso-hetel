# concurso-hetel

## Minijuego de contraseñas: configuración de IA

El proyecto usa una función de Vercel (`api/analyze-password.js`) para enviar el análisis a OpenRouter. La clave API vive únicamente en variables de entorno del servidor; no la añadas al HTML ni al repositorio.

1. Crea una clave en OpenRouter y elige un modelo compatible con respuestas JSON.
2. Despliega este repositorio en Vercel.
3. En **Project Settings → Environment Variables**, configura:
   - `OPENROUTER_API_KEY`: tu clave privada.
   - `OPENROUTER_MODEL`: identificador del modelo en OpenRouter.
4. Vuelve a desplegar la aplicación. Para desarrollo local, usa Vercel CLI (`vercel dev`) y un archivo `.env.local` basado en `.env.example`; no publiques ese archivo.

La función pide `data_collection: "deny"`, `zdr: true` y desactiva los proveedores alternativos. Si OpenRouter no encuentra un endpoint compatible con esas restricciones, el análisis falla expresamente en lugar de rebajar la protección. Esto no garantiza el borrado absoluto: OpenRouter y el proveedor seleccionado procesan temporalmente la contraseña y aplican sus propias políticas. La aplicación no la escribe en `localStorage` ni la registra intencionadamente; se conserva en la pantalla de resultado para que el jugador pueda verla hasta que pruebe otra contraseña o termine el juego.

El navegador y la función se comunican por HTTPS en producción, y la función usa HTTPS con OpenRouter. El cifrado protege el tránsito, no impide que el servicio de IA procese el texto. Por eso el juego exige confirmar el aviso y recomienda usar exclusivamente contraseñas ficticias. La ruta incluye un límite de frecuencia en memoria por instancia; antes de abrirla al público, configura también limitación de peticiones en la plataforma.

La IA da recomendaciones educativas, no estima el tiempo de descifrado. Los tiempos se calculan localmente con los supuestos y velocidades de referencia que figuran en `index.html`; no se actualizan automáticamente y no son una predicción. El tiempo real depende, entre otras cosas, del algoritmo de hash, sus parámetros y el hardware. Actualiza esos benchmarks desde fuentes verificables antes de presentarlos como actuales.