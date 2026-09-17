import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../database.js';
import { requireAuth, requireRole } from '../auth.js';

export const gameRouter = Router();
const makeRoom = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const getGame = (code) => db.prepare(`SELECT g.*, q.title, q.description FROM live_games g JOIN quizzes q ON q.id=g.quiz_id WHERE g.room_code=?`).get(String(code || '').trim().toUpperCase());
const publicPlayers = (gameId) => db.prepare(`SELECT p.user_id,u.username,u.avatar,p.score,p.connected FROM live_players p JOIN users u ON u.id=p.user_id WHERE p.game_id=? ORDER BY p.score DESC,u.username ASC`).all(gameId);

function questionPayload(quizId, index) {
  const q = db.prepare('SELECT id,question,points,order_index FROM questions WHERE quiz_id=? ORDER BY order_index LIMIT 1 OFFSET ?').get(quizId, index);
  if (!q) return null;
  q.answers = db.prepare('SELECT id,answer,order_index FROM answers WHERE question_id=? ORDER BY order_index').all(q.id);
  return q;
}

gameRouter.post('/', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const quiz = db.prepare('SELECT id,title FROM quizzes WHERE id=? AND author_id=?').get(req.body?.quizId, req.user.id);
  if (!quiz) return res.status(404).json({ error:'Quiz introuvable' });
  let code = makeRoom();
  while (db.prepare('SELECT 1 FROM live_games WHERE room_code=?').get(code)) code = makeRoom();
  const r = db.prepare('INSERT INTO live_games(quiz_id,host_id,room_code) VALUES(?,?,?)').run(quiz.id, req.user.id, code);
  res.status(201).json({ gameId:Number(r.lastInsertRowid), roomCode:code, quiz });
});

gameRouter.get('/:code', requireAuth, (req,res) => {
  const game = getGame(req.params.code);
  if (!game) return res.status(404).json({ error:'Partie introuvable' });
  game.players = publicPlayers(game.id);
  if (game.current_question >= 0 && game.status === 'question') game.question = questionPayload(game.quiz_id, game.current_question);
  res.json({ game });
});

gameRouter.post('/:code/start', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.host_id !== req.user.id) return res.status(404).json({ error:'Partie introuvable' });
  if (game.status !== 'lobby') return res.status(409).json({ error:'La partie est déjà lancée' });
  const first = questionPayload(game.quiz_id, 0);
  if (!first) return res.status(409).json({ error:'Ce quiz ne contient aucune question' });
  db.prepare("UPDATE live_games SET status='question', current_question=0 WHERE id=?").run(game.id);
  res.json({ question:first, players:publicPlayers(game.id) });
});

gameRouter.post('/:code/next', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.host_id !== req.user.id) return res.status(404).json({ error:'Partie introuvable' });
  const next = game.current_question + 1;
  const question = questionPayload(game.quiz_id, next);
  if (!question) {
    db.prepare("UPDATE live_games SET status='finished' WHERE id=?").run(game.id);
    return res.json({ finished:true, players:publicPlayers(game.id) });
  }
  db.prepare("UPDATE live_games SET status='question', current_question=? WHERE id=?").run(next, game.id);
  res.json({ finished:false, question, players:publicPlayers(game.id) });
});

gameRouter.post('/:code/end', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.host_id !== req.user.id) return res.status(404).json({ error:'Partie introuvable' });
  db.prepare("UPDATE live_games SET status='finished' WHERE id=?").run(game.id);
  res.json({ finished:true, players:publicPlayers(game.id) });
});

gameRouter.post('/:code/join', requireAuth, (req,res) => {
  const game = getGame(req.params.code);
  if (!game) return res.status(404).json({ error:'Partie introuvable' });
  if (game.status !== 'lobby') return res.status(409).json({ error:'Cette partie a déjà commencé' });
  db.prepare(`INSERT INTO live_players(game_id,user_id) VALUES(?,?,?) ON CONFLICT(game_id,user_id) DO UPDATE SET connected=1`).run(game.id, req.user.id);
  res.json({ gameId:game.id, roomCode:game.room_code, players:publicPlayers(game.id) });
});

gameRouter.post('/:code/answer', requireAuth, (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.status !== 'question') return res.status(409).json({ error:'Aucune question active' });
  const player = db.prepare('SELECT 1 FROM live_players WHERE game_id=? AND user_id=?').get(game.id, req.user.id);
  if (!player) return res.status(403).json({ error:'Vous ne participez pas à cette partie' });
  const q = questionPayload(game.quiz_id, game.current_question);
  const answer = db.prepare('SELECT id,is_correct FROM answers WHERE id=? AND question_id=?').get(req.body?.answerId, q?.id);
  if (!q || !answer) return res.status(400).json({ error:'Réponse invalide' });
  const correct = Boolean(answer.is_correct);
  const speed = Math.max(0, Math.min(100, Number(req.body?.speedBonus || 0)));
  const points = correct ? q.points + Math.round(q.points * speed / 100) : 0;
  db.prepare('UPDATE live_players SET score=score+? WHERE game_id=? AND user_id=?').run(points, game.id, req.user.id);
  res.json({ correct, points, players:publicPlayers(game.id) });
});
