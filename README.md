# Adel Assistant — Invisible Admin

עוזרת וירטואלית לבעלי עסקים קטנים (1–5 עובדים). יושבת על טלגרם (WhatsApp בהמשך), עונה ללקוחות אוטומטית כשהיא יודעת, ומבקשת אישור מהבעלים כשהיא לא. Human-in-the-Loop בליבה.

נקראת על שם סבתא עדל.

## הרעיון בקצרה

עוזרי AI היום שולחים כל הודעה ל-LLM. זה איטי, יקר, ומסוכן (הזיות, התחייבויות שגויות). Adel מחלקת הודעות לפי **תפקיד הפונה**:

```
┌──────────────────┬─────────────────────────────────────────────────────┐
│ Owner / Employee │ Scripts-first → LLM fallback (זיכרון, לו"ז, ניהול) │
│                  │                                                     │
│ Client           │ RAG מהמסמכים →   יש grounding? → תשובה ישירה        │
│                  │                  אין grounding?  → טיוטה ל-Owner    │
│                  │                                    עם כפתור "אשר"   │
└──────────────────┴─────────────────────────────────────────────────────┘
```

הבעלים אף פעם לא חותם על תשובה שהוא לא ראה. הלקוחות מקבלים תשובות מיידיות לשאלות נפוצות, וחוויה אנושית לשאלות מורכבות.

## מה רץ היום

- **Telegram bot רב-משתמשי** — owner / client / employee מובחנים לפי `telegram_id`
- **Role-based routing** — לכל תפקיד זרימת תגובה משלו
- **Document Q&A (RAG)** — owner מעלה קבצי טקסט, נחתכים ל-chunks, מועברים ל-embeddings (`text-embedding-3-small` דרך OpenRouter), ונשמרים ב-SQLite כברירת מחדל (embedding כ-JSON + cosine similarity ב-JS). בפריסת Supabase אותו API עובד מול pgvector. שאלת לקוח → similarity search → תשובה מבוססת מקורות + ציטוט שם הקובץ.
- **Draft & Approve (HitL)** — שאלה ללא grounding מייצרת `adel_drafts` row + ping ל-owner עם 2 כפתורי inline (`✅ אשר ושלח` / `❌ דחה`). עד שהbעלים מאשר, הלקוח מקבל הודעת המתנה ("אני בודקת מול הצוות ואחזור").
- **Personal memory ל-owner** — "תזכרי ש..." / "איפה ה...?" דרך CausaDB W-types
- **Calendar** — backend "stub" עם 3 אירועי דמו + פונקציית `findFreeSlots`. ה-Interface מוכן ל-Google Calendar adapter (לא מומש עדיין; להחלפה זה shim של ~50 שורות).
- **Execution log** — כל הודעה נרשמת עם `route` (script / rag_grounded / draft_for_owner / llm_owner / error), latency, success
- **Teacher Guard** — fallbacks נכתבים ל-`adel_pending_scripts` כדי לזהות דפוסים חוזרים שכדאי להפוך לסקריפט

## פקודות בטלגרם

| פקודה | מי | מה |
|---|---|---|
| `/start` | כולם | רישום ראשוני + הודעת welcome |
| `/upload` | owner | מעלה מסמך (`.txt`, או הדבק טקסט עם `!doc <name>` בשורה הראשונה) |
| `/calendar` | owner | מציג את הלו"ז ל-7 ימים הקרובים |
| `/claim <user_id> client\|employee` | owner | מקשר משתמש קיים לעסק כלקוח/עובד |

הודעת טקסט חופשי → orchestrator → תשובה לפי תפקיד.

## Stack

- Node.js 20+, TypeScript ESM, strict mode (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- LLM: OpenRouter SDK (`@openrouter/sdk`) — chat + embeddings מאותה ספרייה
- Channel: Telegraf
- DB: **SQLite by default** for local MVP/demo (`better-sqlite3`); Supabase (Postgres + pgvector) remains available via storage adapter for hosted deployment
- Validation: Zod

## הקמה

### 1. Dependencies

```bash
npm install
```

### 2. סודות

```bash
# macOS/Linux/Git Bash
cp .env.example .env

# Windows cmd
copy .env.example .env
```

לדמו המוכן למחר אפשר להשתמש גם בתבנית:

```bash
copy .env.demo .env
```

מלא את `.env`:

| משתנה | איפה משיגים |
|---|---|
| `OPENROUTER_API_KEY` | https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | אופציונלי. ברירת מחדל לדמו: `google/gemini-3.1-flash-lite` |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `ADEL_STORAGE_BACKEND` | `sqlite` כברירת מחדל. `supabase` בהמשך לפריסה מנוהלת |
| `SQLITE_DB_PATH` | נתיב לקובץ DB מקומי, למשל `./data/adel.db` |
| `SUPABASE_URL` | נדרש רק אם `ADEL_STORAGE_BACKEND=supabase` |
| `SUPABASE_SERVICE_ROLE_KEY` | נדרש רק אם `ADEL_STORAGE_BACKEND=supabase`; להשתמש ב-`service_role` (לא `anon`) |
| `ADEL_ADMIN_TELEGRAM_ID` | ה-Telegram ID המספרי שלך. ה-user הזה מקבל אוטומטית role=`owner` ו-business משלו בפנייה ראשונה |
| `CALENDAR_BACKEND` | `stub` (default) או `google` (לא מומש עדיין) |

### 3. סכמת DB

#### ברירת מחדל: SQLite

אין צורך להריץ מיגרציות ידנית. בהפעלה הראשונה Adel תיצור אוטומטית את קובץ ה-DB והטבלאות לפי:

```env
ADEL_STORAGE_BACKEND=sqlite
SQLITE_DB_PATH=./data/adel.db
```

#### אופציונלי בהמשך: Supabase

אם רוצים לעבוד מול Supabase במקום SQLite:

```env
ADEL_STORAGE_BACKEND=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

ואז מריצים את שתי המיגרציות בסדר:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_invisible_admin.sql
```

ב-Supabase cloud, יש להפעיל extension `vector` ב-Database → Extensions לפני מיגרציה 2.

### 4. הרצה

```bash
npm run dev      # tsx watch
npm start        # ריצה בודדת
npm run build    # tsc → dist/
```

בפנייה הראשונה שלך לבוט (תחת ה-`ADEL_ADMIN_TELEGRAM_ID`) ייווצרו אוטומטית: רשומת user עם role=`owner`, רשומת business, ו-business_id מקושר. כל מי שיפנה אחר כך נכנס כ-`client` עד שתעשה לו `/claim`.

## ארכיטקטורה

```
src/
├── index.ts                       # entry: מפעיל טלגרם, רושם handlers
├── config.ts                      # zod schema על process.env
├── channels/
│   └── telegram.ts                # Telegraf adapter:
│                                  #   - /start /calendar /upload /claim
│                                  #   - inline approve/reject buttons
│                                  #   - free-text → orchestrator
├── nanoclaw/
│   └── orchestrator.ts            # role-aware routing:
│                                  #   owner/employee  → script | llm
│                                  #   client          → rag | draft
├── intent/
│   ├── classifier.ts              # LLM → JSON Intent (לcripts)
│   └── types.ts
├── scripts/                       # Scripts Bank
│   ├── bank.ts
│   └── handlers/
│       ├── remember.ts            # memory.remember (owner)
│       └── recall.ts              # memory.recall (owner)
├── documents/
│   ├── ingest.ts                  # chunkText + embed + store
│   └── rag.ts                     # answerFromDocs (similarity floor 0.55)
├── calendar/
│   └── calendar.ts                # CalendarAdapter interface + StubCalendar
├── llm/
│   └── openrouter.ts              # complete() + embed() + error mapping
├── storage/
│   ├── users.ts                   # facade: selects sqlite/supabase backend
│   ├── drafts.ts                  # facade: create/approve/reject draft
│   ├── documents.ts               # facade: createDocument, insertChunks, searchChunks
│   ├── causa.ts                   # facade: remember/recall + logExecution
│   ├── sqlite/                    # local MVP backend (better-sqlite3)
│   │   ├── db.ts                  # auto-creates schema + ./data/adel.db
│   │   ├── users.ts
│   │   ├── drafts.ts
│   │   ├── documents.ts           # embedding JSON + cosine similarity in JS
│   │   ├── causa.ts
│   │   └── teacher-guard.ts
│   └── supabase/                  # hosted backend adapter (service role)
│       ├── client.ts
│       ├── users.ts
│       ├── drafts.ts
│       ├── documents.ts           # pgvector RPC
│       ├── causa.ts
│       └── teacher-guard.ts
└── teacher/
    └── teacher-guard.ts           # logFallback → adel_pending_scripts
```

### זרימת בקשה — לקוח

```
[Client message] → telegram.ts → loadUser() → role='client'
                ↓
            orchestrator.route()
                ↓
            embed(query) → searchChunks() (SQLite cosine / Supabase pgvector)
                ↓
            similarity ≥ 0.55?
            ├─ YES → complete() עם sources → reply ישיר → log: rag_grounded
            └─ NO  → complete() draft (לא נשלח) → createDraft()
                     ↓
                     reply ללקוח: "אני בודקת מול הצוות..."
                     ↓
                     telegram.ts → pingOwnerForApproval() עם inline buttons
                                  ↓
                              [Owner clicks ✅] → markApproved() → markSent()
                                                → bot.telegram.sendMessage(client, draft)
```

### זרימת בקשה — בעלים

זהה ל-POC המקורי: classify → Scripts Bank → אם יש handler מתאים, run; אחרת, LLM fallback. כולל הזרמת fallbacks ל-Teacher Guard.

## Document Q&A — איך זה עובד מתחת למכסה

1. Owner שולח קובץ `.txt` או מדביק טקסט בהודעה (`!doc <filename>\n<content>`).
2. `chunkText()` חותך לפסקאות, מאחד ל-windows של ~1000 תווים עם 200 חפיפה.
3. כל chunk עובר embedding דרך `openai/text-embedding-3-small` (דרך OpenRouter, 1536 דימנשנים).
4. נשמר ב-`adel_document_chunks` עם `business_id` (סקיפינג לפי עסק).
5. בשאילתת לקוח: `embed(query)` → `searchChunks()` → cosine similarity → top 5 → סף 0.55. ב-SQLite החישוב נעשה ב-JS; ב-Supabase זה עובר דרך RPC `adel_match_chunks` עם pgvector.
6. אם יש hits — system prompt עם המקורות, ה-LLM מצוטה לא להמציא.
7. אם אין — מסלול draft.

הסף 0.55 נבחר אמפירית לעברית עם המודל הזה. שווה לכייל אחרי 50 שאלות אמיתיות.

## הוספת סקריפט (לזרימת owner)

```typescript
// src/scripts/handlers/calendar-today.ts
import { bank, type Script } from '../bank.js';
import { getCalendar, formatEvent } from '../../calendar/calendar.js';

const script: Script = {
  name: 'calendar.today',
  category: 'api',
  matches: (intent) => intent.domain === 'calendar' && intent.action === 'query',
  run: async (intent, ctx) => {
    const cal = getCalendar();
    const events = await cal.listUpcoming({ fromDate: new Date(), days: 1 });
    if (events.length === 0) return 'היום הלו"ז שלך פנוי.';
    return events.map((e) => '• ' + formatEvent(e, ctx.user.timezone)).join('\n');
  },
};

bank.register(script);
```

ואז `import './handlers/calendar-today.js';` ב-`src/scripts/index.ts`.

## מה עוד לא

- **WhatsApp adapter** — הליבה (orchestrator, RAG, drafts) channel-agnostic. ה-WhatsApp יהיה adapter שמיישם את אותה event API. אפשרויות: WhatsApp Business API רשמי (דורש אישור Meta + מספר ייעודי), Baileys, whatsapp-web.js. החלטה תילקח לפי דרישות עמידות.
- **PDF ingestion** — היום רק `.txt`. הוספה: `pdf-parse` ב-`documents/ingest.ts` תאפשר לקבל doc.mime_type === 'application/pdf'.
- **Calendar write** — הinterface תומך ב-read בלבד. הוספת `bookSlot()` תאפשר לדמו fully autonomous booking דרך כפתור.
- **Google Calendar adapter אמיתי** — היום רק stub. דרוש OAuth setup + refresh token persistence.
- **Voice** — אין. הוספה: Whisper STT על voice messages של Telegram.
- **Teacher Guard auto-generation** — מתעד fallbacks; לא מייצר handlers טיוטיים אוטומטית.
- **Test suite** — אין. דברים שצריך לפני production: unit על classifier, integration על orchestrator, e2e עם Telegraf mock, eval מסודר על RAG (precision/recall על שאלות אמיתיות).

## CausaDB — זיכרון אישי לבעלים

כל פריט זיכרון מסווג ל-**W-type** (`what/where/when/who/why/how/how_much`) + **subject**. שליפה דרך חיפוש טקסטואלי על subject + סינון אופציונלי על w_type. lookup פשוט, לא חיפוש סמנטי. שדרוג עתידי: למזג עם chunks (SQLite embedding store / Supabase pgvector).

## Roadmap

### Phase 1 — Pitch-ready (היום)
- [x] Role-based routing
- [x] Draft & Approve flow
- [x] Document Q&A (text only)
- [x] Calendar read (stub)
- [x] Personal memory (owner)
- [x] SQLite-first local demo backend
- [x] Supabase adapter kept for future hosted deployment

### Phase 2 — First paying customer
- [ ] WhatsApp adapter (החלטה: רשמי vs לא-רשמי)
- [ ] PDF ingestion
- [ ] Google Calendar adapter (read + write)
- [ ] Test suite (יעד: 70% coverage על orchestrator + storage)

### Phase 3 — Scale
- [ ] Action Layer: שיחות יוצאות, הזמנות, תורים (דורש אינטגרציות)
- [ ] Voice (Whisper STT + TTS)
- [ ] Teacher Guard auto-generation
- [ ] Multi-tenant ניהול דרך web (Supabase Auth + RLS policies)
