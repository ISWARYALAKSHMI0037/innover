import { config } from '../config.js';

export class LlmError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

export function llmStatus() {
  const provider = config.llm.provider;
  const cfg = config.llm[provider];

  return {
    provider,
    model: cfg?.model,
    configured: Boolean(cfg?.apiKey),
  };
}

export const supportsPdfNatively = () =>
  config.llm.provider === 'anthropic';

function parseJsonLoose(text) {
  if (!text) {
    throw new LlmError('parse', 'The AI returned an empty response.');
  }

  let cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start === -1 || end === -1) {
    throw new LlmError(
      'parse',
      'The AI response was not valid JSON.'
    );
  }

  cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new LlmError(
      'parse',
      'The AI response could not be parsed as JSON.'
    );
  }
}

async function post(url, headers, body) {
  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.llm.timeoutMs),
    });
  } catch (err) {
    if (
      err?.name === 'TimeoutError' ||
      err?.name === 'AbortError'
    ) {
      throw new LlmError(
        'timeout',
        `The AI service did not respond within ${
          config.llm.timeoutMs / 1000
        }s.`
      );
    }

    throw new LlmError(
      'http',
      `Could not reach the AI service (${
        err?.cause?.code || err?.message
      }).`
    );
  }

  if (!response.ok) {
    let detail = '';

    try {
      const errorData = await response.json();
      detail =
        errorData?.error?.message ||
        errorData?.message ||
        '';
    } catch {
      // Ignore errors while reading the error response.
    }

    if (response.status === 401 || response.status === 403) {
      throw new LlmError(
        'http',
        'The AI service rejected the API key. Check the key in server/.env.',
        response.status
      );
    }

    if (response.status === 429) {
      throw new LlmError(
        'http',
        'The AI service rate limit or quota was reached. Check your API usage and billing.',
        response.status
      );
    }

    throw new LlmError(
      'http',
      `The AI service returned an error (HTTP ${
        response.status
      }). ${detail}`.trim(),
      response.status
    );
  }

  return response.json();
}

/**
 * Ask the configured LLM for a JSON object.
 *
 * @param {{
 *   system: string,
 *   user: string,
 *   images?: {mediaType: string, data: string}[],
 *   pdf?: {data: string},
 *   maxTokens?: number
 * }} params
 */
export async function completeJson({
  system,
  user,
  images = [],
  pdf = null,
  maxTokens = 3000,
}) {
  const provider = config.llm.provider;
  const cfg = config.llm[provider];

  if (!cfg?.apiKey) {
    throw new LlmError(
      'not_configured',
      `No API key is configured for LLM_PROVIDER="${provider}". Add it to server/.env.`
    );
  }

  if (provider === 'anthropic') {
    const content = [];

    if (pdf) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdf.data,
        },
      });
    }

    for (const image of images) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType,
          data: image.data,
        },
      });
    }

    content.push({
      type: 'text',
      text: user,
    });

    const data = await post(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: cfg.model,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      }
    );

    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      json: parseJsonLoose(text),
      model: data.model || cfg.model,
    };
  }

  if (provider === 'openai' || provider === 'gemini') {
    if (pdf) {
      throw new LlmError(
        'unsupported',
        'This LLM provider cannot read PDF documents directly through this integration. Upload a supported image or use text extracted from the PDF.'
      );
    }

    const content = [
      {
        type: 'text',
        text: user,
      },
    ];

    for (const image of images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${image.mediaType};base64,${image.data}`,
        },
      });
    }

    const data = await post(
      `${cfg.baseUrl}/chat/completions`,
      {
        authorization: `Bearer ${cfg.apiKey}`,
      },
      {
        model: cfg.model,
        max_tokens: maxTokens,
        response_format: {
          type: 'json_object',
        },
        messages: [
          {
            role: 'system',
            content: system,
          },
          {
            role: 'user',
            content,
          },
        ],
      }
    );

    return {
      json: parseJsonLoose(
        data.choices?.[0]?.message?.content
      ),
      model: data.model || cfg.model,
    };
  }

  throw new LlmError(
    'unsupported',
    `Unknown LLM_PROVIDER "${provider}". Use "gemini", "openai", or "anthropic".`
  );
}

/** Retry once on malformed JSON. */
export async function completeJsonWithRetry(args) {
  try {
    return await completeJson(args);
  } catch (err) {
    if (err instanceof LlmError && err.code === 'parse') {
      return completeJson(args);
    }

    throw err;
  }
}