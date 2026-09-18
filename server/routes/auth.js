import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../database.js';
import { hashPassword, verifyPassword, signUser, requireAuth } from '../auth.js';

export const authRouter=Router();
const registerSchema=z.object({
  email:z.string().trim().toLowerCase().email().max(254),
  username:z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_ -]+$/),
  password:z.string().min(8).max(100),
  role:z.enum(['student','teacher']).default('student'),
  teacherCode:z.string().trim().min(1).max(128).optional()
});
const authLimiter=rateLimit({windowMs:15*60_000,limit:25,standardHeaders:true,legacyHeaders:false,message:{error:'Trop de tentatives. Réessaie plus tard.'}});
function publicUser(id){return db.prepare('SELECT id,email,username,role,avatar,avatar_config,coins,xp,level FROM users WHERE id=?').get(id);}

authRouter.post('/register',authLimiter,async(req,res)=>{
  const parsed=registerSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Données invalides'});
  const {email,username,password,role,teacherCode}=parsed.data;
  if(role==='teacher' && (!process.env.TEACHER_INVITE_CODE || teacherCode!==process.env.TEACHER_INVITE_CODE))
    return res.status(403).json({error:'Inscription professeur non autorisée sans code d’invitation.'});
  try{
    const hash=await hashPassword(password);
    const result=db.prepare('INSERT INTO users(email,password_hash,username,role,coins) VALUES (?,?,?,?,100)').run(email,hash,username,role);
    const user=publicUser(result.lastInsertRowid);
    res.status(201).json({user,token:signUser(user)});
  }catch(e){res.status(e.code==='SQLITE_CONSTRAINT_UNIQUE'?409:500).json({error:e.code==='SQLITE_CONSTRAINT_UNIQUE'?'Email ou pseudo déjà utilisé':'Inscription impossible'});}
});
authRouter.post('/login',authLimiter,async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'');
  if(!z.string().email().safeParse(email).success||password.length>100)return res.status(401).json({error:'Email ou mot de passe incorrect'});
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!user||!(await verifyPassword(password,user.password_hash)))return res.status(401).json({error:'Email ou mot de passe incorrect'});
  res.json({user:publicUser(user.id),token:signUser(user)});
});
authRouter.get('/me',requireAuth,(req,res)=>{const user=publicUser(req.user.id);user?res.json({user}):res.status(404).json({error:'Utilisateur introuvable'});});
