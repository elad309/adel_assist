import { classify } from '../intent/classifier.js';
import { bank } from '../scripts/index.js';
import { complete } from '../llm/openrouter.js';
import { logExecution } from '../storage/causa.js';
import { logFallback } from '../teacher/teacher-guard.js';
import { answerFromDocs } from '../documents/rag.js';
import { createDraft } from '../storage/drafts.js';
const OWNER_FALLBACK_SYSTEM = `את עוזרת אישית של בעל עסק קטן.
ביצועיסטית, חמה, משפטים קצרים, עברית טבעית.
הבעלים כתב הודעה שאין לה סקריפט. ענה בקצרה.
אם הבעלים מבקש פעולה שאינך יכולה לבצע (תשלום, שיחה, הזמנה) — אמרי במפורש שזה יתווסף בעתיד.`;
const CLIENT_DRAFT_SYSTEM = `אתה עוזר וירטואלי שעונה ללקוחות בשם בעל עסק קטן.
תפקידך לנסח טיוטת תשובה ידידותית, מקצועית, קצרה (1-3 משפטים).
הטיוטה תוצג לבעלים לאישור לפני שתישלח. כתוב בעברית.
אם השאלה דורשת מידע שאתה לא יודע (תאריך פנוי, מחיר ספציפי) — נסח תשובה שמבטיחה חזרה: "אבדוק מול הצוות ואחזור אליך תוך X".`;
export async function route(args) {
    const startedAt = Date.now();
    try {
        // ── Owners and employees: same scripts-first flow as before. ────────
        if (args.user.role === 'owner' || args.user.role === 'employee') {
            const intent = await classify(args.query);
            if (intent && intent.confidence >= 0.5) {
                const script = bank.find(intent);
                if (script) {
                    const reply = await script.run(intent, {
                        rawQuery: args.query,
                        user: args.user,
                    });
                    const latencyMs = Date.now() - startedAt;
                    await logExecution({
                        user_id: args.user.id,
                        channel: args.channel,
                        query: args.query,
                        intent,
                        route: 'script',
                        handler: script.name,
                        latency_ms: latencyMs,
                        success: true,
                        response: reply,
                    });
                    return { reply, route: 'script', handler: script.name, latencyMs };
                }
            }
            const reply = await complete({
                system: OWNER_FALLBACK_SYSTEM,
                user: args.query,
                maxTokens: 500,
            });
            const latencyMs = Date.now() - startedAt;
            await Promise.all([
                logExecution({
                    user_id: args.user.id,
                    channel: args.channel,
                    query: args.query,
                    intent,
                    route: 'llm_owner',
                    latency_ms: latencyMs,
                    success: true,
                    response: reply,
                }),
                logFallback({
                    userId: args.user.id,
                    query: args.query,
                    intent,
                    llmResponse: reply,
                }),
            ]);
            return { reply, route: 'llm_owner', latencyMs };
        }
        // ── Clients: RAG-first, then fall through to draft-for-owner. ───────
        if (!args.user.business_id) {
            // Unclaimed client — they messaged the bot but haven't been linked
            // to any business yet. Polite holding response.
            return {
                reply: 'תודה על פנייתך! אני מעבירה את ההודעה שלך, נחזור אליך בהקדם.',
                route: 'draft_for_owner',
                latencyMs: Date.now() - startedAt,
            };
        }
        const rag = await answerFromDocs({
            businessId: args.user.business_id,
            query: args.query,
        });
        if (rag.grounded) {
            const latencyMs = Date.now() - startedAt;
            await logExecution({
                user_id: args.user.id,
                channel: args.channel,
                query: args.query,
                intent: { sources: rag.sources.map((s) => s.filename) },
                route: 'rag_grounded',
                latency_ms: latencyMs,
                success: true,
                response: rag.answer,
            });
            return { reply: rag.answer, route: 'rag_grounded', latencyMs };
        }
        // No grounded answer — draft and ping the owner.
        const draftedReply = await complete({
            system: CLIENT_DRAFT_SYSTEM,
            user: args.query,
            maxTokens: 300,
            temperature: 0.4,
        });
        const draft = await createDraft({
            businessId: args.user.business_id,
            clientUserId: args.user.id,
            clientQuery: args.query,
            draftedReply,
            reasoning: 'No grounded answer in document store; falling back to owner approval.',
        });
        const latencyMs = Date.now() - startedAt;
        await logExecution({
            user_id: args.user.id,
            channel: args.channel,
            query: args.query,
            intent: { draft_id: draft.id },
            route: 'draft_for_owner',
            latency_ms: latencyMs,
            success: true,
            response: draftedReply,
        });
        // Tell the client we're checking — DO NOT send the unapproved draft.
        return {
            reply: 'אני בודקת מול הצוות ואחזור אליך בהקדם.',
            route: 'draft_for_owner',
            draftId: draft.id,
            latencyMs,
        };
    }
    catch (err) {
        const latencyMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        console.error('orchestrator error:', message);
        await logExecution({
            user_id: args.user.id,
            channel: args.channel,
            query: args.query,
            intent: null,
            route: 'error',
            latency_ms: latencyMs,
            success: false,
            response: message,
        }).catch(() => { });
        return {
            reply: 'משהו נשבר אצלי. נסי שוב בעוד רגע.',
            route: 'error',
            latencyMs,
        };
    }
}
//# sourceMappingURL=orchestrator.js.map