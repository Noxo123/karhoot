import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { requireAuth, requireRole } from '../auth.js';

export const assignmentRouter = Router();
const schema = z.object({ quizId:z.coerce.number().int().positive(), classId:z.coerce.number().int().positive(), dueDate:z.string().datetime({offset:true}).nullable().optional(), settings:z.record(z.string(), z.any()).optional() });

assignmentRouter.get('/', requireAuth, (req,res) => {
  const rows = req.user.role === 'student'
    ? db.prepare(`SELECT a.id,a.due_date,a.settings,q.id quiz_id,q.title,c.name class_name,c.code FROM assignments a JOIN quizzes q ON q.id=a.quiz_id JOIN classes c ON c.id=a.class_id JOIN class_members cm ON cm.class_id=c.id WHERE cm.user_id=? ORDER BY a.id DESC`).all(req.user.id)
    : db.prepare(`SELECT a.id,a.due_date,a.settings,q.id quiz_id,q.title,c.name class_name,c.code FROM assignments a JOIN quizzes q ON q.id=a.quiz_id JOIN classes c ON c.id=a.class_id WHERE c.teacher_id=? ORDER BY a.id DESC`).all(req.user.id);
  res.json({ assignments:rows.map(a=>({...a,settings:JSON.parse(a.settings || '{}')})) });
});

assignmentRouter.post('/', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const parsed=schema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:'Données invalides'});
  const {quizId,classId,dueDate,settings={}}=parsed.data;
  const quiz=db.prepare('SELECT id FROM quizzes WHERE id=? AND author_id=?').get(quizId,req.user.id);
  const cls=db.prepare('SELECT id FROM classes WHERE id=? AND teacher_id=?').get(classId,req.user.id);
  if(!quiz || !cls)return res.status(404).json({error:'Quiz ou classe introuvable'});
  const r=db.prepare('INSERT INTO assignments(quiz_id,class_id,due_date,settings) VALUES(?,?,?,?)').run(quizId,classId,dueDate || null,JSON.stringify(settings));
  res.status(201).json({id:Number(r.lastInsertRowid)});
});

assignmentRouter.post('/:id/submit', requireAuth, requireRole('student'), (req,res) => {
  const assignment=db.prepare('SELECT a.*,q.id quiz_id FROM assignments a JOIN quizzes q ON q.id=a.quiz_id JOIN class_members cm ON cm.class_id=a.class_id WHERE a.id=? AND cm.user_id=?').get(req.params.id,req.user.id);
  if(!assignment)return res.status(404).json({error:'Devoir introuvable'});
  const answers=Array.isArray(req.body?.answers)?req.body.answers.slice(0,100):[];
  if(db.prepare('SELECT 1 FROM submissions WHERE assignment_id=? AND student_id=?').get(assignment.id,req.user.id))return res.status(409).json({error:'Devoir déjà envoyé'});
  const questions=db.prepare('SELECT id FROM questions WHERE quiz_id=? ORDER BY order_index').all(assignment.quiz_id);
  let score=0;
  const tx=db.transaction(()=>{
    const sub=db.prepare('INSERT INTO submissions(assignment_id,student_id) VALUES(?,?)').run(assignment.id,req.user.id);
    const insert=db.prepare('INSERT INTO submission_answers(submission_id,question_id,answer_id,is_correct,response_time_ms) VALUES(?,?,?,?,?)');
    for(const q of questions){const item=answers.find(a=>Number(a.questionId)===q.id);const aid=item?.answerId ? Number(item.answerId):null;const ok=aid ? db.prepare('SELECT is_correct FROM answers WHERE id=? AND question_id=?').get(aid,q.id)?.is_correct===1:false;if(ok)score+=db.prepare('SELECT points FROM questions WHERE id=?').get(q.id).points;insert.run(sub.lastInsertRowid,q.id,aid,ok?1:0,Math.min(86400000,Number.isFinite(Number(item?.responseTimeMs))?Math.max(0,Number(item.responseTimeMs)):0));}
    db.prepare('UPDATE submissions SET score=?,completed_at=CURRENT_TIMESTAMP WHERE id=?').run(score,sub.lastInsertRowid);
    return Number(sub.lastInsertRowid);
  });
  res.status(201).json({submissionId:tx,score,total:questions.reduce((n,q)=>n+db.prepare('SELECT points FROM questions WHERE id=?').get(q.id).points,0)});
});
