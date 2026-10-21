# Proveedor del traductor

El traductor es el modelo que recibe los mensajes y llama a Gemini a través de agy. No programa ni lee código, solo pasa texto y sigue
las instrucciones que le devuelve anti, así que no hace falta un modelo grande. Basta con que sepa usar herramientas.

El proveedor se elige la primera vez que se abre anti, y se cambia en cualquier momento con `/configurar` dentro de la app o con
`anti setup` desde la terminal. Hay tres opciones.

## OpenRouter

Es la opción por defecto y la más probada con anti. Con una clave gratuita de OpenRouter se pueden usar sus modelos `:free`, que no
cobran nada pero tienen un límite de peticiones al día. El asistente enseña cuántas quedan al comprobar la clave.

La clave se crea en [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), con una cuenta de Google o de GitHub. El
límite de crédito puede quedarse vacío, porque los modelos gratuitos no lo gastan.

El asistente solo lista los modelos gratuitos que saben usar herramientas, y marca con ★ el que se ha probado a fondo con anti (ahora
Nemotron 3 Ultra). Antes de guardar el modelo, le hace una pregunta corta para comprobar que responde.

Dos cosas a tener en cuenta. Los modelos gratuitos de OpenRouter cambian a menudo, y alguno deja de existir de un día para otro; en ese
caso basta con elegir otro en `/configurar`. Y algunos guardan lo que reciben para entrenar, cosa que OpenRouter indica en la ficha de
cada modelo.

## OpenCode Zen

[Zen](https://opencode.ai/zen) necesita una clave con saldo. Su capa gratuita solo se acepta desde OpenCode y rechaza las peticiones
de anti, así que sin clave Zen no aparece. Con la clave, el asistente lista todos sus modelos con herramientas, y cada mensaje se cobra
al precio del modelo elegido.

## Otros proveedores

Vale cualquier proveedor que soporte OpenCode y funcione con una clave de API: Anthropic, OpenAI, Google, DeepSeek, Groq, Mistral y
muchos más. El asistente enseña la lista completa, que viene de [models.dev](https://models.dev), con un buscador.

La clave se pega en el asistente o se deja en la variable de entorno del proveedor, que aparece junto a su nombre en la lista (por
ejemplo, `ANTHROPIC_API_KEY`). Si hay una guardada y otra en la variable, manda la guardada.

El asistente no puede comprobar estas claves sin gastar dinero, así que las guarda tal cual. Si una es incorrecta, el error sale en el
primer mensaje; Anthropic, por ejemplo, responde `invalid x-api-key`.

Estos proveedores cobran cada mensaje. El traductor gasta pocos tokens, así que un modelo pequeño como Claude Haiku o GPT mini sale
barato.

Los que piden algo más que una clave, como Amazon Bedrock, Google Vertex o Azure, se configuran con sus variables de entorno antes de
abrir anti.

## Qué modelo elegir

En la lista solo salen modelos que saben usar herramientas, porque el traductor las necesita para llamar a Gemini. Conviene uno pequeño
y rápido: el trabajo lo hace Gemini, y un modelo grande solo añade espera y coste. Si uno empieza a fallar, se cambia con `/configurar`.

## Dónde se guarda

El modelo está en `~/.config/anti/traductor`, en formato `proveedor/modelo` (por ejemplo, `anthropic/claude-haiku-5-5`), y se puede
editar a mano. La clave está en `~/.local/share/anti/auth.json`.

Si falta la clave del proveedor elegido, anti no usa ningún otro por su cuenta. La barra de abajo dice «No provider selected» hasta que
se configura.
