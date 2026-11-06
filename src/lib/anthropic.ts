import Anthropic from '@anthropic-ai/sdk';

export interface DraftQuestion {
  stem: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stem: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
        },
        required: ['stem', 'options', 'correctIndex', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const;

/**
 * Drafts MCQs for a topic by calling the Claude API directly from the browser.
 * The key is supplied by the user and kept in localStorage only.
 */
export async function generateQuestions(opts: {
  apiKey: string;
  topic: string;
  section: string;
  count: number;
  difficulty: string;
  focus?: string;
}): Promise<DraftQuestion[]> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });

  const prompt = [
    `Write ${opts.count} original single-best-answer multiple-choice questions for a dermatology trainee preparing for board/specialty exams.`,
    `Topic: ${opts.topic} (section: ${opts.section}).`,
    `Difficulty: ${opts.difficulty}.`,
    opts.focus ? `Focus on: ${opts.focus}.` : '',
    'Each question should have a clinical vignette or a clear stem, exactly 5 plausible options, one correct answer (correctIndex is 0-based), and a concise explanation of why the answer is correct and why key distractors are wrong.',
    'Write everything in your own words. Do not reproduce text from any textbook.',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this request. Try rephrasing the topic or focus.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The response was cut off. Try asking for fewer questions.');
  }

  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
  let parsed: { questions: DraftQuestion[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Could not read the generated questions. Please try again.');
  }
  return (parsed.questions ?? [])
    .filter((q) => q.stem && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({
      ...q,
      correctIndex: Math.min(Math.max(0, q.correctIndex), q.options.length - 1),
    }));
}

export function describeApiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Invalid API key. Check it in Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key does not have permission for this request.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited — wait a moment and try again.';
  if (e instanceof Anthropic.BadRequestError) return `Bad request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your connection.';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return 'Unknown error';
}
