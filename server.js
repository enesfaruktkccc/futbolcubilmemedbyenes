const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'chat-messages.json');
const INDEX = path.join(__dirname, 'index.html');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } })
  : null;

let dbReady = false;
let messages = [];
const leaderboard = new Map();
try { messages = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { messages = []; }

function clean(v, max) { return String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max); }
function cleanStats(raw) {
  const n = v => Math.max(0, Math.min(Number.isFinite(Number(v)) ? Number(v) : 0, 100000000));
  return { name: clean(raw?.name, 18), rating:n(raw?.rating), xp:n(raw?.xp), weeklyXP:n(raw?.weeklyXP), monthXP:n(raw?.monthXP), correct:n(raw?.correct), total:n(raw?.total), streak:n(raw?.streak), bestStreak:n(raw?.bestStreak), playersGuessed:n(raw?.playersGuessed), careerCorrect:n(raw?.careerCorrect), careerTotal:n(raw?.careerTotal), avatar:clean(raw?.avatar,1)||'?' };
}
function leaderboardList() { return [...leaderboard.values()].sort((a,b)=>(b.rating-a.rating)||(b.xp-a.xp)||a.name.localeCompare(b.name,'tr')); }
function emitLeaderboard() { const list=leaderboardList(); io.emit('leaderboard:state',list); io.emit('leaderboard:update',list); }
function persistLocalChat() { try { fs.writeFileSync(DATA, JSON.stringify(messages.slice(-200),null,2)); } catch(e){ console.error('chat yerel kayıt hatası',e); } }

async function initDatabase() {
  if(!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS players (name_key TEXT PRIMARY KEY,name TEXT NOT NULL,rating DOUBLE PRECISION NOT NULL DEFAULT 0,xp DOUBLE PRECISION NOT NULL DEFAULT 0,weekly_xp DOUBLE PRECISION NOT NULL DEFAULT 0,month_xp DOUBLE PRECISION NOT NULL DEFAULT 0,correct DOUBLE PRECISION NOT NULL DEFAULT 0,total DOUBLE PRECISION NOT NULL DEFAULT 0,streak DOUBLE PRECISION NOT NULL DEFAULT 0,best_streak DOUBLE PRECISION NOT NULL DEFAULT 0,players_guessed DOUBLE PRECISION NOT NULL DEFAULT 0,career_correct DOUBLE PRECISION NOT NULL DEFAULT 0,career_total DOUBLE PRECISION NOT NULL DEFAULT 0,avatar TEXT NOT NULL DEFAULT '?',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS chat_messages (id BIGSERIAL PRIMARY KEY,username TEXT NOT NULL,message TEXT NOT NULL,sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const players=await pool.query(`SELECT name,rating,xp,weekly_xp,month_xp,correct,total,streak,best_streak,players_guessed,career_correct,career_total,avatar FROM players`);
  for(const row of players.rows) leaderboard.set(row.name.toLowerCase(),{name:row.name,rating:Number(row.rating)||0,xp:Number(row.xp)||0,weeklyXP:Number(row.weekly_xp)||0,monthXP:Number(row.month_xp)||0,correct:Number(row.correct)||0,total:Number(row.total)||0,streak:Number(row.streak)||0,bestStreak:Number(row.best_streak)||0,playersGuessed:Number(row.players_guessed)||0,careerCorrect:Number(row.career_correct)||0,careerTotal:Number(row.career_total)||0,avatar:row.avatar||'?'});
  const chat=await pool.query(`SELECT username AS user,message AS text,EXTRACT(EPOCH FROM sent_at)*1000 AS at FROM chat_messages ORDER BY id DESC LIMIT 200`);
  messages=chat.rows.reverse().map(m=>({user:m.user,text:m.text,at:Number(m.at)}));
  dbReady=true;
}
async function savePlayer(stats){
  if(!pool||!dbReady)return;
  await pool.query(`INSERT INTO players (name_key,name,rating,xp,weekly_xp,month_xp,correct,total,streak,best_streak,players_guessed,career_correct,career_total,avatar,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) ON CONFLICT (name_key) DO UPDATE SET name=EXCLUDED.name,rating=EXCLUDED.rating,xp=EXCLUDED.xp,weekly_xp=EXCLUDED.weekly_xp,month_xp=EXCLUDED.month_xp,correct=EXCLUDED.correct,total=EXCLUDED.total,streak=EXCLUDED.streak,best_streak=EXCLUDED.best_streak,players_guessed=EXCLUDED.players_guessed,career_correct=EXCLUDED.career_correct,career_total=EXCLUDED.career_total,avatar=EXCLUDED.avatar,updated_at=NOW()`,[stats.name.toLowerCase(),stats.name,stats.rating,stats.xp,stats.weeklyXP,stats.monthXP,stats.correct,stats.total,stats.streak,stats.bestStreak,stats.playersGuessed,stats.careerCorrect,stats.careerTotal,stats.avatar]);
}
async function saveChat(msg){
  if(!pool||!dbReady){messages.push(msg);messages=messages.slice(-200);persistLocalChat();return;}
  await pool.query('INSERT INTO chat_messages (username,message,sent_at) VALUES ($1,$2,TO_TIMESTAMP($3 / 1000.0))',[msg.user,msg.text,msg.at]);
  messages.push(msg);messages=messages.slice(-200);
}

async function fetchImageUrl(name){
  const headers={'User-Agent':'FutbolcuyuBil/1.0 (educational game)','Accept':'application/json'};
  const exact='https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=pageimages&piprop=thumbnail|original&pithumbsize=1000&titles='+encodeURIComponent(name.replace(/\s+/g,'_'));
  const exactResp=await fetch(exact,{headers});
  if(exactResp.ok){
    const data=await exactResp.json();
    const page=data?.query?.pages?.[0];
    const img=page?.original?.source||page?.thumbnail?.source;
    if(img)return img;
  }
  const search='https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch='+encodeURIComponent(name+' footballer')+'&gsrnamespace=0&gsrlimit=10&prop=pageimages&piprop=thumbnail&pithumbsize=1000&format=json&formatversion=2';
  const searchResp=await fetch(search,{headers});
  if(!searchResp.ok) throw new Error('wiki search '+searchResp.status);
  const data=await searchResp.json();
  const pages=Object.values(data?.query?.pages||{});
  const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const target=norm(name);
  pages.sort((a,b)=>{const aa=norm(a.title),bb=norm(b.title);const rank=x=>x===target?0:(x.includes(target)||target.includes(x)?1:2);return rank(aa)-rank(bb);});
  return pages.map(p=>p?.thumbnail?.source).find(Boolean)||null;
}

app.get('/api/player-image',async(req,res)=>{
  const name=clean(req.query?.name,120);
  if(!name)return res.status(400).json({error:'name required'});
  try{
    const imageUrl=await fetchImageUrl(name);
    if(!imageUrl)return res.status(404).json({error:'image not found'});
    const r=await fetch(imageUrl,{headers:{'User-Agent':'FutbolcuyuBil/1.0 (educational game)','Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'}});
    if(!r.ok)throw new Error('image '+r.status);
    const ct=r.headers.get('content-type')||'image/jpeg';
    if(!ct.startsWith('image/'))throw new Error('not an image');
    const buf=Buffer.from(await r.arrayBuffer());
    res.set('Content-Type',ct);res.set('Cache-Control','public,max-age=604800,stale-while-revalidate=86400');res.send(buf);
  }catch(e){console.error('player image error',name,e.message);res.status(502).json({error:'image lookup failed'});}
});

app.get('/',(req,res)=>{
  try{
    const html=fs.readFileSync(INDEX,'utf8');
    const inject=`<script>
      window.__futbolcuImageFix=true;
      window.loadImage=async function(){
        const img=document.getElementById('playerPhoto');
        const fb=document.getElementById('fallbackPlayer');
        const status=document.getElementById('imageStatus');
        if(!img||!fb||typeof current==='undefined'||!current)return;
        img.style.display='none';fb.style.display='grid';if(status)status.textContent='GÖRSEL YÜKLENİYOR...';
        try{
          const url='/api/player-image?name='+encodeURIComponent(current.name)+'&v='+Date.now();
          const r=await fetch(url,{cache:'no-store'});
          if(!r.ok)throw new Error('image '+r.status);
          const blob=await r.blob();
          if(!blob.type.startsWith('image/'))throw new Error('not image blob');
          const objectUrl=URL.createObjectURL(blob);
          img.onload=()=>{URL.revokeObjectURL(objectUrl);fb.style.display='none';img.style.display='block';if(status)status.textContent='';};
          img.onerror=()=>{URL.revokeObjectURL(objectUrl);img.style.display='none';fb.style.display='grid';if(status)status.textContent='GÖRSEL BULUNAMADI';};
          img.src=objectUrl;
        }catch(e){console.error('robust image load failed',e);if(status)status.textContent='GÖRSEL BULUNAMADI';}
      };
    </script>`;
    res.type('html').send(html.replace('</body>',inject+'</body>'));
  }catch(e){res.status(500).send('index error');}
});

app.use(express.static(__dirname));
app.get('/health',(_,res)=>res.json({ok:true,online:io.engine.clientsCount,leaderboard:leaderboard.size,database:dbReady}));

io.on('connection',socket=>{
  socket.emit('chat:history',messages.slice(-80));
  socket.emit('leaderboard:state',leaderboardList());
  socket.emit('leaderboard:update',leaderboardList());
  socket.on('leaderboard:join',async raw=>{
    const incoming=cleanStats(raw);if(!incoming.name)return;
    try{
      const key=incoming.name.toLowerCase();let existing=leaderboard.get(key);
      if(pool&&dbReady){const result=await pool.query('SELECT name,rating,xp,weekly_xp,month_xp,correct,total,streak,best_streak,players_guessed,career_correct,career_total,avatar FROM players WHERE name_key=$1',[key]);if(result.rows[0]){const r=result.rows[0];existing={name:r.name,rating:Number(r.rating)||0,xp:Number(r.xp)||0,weeklyXP:Number(r.weekly_xp)||0,monthXP:Number(r.month_xp)||0,correct:Number(r.correct)||0,total:Number(r.total)||0,streak:Number(r.streak)||0,bestStreak:Number(r.best_streak)||0,playersGuessed:Number(r.players_guessed)||0,careerCorrect:Number(r.career_correct)||0,careerTotal:Number(r.career_total)||0,avatar:r.avatar||'?'};}}
      if(existing){leaderboard.set(key,existing);socket.emit('player:stats',existing);}else{leaderboard.set(key,incoming);await savePlayer(incoming);socket.emit('player:stats',incoming);}emitLeaderboard();
    }catch(e){console.error('leaderboard join hatası',e);}
  });
  async function updateStats(raw){const stats=cleanStats(raw);if(!stats.name)return;try{leaderboard.set(stats.name.toLowerCase(),stats);await savePlayer(stats);emitLeaderboard();}catch(e){console.error('skor kayıt hatası',e);}}
  socket.on('leaderboard:update',updateStats);socket.on('score:update',updateStats);
  socket.on('player:join',async raw=>{const name=clean(raw?.name,18);if(!name)return;const existing=leaderboard.get(name.toLowerCase());if(existing)socket.emit('player:stats',existing);else{const fresh=cleanStats({name});leaderboard.set(name.toLowerCase(),fresh);await savePlayer(fresh);socket.emit('player:stats',fresh);}socket.emit('player:joined',{name});emitLeaderboard();});
  async function handleChat(raw){const user=clean(raw?.user||raw?.name,18),text=clean(raw?.text,180);if(!user||!text)return;const msg={user,text,at:Date.now()};try{await saveChat(msg);io.emit('chat:message',msg);io.emit('chat:new',{id:`${msg.at}-${socket.id}`,name:user,text,at:msg.at});}catch(e){console.error('chat kayıt hatası',e);}}
  socket.on('chat:message',handleChat);socket.on('chat:send',handleChat);
});

initDatabase().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`Futbolcuyu Bil çalışıyor: ${PORT}`))).catch(err=>{console.error('PostgreSQL başlatılamadı:',err);server.listen(PORT,'0.0.0.0',()=>console.log(`Futbolcuyu Bil çalışıyor: ${PORT}`));});
