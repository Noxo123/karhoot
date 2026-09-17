import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../database.js';
import { requireAuth, requireRole } from '../auth.js';
export const gameRouter=Router();
const room=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
gameRouter.post('/',requireAuth,requireRole('teacher','admin'),(req,res)=>{const quiz=db.prepare('SELECT id,title FROM quizzes WHERE id=? AND author_id=?').get(req.body?.quizId,req.user.id);if(!quiz)return res.status(404).json({error:'Quiz introuvable'});let code=room();while(db.prepare('SELECT 1 FROM live_games WHERE room_code=?').get(code))code=room();const r=db.prepare('INSERT INTO live_games(quiz_id,host_id,room_code) VALUES(?,?,?)').run(quiz.id,req.user.id,code);res.status(201).json({gameId:r.lastInsertRowid,roomCode:code,quiz});});
gameRouter.get('/:code',requireAuth,(req,res)=>{const game=db.prepare('SELECT g.id,g.room_code,g.status,g.current_question,q.title FROM live_games g JOIN quizzes q ON q.id=g.quiz_id WHERE g.room_code=?').get(req.params.code.toUpperCase());if(!game)return res.status(404).json({error:'Partie introuvable'});game.players=db.prepare('SELECT p.user_id,u.username,u.avatar,p.score,p.connected FROM live_players p JOIN users u ON u.id=p.user_id WHERE p.game_id=? ORDER BY p.score DESC').all(game.id);res.json({game});});
