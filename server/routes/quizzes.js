import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { requireAuth, requireRole } from '../auth.js';
export const quizRouter = Router();
const schema = z.object({ title:z.string().trim().min(2).max(100), description:z.string().trim().max(500).optional(), questions:z.array(z.object({ question:z.string().trim().min(1).max(1000), points:z.coerce.number().int().min(1).max(1000).default(100), answers:z.array(z.object({ answer:z.string().trim().min(1).max(500), isCorrect:z.boolean() })).min(2).max(8) })).min(1).max(100) });
quizRouter.get('/', requireAuth, (req,res) => res.json({ quizzes: db.prepare('SELECT id,title,description,visibility,created_at FROM quizzes WHERE author_id=? ORDER BY id DESC').all(req.user.id) }));
quizRouter.get('/:id', requireAuth, (req,res) => {
  const quiz=db.prepare('SELECT id,title,description,visibility,author_id FROM quizzes WHERE id=?').get(req.params.id); if(!quiz)return res.status(404).json({error:'Quiz introuvable'});
  const owner=quiz.author_id===req.user.id;
  if(req.user.role==='student') { const allowed=db.prepare('SELECT 1 FROM assignments a JOIN class_members cm ON cm.class_id=a.class_id WHERE a.quiz_id=? AND cm.user_id=?').get(quiz.id,req.user.id); if(!allowed)return res.status(403).json({error:'Quiz non accessible'}); quiz.questions=db.prepare('SELECT id,question,points,order_index FROM questions WHERE quiz_id=? ORDER BY order_index').all(quiz.id).map(q=>({...q,answers:db.prepare('SELECT id,answer,order_index FROM answers WHERE question_id=? ORDER BY order_index').all(q.id)})); } else { if(!owner && req.user.role!=='admin')return res.status(403).json({error:'Quiz non accessible'}); quiz.questions=db.prepare('SELECT id,question,points,order_index FROM questions WHERE quiz_id=? ORDER BY order_index').all(quiz.id).map(q=>({...q,answers:db.prepare('SELECT id,answer,is_correct,order_index FROM answers WHERE question_id=? ORDER BY order_index').all(q.id)})); }
  delete quiz.author_id; res.json({quiz});
});
quizRouter.post('/', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const parsed=schema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Quiz invalide'}); const tx=db.transaction(data=>{const q=db.prepare('INSERT INTO quizzes(author_id,title,description) VALUES (?,?,?)').run(req.user.id,data.title,data.description||''); data.questions.forEach((item,i)=>{const qr=db.prepare('INSERT INTO questions(quiz_id,question,points,order_index) VALUES (?,?,?,?)').run(q.lastInsertRowid,item.question,item.points,i); item.answers.forEach((a,j)=>db.prepare('INSERT INTO answers(question_id,answer,is_correct,order_index) VALUES (?,?,?,?)').run(qr.lastInsertRowid,a.answer,a.isCorrect?1:0,j));}); return q.lastInsertRowid;}); const id=tx(parsed.data); res.status(201).json({id});
});
