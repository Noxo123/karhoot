import { catalogRows } from './avatar-catalog.js';

export function seedAvatarCatalog(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO avatar_items(slug,name,category,style,price,description,icon) VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => catalogRows().forEach(row => insert.run(row.slug,row.name,row.category === 'cosmetic' ? 'style' : row.category,row.style,row.price,row.description,row.icon)))();
}
