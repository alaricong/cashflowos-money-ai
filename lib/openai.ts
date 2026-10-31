import 'server-only'

// The ONE place the app talks to OpenAI. Plain fetch (no SDK) against the Chat
// Completions API. Every caller treats the model output as UNTRUSTED.

export const OPENAI_MODEL = 'gpt-4o-mini'

export const openaiKey = () => process.env.OPENAI_API_KEY?.trim() || ''

export type ChatMessage =
  | { role: 'system' | 'user'; content: string | any[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// Our tool definitions use the { name, description, input_schema } shape; OpenAI
// wants { type: 'function', function: { name, description, parameters } }.
export function toOpenAITools(tools: { name: string; description?: string; input_schema: any }[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
  }))
}

export async function chat(opts: {
  messages: ChatMessage[]
  maxTokens: number
  tools?: any[]
}): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey()}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: opts.maxTokens,
      messages: opts.messages,
      ...(opts.tools && opts.tools.length ? { tools: opts.tools } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  const choice = data.choices?.[0] ?? {}
  return {
    content: (choice.message?.content ?? '').trim(),
    toolCalls: choice.message?.tool_calls ?? [],
    finishReason: choice.finish_reason ?? '',
  }
}
