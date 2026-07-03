# Manhïa — Guide de mise en ligne (déploiement)

Ce guide t'accompagne pour mettre ton prototype en ligne, accessible depuis n'importe quel téléphone avec une vraie adresse internet. Compte environ 20-30 minutes la première fois. Aucune compétence technique n'est nécessaire — tu vas juste suivre les étapes et cliquer.

**Ce dont tu as besoin avant de commencer** : une adresse email, et les fichiers du projet que je t'ai préparés (dossier `manhia-app`).

---

## Étape 1 — Créer la base de données (Supabase)

Supabase va stocker tous les comptes et toutes les courses, de façon à ce que tout le monde (client et livreur) voie les mêmes informations en temps réel, peu importe leur appareil.

1. Va sur **[supabase.com](https://supabase.com)** et clique sur **"Start your project"**.
2. Crée un compte (avec Google ou email).
3. Clique sur **"New project"**.
   - Nom du projet : `manhia`
   - Mot de passe de la base de données : choisis-en un solide et **note-le quelque part** (tu n'en auras pas besoin tout de suite, mais garde-le)
   - Région : choisis celle la plus proche du Bénin (souvent "West EU" ou équivalent)
4. Attends 1-2 minutes que le projet se crée.

### Créer les tables

5. Dans le menu de gauche, clique sur **"SQL Editor"**.
6. Clique sur **"New query"**.
7. Ouvre le fichier `supabase_setup.sql` (fourni avec ton projet), copie tout son contenu, colle-le dans l'éditeur.
8. Clique sur **"Run"** (ou Ctrl+Entrée). Tu dois voir "Success" — cela crée automatiquement tes deux tables : `users` et `courses`.

### Récupérer tes clés de connexion

9. Dans le menu de gauche, clique sur l'icône **"Project Settings"** (roue crantée), puis **"API"**.
10. Tu vas voir deux informations à copier quelque part (bloc-notes) :
    - **Project URL** (ressemble à `https://xxxxx.supabase.co`)
    - **anon public key** (une longue chaîne de caractères)

Garde ces deux informations, tu en as besoin à l'étape 3.

---

## Étape 2 — Mettre le code sur GitHub

GitHub va héberger ton code source, ce qui permet à Vercel (l'étape suivante) de le récupérer et de le publier automatiquement.

1. Va sur **[github.com](https://github.com)** et crée un compte si tu n'en as pas.
2. Clique sur le bouton **"+"** en haut à droite, puis **"New repository"**.
3. Nom du dépôt : `manhia-app`. Laisse le reste par défaut, clique sur **"Create repository"**.
4. Sur la page qui s'affiche, clique sur **"uploading an existing file"**.
5. Glisse-dépose **tous les fichiers et dossiers** du projet `manhia-app` que je t'ai fournis (sauf le dossier `node_modules` s'il existe, et le fichier `.env` s'il existe — ils ne doivent pas être en ligne).
6. En bas de la page, clique sur **"Commit changes"**.

---

## Étape 3 — Publier le site (Vercel)

Vercel va prendre ton code sur GitHub et le transformer en site web accessible avec une vraie adresse.

1. Va sur **[vercel.com](https://vercel.com)** et crée un compte en te connectant avec ton compte GitHub (le plus simple).
2. Clique sur **"Add New..."** puis **"Project"**.
3. Trouve ton dépôt `manhia-app` dans la liste, clique sur **"Import"**.
4. Avant de cliquer sur "Deploy", ouvre la section **"Environment Variables"** :
   - Ajoute une variable : nom `VITE_SUPABASE_URL`, valeur = ton **Project URL** de l'étape 1
   - Ajoute une deuxième variable : nom `VITE_SUPABASE_ANON_KEY`, valeur = ta **anon public key** de l'étape 1
5. Clique sur **"Deploy"**.
6. Attends 1-2 minutes. Vercel te donne une adresse du type `manhia-app.vercel.app`.

**C'est cette adresse que tu peux maintenant partager et ouvrir depuis n'importe quel téléphone.**

---

## Étape 4 — Tester avec deux vrais téléphones

1. Depuis ton téléphone, ouvre l'adresse `manhia-app.vercel.app` dans le navigateur (Chrome, Safari...).
2. Crée un compte **Client**.
3. Depuis un second téléphone (celui d'un ami, ou un zem test), ouvre la même adresse.
4. Crée un compte **Livreur**.
5. Depuis le téléphone client, crée une course.
6. Depuis le téléphone livreur, la course doit apparaître automatiquement dans "Demandes disponibles" — accepte-la et fais-la avancer.
7. Retourne sur le téléphone client : le statut doit s'être mis à jour tout seul.

Si ça fonctionne, tu as un vrai prototype testable sur le terrain.

---

## Ce que tu peux faire ensuite

- **Ajouter l'app à l'écran d'accueil du téléphone** : sur Chrome (Android) ou Safari (iPhone), il y a une option "Ajouter à l'écran d'accueil" qui donne une icône comme une vraie application, sans passer par le Play Store.
- **Modifier des textes ou des couleurs** : reviens vers moi avec ce que tu veux changer, je modifie le code, tu re-uploades sur GitHub, Vercel republie automatiquement en 1-2 minutes.
- **Passer à une vraie publication Play Store / App Store** : c'est une étape différente et plus lourde (compte développeur payant, révision par Google/Apple) — on en reparlera quand tu voudras officialiser le lancement.

---

## En cas de blocage

Si une étape ne fonctionne pas comme prévu, reviens vers moi avec :
- L'étape où tu bloques
- Le message d'erreur exact si tu en vois un (une capture d'écran aide beaucoup)

Je t'aiderai à débloquer la situation.
