import { OpenRouter } from '@openrouter/sdk';
import * as orErrors from '@openrouter/sdk/models/errors';
import { config } from '../config.js';
export const llm = new OpenRouter({
    apiKey: config.OPENROUTER_API_KEY,
    httpReferer: 'https://github.com/Brainboxai-IL/adel-assistant',
    appTitle: 'Adel Assistant',
});
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const EMBEDDING_DIM = 1536;
export async function embed(text) {
    const raw = await llm.embeddings.generate({
        requestBody: { input: text, model: EMBEDDING_MODEL },
    });
    const res = (typeof raw === 'string' ? JSON.parse(raw) : raw);
    const vec = res.data?.[0]?.embedding;
    if (!vec || vec.length !== EMBEDDING_DIM) {
        throw new Error(`embedding failed: got ${vec?.length ?? 0} dims, expected ${EMBEDDING_DIM}`);
    }
    return vec;
}
export async function complete(opts) {
    try {
        const res = await llm.chat.send({
            chatRequest: {
                model: config.OPENROUTER_MODEL,
                maxTokens: opts.maxTokens ?? 1024,
                temperature: opts.temperature ?? 0.3,
                messages: [
                    { role: 'system', content: opts.system },
                    { role: 'user', content: opts.user },
                ],
            },
        });
        return res.choices?.[0]?.message?.content ?? '';
    }
    catch (err) {
        if (err instanceof orErrors.UnauthorizedResponseError) {
            throw new Error('OpenRouter: invalid API key');
        }
        if (err instanceof orErrors.PaymentRequiredResponseError) {
            throw new Error('OpenRouter: insufficient credits');
        }
        if (err instanceof orErrors.TooManyRequestsResponseError) {
            throw new Error('OpenRouter: rate limited');
        }
        throw err;
    }
}
//# sourceMappingURL=openrouter.js.map