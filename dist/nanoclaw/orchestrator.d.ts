import type { AdelUser } from '../storage/users.js';
export type Route = 'script' | 'rag_grounded' | 'draft_for_owner' | 'llm_owner' | 'error';
export interface RouteResult {
    reply: string;
    route: Route;
    handler?: string;
    draftId?: number;
    latencyMs: number;
}
export declare function route(args: {
    channel: string;
    user: AdelUser;
    query: string;
}): Promise<RouteResult>;
