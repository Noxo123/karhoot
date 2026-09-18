import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../database.js';
import { requireAuth, requireRole } from '../auth.js';

export const gameRouter = Router();
const makeRoom = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const getGame = (code) => db.prepare(`SELECT g.*, q.title, q.description FROM live_games g JOIN quizzes q ON q.id=g.quiz_id WHERE g.room_code=?`).get(String(code || '').trim().toUpperCase());

function avatarForPlayer(userId, fallbackAvatar, username) {
  const row = db.prepare('SELECT avatar_config FROM users WHERE id=?').get(userId);
  let config;
  try {
    const raw = JSON.parse(row?.avatar_config || '{}');
    config = {
      character: String(raw.character || 'toon-head'),
      outfit: String(raw.outfit || ''),
      background: String(raw.background || ''),
      seed: String(raw.seed || username || 'karhoot').slice(0, 80),
      options: raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options) ? raw.options : {},
      cosmetics: Array.isArray(raw.cosmetics) ? raw.cosmetics.filter(x => typeof x === 'string').slice(0, 30) : []
    };
  } catch {
    config = { character: 'toon-head', outfit: '', background: '', seed: username || 'karhoot', options: {}, cosmetics: [] };
  }
  const cosmetics = config.cosmetics
    .map(slug => db.prepare(`SELECT slug,name,anchor,pos_x,pos_y,scale,rotation FROM avatar_items WHERE slug=? AND active=1 AND category='style' AND svg_content<>''`).get(slug))
    .filter(Boolean)
    .map(item => ({ slug:item.slug, name:item.name, anchor:item.anchor||'center', posX:Number(item.pos_x??50), posY:Number(item.pos_y??50), scale:Number(item.scale??100), rotation:Number(item.rotation??0) }));
  return { ...config, cosmetics };
}

const publicPlayers = (gameId) => db.prepare(`SELECT p.user_id,u.username,u.avatar,p.score,p.connected FROM live_players p JOIN users u ON u.id=p.user_id JOIN live_games g ON g.id=p.game_id WHERE p.game_id=? AND p.user_id<>g.host_id ORDER BY p.score DESC,u.username ASC`).all(gameId).map(player => ({
  ...player,
  avatarConfig: avatarForPlayer(player.user_id, player.avatar, player.username)
}));

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
  const isHost = game.host_id === req.user.id;
  const isPlayer = !!db.prepare('SELECT 1 FROM live_players WHERE game_id=? AND user_id=?').get(game.id,req.user.id);
  if (!isHost && !isPlayer) return res.status(403).json({error:'Accès à cette partie non autorisé'});
  game.players = publicPlayers(game.id);
  game.player = isPlayer ? {
    userId:req.user.id,
    score:Number(db.prepare('SELECT score FROM live_players WHERE game_id=? AND user_id=?').get(game.id,req.user.id)?.score||0),
    connected:Boolean(db.prepare('SELECT connected FROM live_players WHERE game_id=? AND user_id=?').get(game.id,req.user.id)?.connected)
  } : null;
  if (game.current_question >= 0 && game.status === 'question') {
    game.question = questionPayload(game.quiz_id, game.current_question);
    if (isPlayer && game.question) {
      const answered=db.prepare('SELECT answer_id,is_correct,points,answered_at FROM live_answers WHERE game_id=? AND user_id=? AND question_id=?').get(game.id,req.user.id,game.question.id);
      if (answered) game.player.answer={answerId:answered.answer_id,correct:Boolean(answered.is_correct),points:Number(answered.points),answeredAt:answered.answered_at};
    }
  }
  res.json({ game });
});

gameRouter.post('/:code/start', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.host_id !== req.user.id) return res.status(404).json({ error:'Partie introuvable' });
  if (game.status !== 'lobby') return res.status(409).json({ error:'La partie est déjà lancée' });
  const first = questionPayload(game.quiz_id, 0);
  if (!first) return res.status(409).json({ error:'Ce quiz ne contient aucune question' });
  const startedAt=new Date().toISOString();
  db.prepare("UPDATE live_games SET status='question', current_question=0, question_started_at=? WHERE id=?").run(startedAt,game.id);
  first.startedAt=startedAt;
  res.json({ question:first, players:publicPlayers(game.id) });
});

gameRouter.post('/:code/next', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.host_id !== req.user.id) return res.status(404).json({ error:'Partie introuvable' });
  const next = game.current_question + 1;
  const question = questionPayload(game.quiz_id, next);
  if (!question) {
    db.prepare("UPDATE live_games SET status='finished', question_started_at=NULL WHERE id=?").run(game.id);
    return res.json({ finished:true, players:publicPlayers(game.id) });
  }
  const startedAt=new Date().toISOString();
  db.prepare("UPDATE live_games SET status='question', current_question=?, question_started_at=? WHERE id=?").run(next,startedAt,game.id);
  question.startedAt=startedAt;
  res.json({ finished:false, question, players:publicPlayers(game.id) });
});

gameRouter.post('/:code/end', requireAuth, requireRole('teacher','admin'), (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.host_id !== req.user.id) return res.status(404).json({ error:'Partie introuvable' });
  db.prepare("UPDATE live_games SET status='finished', question_started_at=NULL WHERE id=?").run(game.id);
  res.json({ finished:true, players:publicPlayers(game.id) });
});

gameRouter.post('/:code/join', requireAuth, (req,res) => {
  const game = getGame(req.params.code);
  if (!game) return res.status(404).json({ error:'Partie introuvable' });
  if (!['lobby','question'].includes(game.status)) return res.status(409).json({ error:'Cette partie est terminée' });
  if (game.host_id === req.user.id) return res.json({ gameId:game.id, roomCode:game.room_code, players:publicPlayers(game.id), host:true, status:game.status });
  db.prepare(`INSERT INTO live_players(game_id,user_id,connected) VALUES(?,?,1) ON CONFLICT(game_id,user_id) DO UPDATE SET connected=1`).run(game.id, req.user.id);
  const response={ gameId:game.id, roomCode:game.room_code, players:publicPlayers(game.id), status:game.status };
  if(game.status==='question'){
    const q=questionPayload(game.quiz_id,game.current_question);
    response.question=q;
    const row=db.prepare('SELECT score FROM live_players WHERE game_id=? AND user_id=?').get(game.id,req.user.id);
    response.score=Number(row?.score||0);
    const a=q&&db.prepare('SELECT answer_id,is_correct,points,answered_at FROM live_answers WHERE game_id=? AND user_id=? AND question_id=?').get(game.id,req.user.id,q.id);
    if(a)response.answer={answerId:a.answer_id,correct:Boolean(a.is_correct),points:Number(a.points),answeredAt:a.answered_at};
  }
  return res.json(response);
});

gameRouter.post('/:code/answer', requireAuth, (req,res) => {
  const game = getGame(req.params.code);
  if (!game || game.status !== 'question') return res.status(409).json({ error:'Aucune question active' });
  if (game.host_id === req.user.id) return res.status(403).json({ error:'Le professeur ne peut pas répondre comme joueur' });
  const player = db.prepare('SELECT 1 FROM live_players WHERE game_id=? AND user_id=?').get(game.id, req.user.id);
  if (!player) return res.status(403).json({ error:'Vous ne participez pas à cette partie' });
  const q = questionPayload(game.quiz_id, game.current_question);
  const answer = db.prepare('SELECT id,is_correct FROM answers WHERE id=? AND question_id=?').get(req.body?.answerId, q?.id);
  if (!q || !answer) return res.status(400).json({ error:'Réponse invalide' });
  const correct = Boolean(answer.is_correct);
  const existing=db.prepare('SELECT points,is_correct FROM live_answers WHERE game_id=? AND user_id=? AND question_id=?').get(game.id,req.user.id,q.id);
  if(existing) return res.status(409).json({error:'Réponse déjà enregistrée pour cette question',correct:Boolean(existing.is_correct),points:existing.points,players:publicPlayers(game.id)});
  const points=correct?q.points:0;
  db.transaction(()=>{
    db.prepare('INSERT INTO live_answers(game_id,user_id,question_id,answer_id,is_correct,points) VALUES(?,?,?,?,?,?)').run(game.id,req.user.id,q.id,answer.id,correct?1:0,points);
    db.prepare('UPDATE live_players SET score=score+? WHERE game_id=? AND user_id=?').run(points,game.id,req.user.id);
  })();
  res.json({correct,points,players:publicPlayers(game.id)});
});
