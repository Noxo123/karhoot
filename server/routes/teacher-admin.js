import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { requireAuth, requireRole } from '../auth.js';

export const teacherAdminRouter = Router();
teacherAdminRouter.use(requireAuth, requireRole('teacher', 'admin'));

function canManageClass(req, classId) {
  if (req.user.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM classes WHERE id=? AND teacher_id=?').get(classId, req.user.id);
}

teacherAdminRouter.get('/overview', (req, res) => {
  const classes = req.user.role === 'admin'
    ? db.prepare(`SELECT c.id,c.name,c.code,c.teacher_id,u.username teacher_name,COUNT(cm.user_id) member_count FROM classes c JOIN users u ON u.id=c.teacher_id LEFT JOIN class_members cm ON cm.class_id=c.id GROUP BY c.id ORDER BY c.name`).all()
    : db.prepare(`SELECT c.id,c.name,c.code,c.teacher_id,u.username teacher_name,COUNT(cm.user_id) member_count FROM classes c JOIN users u ON u.id=c.teacher_id LEFT JOIN class_members cm ON cm.class_id=c.id WHERE c.teacher_id=? GROUP BY c.id ORDER BY c.name`).all(req.user.id);
  const students = db.prepare(`SELECT u.id,u.username,u.email,u.role,u.xp,u.level,u.coins,COUNT(DISTINCT cm.class_id) class_count FROM users u LEFT JOIN class_members cm ON cm.user_id=u.id WHERE u.role='student' GROUP BY u.id ORDER BY u.username COLLATE NOCASE`).all();
  res.json({ classes, students });
});

teacherAdminRouter.get('/classes/:classId/students', (req,res) => {
  const classId=Number(req.params.classId);
  if(!canManageClass(req,classId)) return res.status(403).json({error:'Classe inaccessible'});
  const students=db.prepare(`SELECT u.id,u.username,u.email,u.xp,u.level,u.coins,cm.joined_at FROM class_members cm JOIN users u ON u.id=cm.user_id WHERE cm.class_id=? AND u.role='student' ORDER BY u.username COLLATE NOCASE`).all(classId);
  res.json({students});
});

teacherAdminRouter.post('/students/move', (req,res) => {
  const parsed=z.object({userId:z.coerce.number().int().positive(),fromClassId:z.coerce.number().int().positive().nullable().optional(),toClassId:z.coerce.number().int().positive().nullable().optional()}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Données invalides'});
  const {userId,fromClassId,toClassId}=parsed.data;
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND role='student'").get(userId)) return res.status(404).json({error:'Élève introuvable'});
  if(fromClassId && !canManageClass(req,fromClassId)) return res.status(403).json({error:'Classe source inaccessible'});
  if(toClassId && !canManageClass(req,toClassId)) return res.status(403).json({error:'Classe destination inaccessible'});
  db.transaction(()=>{
    db.prepare('DELETE FROM class_members WHERE user_id=?').run(userId);
    if(toClassId) db.prepare('INSERT OR IGNORE INTO class_members(class_id,user_id) VALUES(?,?)').run(toClassId,userId);
  })();
  res.json({ok:true,userId,classId:toClassId||null});
});

teacherAdminRouter.post('/classes', (req,res) => {
  const parsed=z.object({name:z.string().trim().min(2).max(80)}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Nom de classe invalide'});
  let code;
  do { code=Math.random().toString(36).slice(2,8).toUpperCase(); } while(db.prepare('SELECT 1 FROM classes WHERE code=?').get(code));
  const teacherId=req.user.role==='admin' && Number.isInteger(Number(req.body.teacherId)) ? Number(req.body.teacherId) : req.user.id;
  if(!db.prepare("SELECT id FROM users WHERE id=? AND role IN ('teacher','admin')").get(teacherId)) return res.status(400).json({error:'Professeur invalide'});
  const result=db.prepare('INSERT INTO classes(teacher_id,name,code) VALUES(?,?,?)').run(teacherId,parsed.data.name,code);
  res.status(201).json({id:result.lastInsertRowid,name:parsed.data.name,code});
});

const catalogPatch=z.object({name:z.string().trim().min(2).max(80).optional(),category:z.enum(['character','outfit','style','background']).optional(),style:z.string().trim().min(1).max(64).optional(),price:z.coerce.number().int().min(0).max(100000).optional(),description:z.string().max(240).optional(),icon:z.string().max(8).optional(),active:z.coerce.boolean().optional()});

teacherAdminRouter.post('/catalog/items', (req,res) => {
  const parsed=z.object({slug:z.string().trim().regex(/^[a-z0-9-]+$/).max(64),name:z.string().trim().min(2).max(80),category:z.enum(['character','outfit','style','background']).default('style'),style:z.string().trim().min(1).max(64).default('toon-head'),price:z.coerce.number().int().min(0).max(100000),description:z.string().max(240).default(''),icon:z.string().max(8).default('✨'),svgContent:z.string().max(200000).default('')}).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Élément invalide',details:parsed.error.flatten()});
  if(!parsed.data.svgContent && req.user.role!=='admin') return res.status(403).json({error:'Un SVG personnalisé doit être validé par un administrateur'});
  let svg=parsed.data.svgContent;
  if(svg){svg=svg.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/on[a-z]+\s*=\s*(["']).*?\1/gi,'').replace(/javascript:/gi,'').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi,'');if(!/<svg[\s>]/i.test(svg))return res.status(400).json({error:'Le contenu doit être un SVG valide'});}
  try{const result=db.prepare('INSERT INTO avatar_items(slug,name,category,style,price,description,icon,svg_content,creator_id) VALUES(?,?,?,?,?,?,?,?,?)').run(parsed.data.slug,parsed.data.name,parsed.data.category,parsed.data.style,parsed.data.price,parsed.data.description,parsed.data.icon,svg,req.user.id);res.status(201).json({ok:true,id:result.lastInsertRowid,slug:parsed.data.slug});}
  catch(error){if(String(error.message).includes('UNIQUE'))return res.status(409).json({error:'Ce slug existe déjà'});console.error(error);res.status(500).json({error:'Création impossible'});}
});

teacherAdminRouter.patch('/catalog/items/:id',(req,res)=>{
  const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Élément invalide'});
  const parsed=catalogPatch.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Données invalides',details:parsed.error.flatten()});
  const current=db.prepare('SELECT * FROM avatar_items WHERE id=?').get(id);if(!current)return res.status(404).json({error:'Élément introuvable'});
  const n={name:parsed.data.name??current.name,category:parsed.data.category??current.category,style:parsed.data.style??current.style,price:parsed.data.price??current.price,description:parsed.data.description??current.description,icon:parsed.data.icon??current.icon,active:parsed.data.active===undefined?current.active:(parsed.data.active?1:0)};
  db.prepare('UPDATE avatar_items SET name=?,category=?,style=?,price=?,description=?,icon=?,active=? WHERE id=?').run(n.name,n.category,n.style,n.price,n.description,n.icon,n.active,id);
  res.json({ok:true,item:db.prepare("SELECT id,slug,name,category,style,price,description,icon,active,creator_id,CASE WHEN svg_content<>'' THEN 1 ELSE 0 END has_svg FROM avatar_items WHERE id=?").get(id)});
});

teacherAdminRouter.get('/catalog', (_req,res) => {
  res.json({items:db.prepare("SELECT id,slug,name,category,style,price,description,icon,active,creator_id,CASE WHEN svg_content<>'' THEN 1 ELSE 0 END has_svg FROM avatar_items ORDER BY category,price,id").all()});
});
