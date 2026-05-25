import 'dotenv/config';
export declare const config: {
    ADEL_STORAGE_BACKEND: "sqlite" | "supabase";
    SQLITE_DB_PATH: string;
    OPENROUTER_API_KEY: string;
    OPENROUTER_MODEL: string;
    TELEGRAM_BOT_TOKEN: string;
    CALENDAR_BACKEND: "stub" | "google";
    SUPABASE_URL?: string | undefined;
    SUPABASE_SERVICE_ROLE_KEY?: string | undefined;
    ADEL_ADMIN_TELEGRAM_ID?: number | undefined;
};
