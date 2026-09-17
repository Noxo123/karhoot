import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET || 'karhoot-dev-secret-change-me';
export async function hashPassword(password) { return bcrypt.hash(password, 12); }
export async function verifyPassword(password, hash) { return bcrypt.compare(password, hash); }
export function signUser(user) { return jwt.sign({ id: user.id, role: user.role, username: user.username }, secret, { expiresIn: '7d' }); }
export function verifyToken(token) { return jwt.verify(token, secret); }
export function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Authentification requise' });
    const payload = verifyToken(token);
    const id = payload.id ?? payload.userId;
    if (!id) return res.status(401).json({ error: 'Session invalide: identifiant utilisateur manquant' });
    req.user = { ...payload, id };
    next();
  } catch { res.status(401).json({ error: 'Session invalide ou expirée' }); }
}
export function requireRole(...roles) { return (req,res,next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Permission insuffisante' }); }