import { db } from './database.js';

function lobbyPlayers(gameId){return db.prepare('SELECT p.user_id,u.username,u.avatar,p.score,p.connected FROM live_players p JOIN users u ON u.id=p.user_id WHERE p.game_id=? ORDER BY p.score DESC,u.username ASC').all(gameId)}
function currentQuestion(game){const q=db.prepare('SELECT id,question,points,order_index FROM questions WHERE quiz_id=? ORDER BY order_index LIMIT 1 OFFSET ?').get(game.quiz_id,game.current_question);if(!q)return null;q.answers=db.prepare('SELECT id,answer,order_index FROM answers WHERE question_id=? ORDER BY order_index').all(q.id);return q}

export function registerRealtime(io){
  io.on('connection',socket=>{
    socket.on('join-room',({roomCode,userId})=>{
      const game=db.prepare('SELECT id,quiz_id,status,current_question FROM live_games WHERE room_code=?').get(String(roomCode||'').toUpperCase());
      if(!game)return socket.emit('room-error','Partie introuvable');
      if(!['lobby','question'].includes(game.status))return socket.emit('room-error','Cette partie est terminée');
      db.prepare('INSERT INTO live_players(game_id,user_id) VALUES(?,?) ON CONFLICT(game_id,user_id) DO UPDATE SET connected=1').run(game.id,userId);
      socket.join(`game:${game.id}`);socket.data.gameId=game.id;socket.data.userId=userId;
      io.to(`game:${game.id}`).emit('lobby-update',lobbyPlayers(game.id));
      if(game.status==='question'){const question=currentQuestion(game);if(question)socket.emit('game-question',question)}
    });
    socket.on('game-state',({roomCode,question,finished})=>{const game=db.prepare('SELECT id FROM live_games WHERE room_code=?').get(String(roomCode||'').toUpperCase());if(!game)return;if(finished)io.to(`game:${game.id}`).emit('game-finished');else if(question)io.to(`game:${game.id}`).emit('game-question',question)});
    socket.on('disconnect',()=>{if(socket.data.gameId&&socket.data.userId){db.prepare('UPDATE live_players SET connected=0 WHERE game_id=? AND user_id=?').run(socket.data.gameId,socket.data.userId);io.to(`game:${socket.data.gameId}`).emit('lobby-update',lobbyPlayers(socket.data.gameId))}});
  });
}
