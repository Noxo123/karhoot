# 🎮 Karhoot

Plateforme éducative ludique combinant quiz en direct, devoirs, classes et gamification.

## Stack
- Node.js + Express
- SQLite + better-sqlite3
- Socket.IO
- HTML / JavaScript
- Tailwind CSS
- JWT + bcrypt
- Zod + Helmet + rate limiting

## Installation

```bash
npm install
npm run dev
```

Puis ouvrir `http://localhost:3000`.

## Profils
- Élève : quiz, parties live, progression, XP
- Professeur : classes, quiz, parties live
- Admin : base technique prévue pour la modération et l'administration

## API principale
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/quizzes`
- `POST /api/quizzes`
- `GET /api/classes`
- `POST /api/classes`
- `POST /api/classes/join`
- `POST /api/games`
- `GET /api/games/:code`

## Temps réel
Socket.IO gère les lobbies de parties et la présence des joueurs sans rechargement de page.

> Pour la production, définir `JWT_SECRET` dans `.env` et migrer vers PostgreSQL/Redis lorsque la charge l'exige.
