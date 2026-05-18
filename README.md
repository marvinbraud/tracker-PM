# QUANT TERMINAL — Bloomberg Dashboard

Application de gestion de portefeuille style Bloomberg Terminal.  
Stack : **React + Vite + TypeScript** (frontend) · **Express + Node.js** (backend)

---

## Prérequis

- [Node.js](https://nodejs.org/) **v18 ou supérieur** (LTS recommandé)
- `npm` (inclus avec Node.js)

Vérifier votre version :
```bash
node --version   # doit afficher v18.x ou supérieur
npm --version
```

---

## Démarrage rapide

### 1 — Installer les dépendances

```bash
cd bloomberg-dashboard
npm install
```

> La première fois, cela peut prendre 1–2 minutes.

---

### 2a — Mode développement (avec rechargement automatique)

```bash
npm run dev
```

Ouvrez **http://localhost:5000** dans votre navigateur.

---

### 2b — Mode production (build optimisé)

```bash
npm run build
npm start
```

Ouvrez **http://localhost:5000** dans votre navigateur.

---

## Scripts disponibles

| Commande       | Description                                              |
|----------------|----------------------------------------------------------|
| `npm run dev`  | Serveur de développement avec hot-reload (port 5000)     |
| `npm run build`| Build de production (génère `dist/`)                    |
| `npm start`    | Lance le serveur de production (après un `npm run build`)|

---

## Structure du projet

```
bloomberg-dashboard/
├── client/                  # Frontend React + Vite
│   ├── src/
│   │   ├── components/      # Sidebar, Topbar, KpiCard…
│   │   ├── pages/           # Overview, Positions, Charts, Risk, Import, MacroPage
│   │   ├── lib/             # queryClient, utils
│   │   └── App.tsx          # Routing (wouter hash-based)
│   └── index.html
├── server/                  # Backend Express
│   ├── index.ts             # Entrée du serveur
│   ├── routes.ts            # Toutes les routes API
│   ├── storage.ts           # Stockage en mémoire (resets au redémarrage)
│   ├── marketData.ts        # Yahoo Finance + FX rates + cache
│   └── calculations.ts      # Sharpe, Sortino, VaR, bêta…
├── shared/
│   └── schema.ts            # Types partagés frontend/backend
├── package.json
└── README.md
```

---

## Notes importantes

### Données en mémoire
Le stockage est **en mémoire** : vos positions sont perdues à chaque redémarrage du serveur.  
Pour les conserver, importez-les via la page **Import** à chaque démarrage via Google Sheets (si configuré) ou via le CSV.

### Prix en temps réel
Les prix sont récupérés depuis **Yahoo Finance** (nécessite une connexion internet).  
Sans connexion, un modèle de simulation GBM prend le relais.

### Google Sheets
Pour synchroniser un portefeuille depuis Google Sheets, le fichier doit être **partagé publiquement** (Voir > Tout le monde avec le lien).  
Format attendu : colonnes `ticker`, `quantity`, `purchase_price`, `portfolio` (voir exemple dans l'application).

---

## Dépannage

**Port 5000 déjà utilisé :**
```bash
# macOS / Linux
lsof -ti:5000 | xargs kill -9
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

**node_modules manquant :**
```bash
rm -rf node_modules package-lock.json
npm install
```

**Erreur TypeScript / build :**
```bash
npm run check   # vérifie les types
npm run build   # rebuild
```
