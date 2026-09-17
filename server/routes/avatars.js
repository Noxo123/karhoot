import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database.js';
import { requireAuth } from '../auth.js';

export const avatarRouter = Router();

const hexColor = z.string().regex(/^#?[0-9a-fA-F]{3,8}$/);
const optionValue = z.union([z.string().min(1).max(128), z.number().finite().min(-360).max(360), z.boolean()]);
const avatarConfigSchema = z.object({
  character: z.string().min(1).max(64).default('lorelei-default'),
  outfit: z.string().max(64).default(''),
  background: z.string().max(64).default(''),
  seed: z.string().min(1).max(80).default('karhoot'),
  options: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), optionValue).default({})
}).superRefine((config, ctx) => {
  const colorKeys = ['backgroundColor', 'skinColor', 'hairColor', 'clothingColor', 'eyesColor', 'mouthColor', 'accessoriesColor'];
  for (const key of colorKeys) {
    const value = config.options[key];
    if (value !== undefined) {
      const values = Array.isArray(value) ? value : [value];
      for (const color of values) {
        if (typeof color === 'string' && !hexColor.safeParse(color).success) {
          ctx.addIssue({ code: 'custom', path: ['options', key], message: `Couleur invalide: ${key}` });
        }
      }
    }
  }
});

function owned(userId, slug) {
  return !!db.prepare('SELECT 1 FROM user_avatar_items uai JOIN avatar_items ai ON ai.id=uai.item_id WHERE uai.user_id=? AND ai.slug=?').get(userId, slug);
}

function getConfig(userId) {
  const row = db.prepare('SELECT avatar_config, username FROM users WHERE id=?').get(userId);
  try {
    const raw = JSON.parse(row?.avatar_config || '{}');
    return {
      character: raw.character || 'lorelei-default',
      outfit: raw.outfit || '',
      background: raw.background || '',
      seed: String(raw.seed || row?.username || 'karhoot').slice(0, 80),
      options: raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options) ? raw.options : {}
    };
  } catch {
    return { character: 'lorelei-default', outfit: '', background: '', seed: row?.username || 'karhoot', options: {} };
  }
}

avatarRouter.get('/catalog', requireAuth, (req, res) => {
  const items = db.prepare('SELECT id,slug,name,category,style,price,description,icon FROM avatar_items WHERE active=1 ORDER BY category,price,id').all();
  const config = getConfig(req.user.id);
  res.json({
    items: items.map(item => ({
      ...item,
      owned: item.price === 0 || owned(req.user.id, item.slug),
      equipped: [config.character, config.outfit, config.background].includes(item.slug)
    }))
  });
});

avatarRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id,username,avatar,avatar_config,coins,xp,level FROM users WHERE id=?').get(req.user.id);
  res.json({ user, config: getConfig(req.user.id) });
});

avatarRouter.post('/purchase', requireAuth, (req, res) => {
  const parsed = z.object({ slug: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Article invalide' });
  const item = db.prepare('SELECT * FROM avatar_items WHERE slug=? AND active=1').get(parsed.data.slug);
  if (!item) return res.status(404).json({ error: 'Article introuvable' });
  if (owned(req.user.id, item.slug)) return res.status(409).json({ error: 'Article déjà possédé' });

  const buy = db.transaction(() => {
    const user = db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id);
    if (!user || user.coins < item.price) throw new Error('NOT_ENOUGH_COINS');
    db.prepare('UPDATE users SET coins=coins-?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.price, req.user.id);
    db.prepare('INSERT INTO user_avatar_items(user_id,item_id) VALUES (?,?)').run(req.user.id, item.id);
    return db.prepare('SELECT coins FROM users WHERE id=?').get(req.user.id).coins;
  });

  try {
    const coins = buy();
    res.json({ ok: true, coins, item });
  } catch (error) {
    if (error.message === 'NOT_ENOUGH_COINS') return res.status(400).json({ error: 'Pas assez de pièces' });
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'Article déjà possédé' });
    console.error(error);
    res.status(500).json({ error: 'Achat impossible' });
  }
});

avatarRouter.post('/equip', requireAuth, (req, res) => {
  const parsed = avatarConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Configuration invalide', details: parsed.error.flatten() });
  const config = parsed.data;

  for (const key of ['character', 'outfit', 'background']) {
    if (config[key] && !owned(req.user.id, config[key])) {
      return res.status(403).json({ error: `Article non possédé: ${config[key]}` });
    }
  }

  const character = db.prepare('SELECT style FROM avatar_items WHERE slug=? AND category=? AND active=1').get(config.character, 'character');
  if (!character) return res.status(400).json({ error: 'Personnage invalide' });

  // The complete configuration is persisted, not only the DiceBear style.
  // This lets the editor restore hair, eyes, colors and every supported style option.
  db.prepare('UPDATE users SET avatar=?,avatar_config=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(character.style, JSON.stringify(config), req.user.id);

  res.json({ ok: true, config, avatar: character.style });
});
