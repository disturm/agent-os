# Your First API Call | DeepSeek API Docs

On this page

# Your First API Call

The DeepSeek API uses an API format compatible with OpenAI/Anthropic. By modifying the configuration, you can use the OpenAI/Anthropic SDK or softwares compatible with the OpenAI/Anthropic API to access the DeepSeek API.

PARAM

VALUE

base\_url (OpenAI)

`https://api.deepseek.com`

base\_url (Anthropic)

`https://api.deepseek.com/anthropic`

api\_key

apply for an [API key](https://platform.deepseek.com/api_keys)

model(1)

`deepseek-v4-flash`  
`deepseek-v4-pro`

(1) The `deepseek-v4-flash` model has been updated to DeepSeek-V4-Flash-0731, and the `deepseek-v4-pro` model has been updated to DeepSeek-V4-Pro-0813. The calling method remains unchanged — simply use `deepseek-v4-flash` or `deepseek-v4-pro` to access the latest version.

## Integrate with Agent Tools[​](#integrate-with-agent-tools "Direct link to Integrate with Agent Tools")

DeepSeek Harness is now in developer preview for agent harness developers worldwide. See the [DeepSeek Harness Guide](https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart) for details.

The DeepSeek API is supported by many popular AI agent and coding assistant tools. If you use tools like Claude Code, GitHub Copilot, or OpenCode, you can use DeepSeek as the backend model directly — no code required.

See the [Agent Integrations Guide](/quick_start/agent_integrations/claude_code) for details.

## Invoke The Chat API[​](#invoke-the-chat-api "Direct link to Invoke The Chat API")

Once you have obtained an API key, you can access the DeepSeek model using the following example scripts in the OpenAI API format. This is a non-stream example, you can set the `stream` parameter to `true` to get stream response.

For examples using the Anthropic API format, please refer to [Anthropic API](/guides/anthropic_api).

-   curl
-   python
-   nodejs

```
curl https://api.deepseek.com/chat/completions \  -H "Content-Type: application/json" \  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \  -d '{        "model": "deepseek-v4-pro",        "messages": [          {"role": "system", "content": "You are a helpful assistant."},          {"role": "user", "content": "Hello!"}        ],        "thinking": {"type": "enabled"},        "reasoning_effort": "high",        "stream": false      }'
```

```
# Please install OpenAI SDK first: `pip3 install openai`import osfrom openai import OpenAIclient = OpenAI(    api_key=os.environ.get('DEEPSEEK_API_KEY'),    base_url="https://api.deepseek.com")response = client.chat.completions.create(    model="deepseek-v4-pro",    messages=[        {"role": "system", "content": "You are a helpful assistant"},        {"role": "user", "content": "Hello"},    ],    stream=False,    reasoning_effort="high",    extra_body={"thinking": {"type": "enabled"}})print(response.choices[0].message.content)
```

```
// Please install OpenAI SDK first: `npm install openai`import OpenAI from "openai";const openai = new OpenAI({        baseURL: 'https://api.deepseek.com',        apiKey: process.env.DEEPSEEK_API_KEY,});async function main() {  const completion = await openai.chat.completions.create({    messages: [{ role: "system", content: "You are a helpful assistant." }],    model: "deepseek-v4-pro",    thinking: {"type": "enabled"},    reasoning_effort: "high",    stream: false,  });  console.log(completion.choices[0].message.content);}main();
```

-   [Integrate with Agent Tools](#integrate-with-agent-tools)
-   [Invoke The Chat API](#invoke-the-chat-api)
