import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { initDatabase } from './database.js';
import { authRouter } from './routes/auth.js';
import { quizRouter } from './routes/quizzes.js';
import { classRouter } from './routes/classes.js';
import { gameRouter } from './routes/games.js';
import { assignmentRouter } from './routes/assignments.js';
import { registerRealtime } from './realtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });

initDatabase();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', rateLimit({ windowMs:60_000, limit:180, standardHeaders:true, legacyHeaders:false }));
app.use('/api/auth', authRouter);
app.use('/api/quizzes', quizRouter);
app.use('/api/classes', classRouter);
app.use('/api/games', gameRouter);
app.use('/api/assignments', assignmentRouter);
app.get('/api/health', (_req,res) => res.json({ ok:true, name:'Karhoot API', version:'1.1.0', realtime:true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((_req,res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

registerRealtime(io);
const port = Number(process.env.PORT || 3000);
httpServer.listen(port, () => console.log(`\n🎮 Karhoot running on http://localhost:${port}\n`));
