import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { hashPassword, verifyPassword, signUser, requireAuth } from '../auth.js';

export const authRouter = Router();
const registerSchema = z.object({ email:z.string().email(), username:z.string().min(3).max(24).regex(/^[a-zA-Z0-9_ -]+$/), password:z.string().min(6).max(100), role:z.enum(['student','teacher']).default('student') });

authRouter.post('/register', async (req,res) => {
  const parsed = registerSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error:'Données invalides' });
  const { email, username, password, role } = parsed.data;
  try {
    const hash = await hashPassword(password);
    const result = db.prepare('INSERT INTO users(email,password_hash,username,role) VALUES (?,?,?,?)').run(email.toLowerCase(),hash,username,role);
    const user = db.prepare('SELECT id,email,username,role,avatar,xp,level FROM users WHERE id=?').get(result.lastInsertRowid);
    res.status(201).json({ user, token: signUser(user) });
  } catch (e) { res.status(409).json({ error: e.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Email ou pseudo déjà utilisé' : 'Inscription impossible' }); }
});

authRouter.post('/login', async (req,res) => {
  const { email, password } = req.body || {}; const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase());
  if (!user || !(await verifyPassword(String(password || ''), user.password_hash))) return res.status(401).json({ error:'Email ou mot de passe incorrect' });
  delete user.password_hash; res.json({ user, token: signUser(user) });
});

authRouter.get('/me', requireAuth, (req,res) => {
  const user = db.prepare('SELECT id,email,username,role,avatar,xp,level FROM users WHERE id=?').get(req.user.id);
  user ? res.json({ user }) : res.status(404).json({ error:'Utilisateur introuvable' });
});
