import { db } from './database.js';
import { verifyToken } from './auth.js';

function avatarForPlayer(userId, username){
  const row=db.prepare('SELECT avatar_config FROM users WHERE id=?').get(userId);
  let raw={};
  try{raw=JSON.parse(row?.avatar_config||'{}')}catch{}
  const config={character:String(raw.character||'toon-head'),outfit:String(raw.outfit||''),background:String(raw.background||''),seed:String(raw.seed||username||'karhoot').slice(0,80),options:raw.options&&typeof raw.options==='object'&&!Array.isArray(raw.options)?raw.options:{},cosmetics:Array.isArray(raw.cosmetics)?raw.cosmetics.filter(x=>typeof x==='string').slice(0,30):[]};
  config.cosmetics=config.cosmetics.map(slug=>db.prepare(`SELECT slug,name,anchor,pos_x,pos_y,scale,rotation FROM avatar_items WHERE slug=? AND active=1 AND category='style' AND svg_content<>''`).get(slug)).filter(Boolean).map(item=>({slug:item.slug,name:item.name,anchor:item.anchor||'center',posX:Number(item.pos_x??50),posY:Number(item.pos_y??50),scale:Number(item.scale??100),rotation:Number(item.rotation??0)}));
  return config;
}

function lobbyPlayers(gameId){return db.prepare('SELECT p.user_id,u.username,u.avatar,p.score,p.connected FROM live_players p JOIN users u ON u.id=p.user_id JOIN live_games g ON g.id=p.game_id WHERE p.game_id=? AND p.user_id<>g.host_id ORDER BY p.score DESC,u.username ASC').all(gameId).map(player=>({...player,avatarConfig:avatarForPlayer(player.user_id,player.username)}))}
function currentQuestion(game){const q=db.prepare('SELECT id,question,points,order_index FROM questions WHERE quiz_id=? ORDER BY order_index LIMIT 1 OFFSET ?').get(game.quiz_id,game.current_question);if(!q)return null;q.answers=db.prepare('SELECT id,answer,order_index FROM answers WHERE question_id=? ORDER BY order_index').all(q.id);return q}

export function registerRealtime(io){
  io.use((socket,next)=>{
    try {
      const token=socket.handshake.auth?.token;
      if(!token) return next(new Error('Authentification requise'));
      socket.data.user=verifyToken(token); next();
    } catch { next(new Error('Session invalide ou expirée')); }
  });
  io.on('connection',socket=>{
    socket.on('join-room',({roomCode}={})=>{
      const user=socket.data.user;
      const code=String(roomCode||'').trim().toUpperCase();
      if(!/^[A-Z0-9]{6}$/.test(code))return socket.emit('room-error','Code de partie invalide');
      const game=db.prepare('SELECT id,quiz_id,host_id,status,current_question FROM live_games WHERE room_code=?').get(code);
      if(!game)return socket.emit('room-error','Partie introuvable');
      if(!['lobby','question'].includes(game.status))return socket.emit('room-error','Cette partie est terminée');
      if(game.host_id!==user.id){
        const player=db.prepare('SELECT 1 FROM live_players WHERE game_id=? AND user_id=?').get(game.id,user.id);
        if(!player)return socket.emit('room-error','Tu dois rejoindre la partie avant de te connecter.');
        db.prepare('UPDATE live_players SET connected=1 WHERE game_id=? AND user_id=?').run(game.id,user.id);
      }
      socket.join(`game:${game.id}`);socket.data.gameId=game.id;
      io.to(`game:${game.id}`).emit('lobby-update',lobbyPlayers(game.id));
      if(game.status==='question'){const question=currentQuestion(game);if(question)socket.emit('game-question',question)}
    });
    socket.on('game-state',({roomCode,question,finished}={})=>{
      const user=socket.data.user;
      const game=db.prepare('SELECT id,host_id FROM live_games WHERE room_code=?').get(String(roomCode||'').trim().toUpperCase());
      if(!game || game.host_id!==user.id || !['teacher','admin'].includes(user.role))return socket.emit('room-error','Action hôte non autorisée');
      if(finished)io.to(`game:${game.id}`).emit('game-finished');else if(question)io.to(`game:${game.id}`).emit('game-question',question);
    });
    socket.on('disconnect',()=>{if(socket.data.gameId&&socket.data.user?.id){db.prepare('UPDATE live_players SET connected=0 WHERE game_id=? AND user_id=?').run(socket.data.gameId,socket.data.user.id);io.to(`game:${socket.data.gameId}`).emit('lobby-update',lobbyPlayers(socket.data.gameId))}});
  });
}
