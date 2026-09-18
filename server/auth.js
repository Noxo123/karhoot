import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const isProduction = process.env.NODE_ENV === 'production';
const secret = process.env.JWT_SECRET || (isProduction ? null : crypto.randomBytes(48).toString('hex'));
if (isProduction && (!secret || secret.length < 32)) throw new Error('JWT_SECRET doit contenir au moins 32 caractères en production.');
export async function hashPassword(password) { return bcrypt.hash(password, 12); }
export async function verifyPassword(password, hash) { return bcrypt.compare(password, hash); }
export function signUser(user) { return jwt.sign({ id:user.id, role:user.role, username:user.username }, secret, { expiresIn:'7d', issuer:'karhoot', audience:'karhoot-web' }); }
export function verifyToken(token) { return jwt.verify(token, secret, { issuer:'karhoot', audience:'karhoot-web' }); }
export function requireAuth(req,res,next) {
  try {
    const header=String(req.headers.authorization||'');
    if(!/^Bearer\s+\S+$/i.test(header)) return res.status(401).json({error:'Authentification requise'});
    const payload=verifyToken(header.replace(/^Bearer\s+/i,'').trim());
    const id=Number(payload.id ?? payload.userId);
    if(!Number.isInteger(id)||id<1) return res.status(401).json({error:'Session invalide'});
    req.user={...payload,id};
    next();
  } catch { res.status(401).json({error:'Session invalide ou expirée'}); }
}
export function requireRole(...roles) { return (req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({error:'Permission insuffisante'}); }