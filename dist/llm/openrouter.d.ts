import { OpenRouter } from '@openrouter/sdk';
export declare const llm: OpenRouter;
export declare const EMBEDDING_DIM = 1536;
export declare function embed(text: string): Promise<number[]>;
export declare function complete(opts: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
}): Promise<string>;
