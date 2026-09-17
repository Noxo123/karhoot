import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../database.js';
import { requireAuth, requireRole } from '../auth.js';
export const classRouter=Router();
const code=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
classRouter.get('/',requireAuth,(req,res)=>res.json({classes:db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM class_members m WHERE m.class_id=c.id) member_count FROM classes c WHERE teacher_id=? OR EXISTS(SELECT 1 FROM class_members m WHERE m.class_id=c.id AND m.user_id=?) ORDER BY c.id DESC`).all(req.user.id,req.user.id)}));
classRouter.post('/',requireAuth,requireRole('teacher','admin'),(req,res)=>{const name=String(req.body?.name||'').trim();if(name.length<2)return res.status(400).json({error:'Nom invalide'});let c=code();while(db.prepare('SELECT 1 FROM classes WHERE code=?').get(c))c=code();const r=db.prepare('INSERT INTO classes(teacher_id,name,code) VALUES(?,?,?)').run(req.user.id,name,c);res.status(201).json({id:r.lastInsertRowid,name,code:c});});
classRouter.post('/join',requireAuth,requireRole('student'),(req,res)=>{const c=String(req.body?.code||'').trim().toUpperCase();const cls=db.prepare('SELECT id,name FROM classes WHERE code=?').get(c);if(!cls)return res.status(404).json({error:'Code de classe incorrect'});db.prepare('INSERT OR IGNORE INTO class_members(class_id,user_id) VALUES(?,?)').run(cls.id,req.user.id);res.json({class:cls});});
