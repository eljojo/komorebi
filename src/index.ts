import { Hono } from 'hono';
import { ENGINE_COMMIT } from './generated/engine';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, engine: ENGINE_COMMIT }));

export default app;
