import { startTelegram } from './channels/telegram.js';
import './scripts/index.js';
const bot = startTelegram();
const shutdown = (signal) => {
    console.log(`received ${signal}, shutting down`);
    bot.stop(signal);
    process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
//# sourceMappingURL=index.js.map