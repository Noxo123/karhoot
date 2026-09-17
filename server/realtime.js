import { db } from './database.js';
export function registerRealtime(io){
  io.on('connection',socket=>{
    socket.on('join-room',({roomCode,userId})=>{
      const game=db.prepare('SELECT id,status FROM live_games WHERE room_code=?').get(String(roomCode||'').toUpperCase());
      if(!game)return socket.emit('room-error','Partie introuvable');
      if(game.status!=='lobby')return socket.emit('room-error','Cette partie a déjà commencé');
      db.prepare('INSERT INTO live_players(game_id,user_id) VALUES(?,?) ON CONFLICT(game_id,user_id) DO UPDATE SET connected=1').run(game.id,userId);
      socket.join(`game:${game.id}`); io.to(`game:${game.id}`).emit('lobby-update',db.prepare('SELECT p.user_id,u.username,u.avatar,p.score FROM live_players p JOIN users u ON u.id=p.user_id WHERE p.game_id=? ORDER BY p.score DESC').all(game.id));
      socket.data.gameId=game.id; socket.data.userId=userId;
    });
    socket.on('disconnect',()=>{if(socket.data.gameId&&socket.data.userId)db.prepare('UPDATE live_players SET connected=0 WHERE game_id=? AND user_id=?').run(socket.data.gameId,socket.data.userId);});
  });
}
